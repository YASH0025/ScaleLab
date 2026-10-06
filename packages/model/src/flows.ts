import type { ArchetypeResolver } from './validate';
import type { ApiFlow, ArchEdge, ArchNode, Archetype, FlowStep, MessageHandler, Workload } from './schemas';

export interface DerivedFlows {
  flows: ApiFlow[];
  /** What each consumer does with messages from the queues it reads. */
  handlers: MessageHandler[];
  /** What's missing or simplified. Shown to the user. */
  hints: string[];
}

const READ = 'read:';
const WRITE = 'write:';

export const readFlowId = (serviceId: string) => `${READ}${serviceId}`;
export const writeFlowId = (serviceId: string) => `${WRITE}${serviceId}`;
export const isWriteFlow = (flowId: string) => flowId.startsWith(WRITE);

/** Backends that run code and own their dependencies. */
const SERVICES: Archetype[] = ['compute-service', 'worker', 'serverless-function', 'realtime-server'];
/** Nodes that forward requests to services behind them. */
const ROUTERS: Archetype[] = ['load-balancer', 'gateway', 'cdn', 'dns'];
const QUEUES: Archetype[] = ['message-queue', 'event-stream'];
/** Where data lives: relational, document, wide-column, search and vector stores. */
const DATA_STORES: Archetype[] = ['relational-db', 'document-db', 'wide-column-db', 'search-engine', 'vector-db'];
/** Remote services called over the network: third-party APIs, auth providers and object storage. */
const EXTERNALS: Archetype[] = ['external-api', 'auth-provider', 'object-storage'];
const MAX_DEPTH = 6;

/** Human-readable side effects, shown in journey results. */
export const effectSaved = (label: string) => `saved to ${label}`;
export const effectExternal = (label: string) => `${label} call went through`;
export const effectPublished = (label: string) => `sent to ${label}`;

/**
 * Builds API flows and message handlers from the canvas graph, so a design drawn
 * from scratch can run without a flow editor. It follows the arrows:
 *
 *   client → (load balancer / gateway) → services
 *   service → other services   (synchronous calls, nested)
 *   client → CDN → …            (reads served at the edge on a hit)
 *   CDN → object storage        (media and files served through the CDN)
 *   service → cache, data stores (data access; reads try the cache first)
 *   service → external API, object storage (Stripe, S3…; a side effect on writes)
 *   service → queue / stream    (async publish, on writes)
 *   queue → consumers           (each message runs the consumer's own dependencies)
 *
 * Inside a service the order is: downstream services, data, external APIs, then messages.
 * Writes record side effects ("saved to Orders DB", "Stripe call went through") so journeys
 * can tell when a failed step still changed something.
 *
 * Every service behind the entry point gets a read flow and, when anything below it
 * writes, a write flow. Traffic is split evenly across those services.
 */
export function deriveFlows(nodes: ArchNode[], edges: ArchEdge[], resolve: ArchetypeResolver): DerivedFlows {
  const hints: string[] = [];
  const kind = new Map<string, Archetype>();
  const label = new Map<string, string>();
  for (const node of nodes) {
    const a = resolve(node.technologyId);
    if (a) kind.set(node.id, a);
    label.set(node.id, node.label);
  }
  const out = (id: string) => edges.filter((e) => e.source === id && kind.has(e.target));
  const targetsOfKind = (id: string, kinds: Archetype[]) =>
    out(id)
      .map((e) => e.target)
      .filter((t) => kinds.includes(kind.get(t)!));

  /** Services reachable from a node, looking through routers. */
  function servicesBehind(id: string, seen = new Set<string>()): string[] {
    const found: string[] = [];
    for (const e of out(id)) {
      const k = kind.get(e.target)!;
      if (SERVICES.includes(k)) found.push(e.target);
      else if (ROUTERS.includes(k) && !seen.has(e.target)) {
        seen.add(e.target);
        found.push(...servicesBehind(e.target, seen));
      }
    }
    return [...new Set(found)];
  }

  /** Everything a service does after its own work: downstream calls, data, messages. */
  function inside(serviceId: string, mode: 'read' | 'write', stack: string[], skipQueue?: string): FlowStep[] {
    const steps: FlowStep[] = [];
    if (stack.length <= MAX_DEPTH) {
      for (const next of servicesBehind(serviceId)) {
        if (stack.includes(next)) continue; // a call cycle; don't recurse forever
        steps.push({ kind: 'service-call', nodeId: next, steps: inside(next, mode, [...stack, next], skipQueue) });
      }
    }
    const cache = targetsOfKind(serviceId, ['cache'])[0];
    const stores = targetsOfKind(serviceId, DATA_STORES);
    const externals = targetsOfKind(serviceId, EXTERNALS);
    if (mode === 'read') {
      // Several stores (say a database and a search index) are queried side by side.
      const reads: FlowStep[] = stores.map((db) => ({ kind: 'call', nodeId: db, operation: 'read' }));
      const dbRead: FlowStep[] = reads.length > 1 ? [{ kind: 'parallel', branches: reads.map((r) => [r]) }] : reads;
      if (cache) steps.push({ kind: 'cache-lookup', cacheNodeId: cache, onHit: [], onMiss: dbRead, writeBackOnMiss: stores.length > 0 });
      else steps.push(...dbRead);
      for (const x of externals) steps.push({ kind: 'call', nodeId: x, operation: 'read' });
    } else {
      for (const db of stores) steps.push({ kind: 'call', nodeId: db, operation: 'write', effect: effectSaved(label.get(db) ?? db) });
      // A cache with no store behind it is the store itself (sessions, counters, a geo index).
      if (cache && stores.length === 0) steps.push({ kind: 'call', nodeId: cache, operation: 'write', effect: effectSaved(label.get(cache) ?? cache) });
      for (const x of externals) {
        const effect = kind.get(x) === 'object-storage' ? effectSaved(label.get(x) ?? x) : effectExternal(label.get(x) ?? x);
        steps.push({ kind: 'call', nodeId: x, operation: 'write', effect });
      }
      for (const q of targetsOfKind(serviceId, QUEUES)) {
        if (q !== skipQueue) steps.push({ kind: 'publish', nodeId: q, effect: effectPublished(label.get(q) ?? q) });
      }
    }
    return steps;
  }

  /** Does anything at or below this service write data or publish messages? */
  function writes(serviceId: string, stack: string[]): boolean {
    if (targetsOfKind(serviceId, [...DATA_STORES, ...QUEUES, ...EXTERNALS, 'cache']).length > 0) return true;
    if (stack.length > MAX_DEPTH) return false;
    return servicesBehind(serviceId).some((n) => !stack.includes(n) && writes(n, [...stack, n]));
  }

  function touchesData(steps: FlowStep[]): boolean {
    return steps.some((s) =>
      s.kind === 'service-call'
        ? touchesData(s.steps)
        : (s.kind === 'call' && s.operation !== 'process') || s.kind === 'cache-lookup' || s.kind === 'publish',
    );
  }

  // ── Message handlers: one per queue → consumer connection ──
  const handlers: MessageHandler[] = [];
  for (const [id, k] of kind) {
    if (!QUEUES.includes(k)) continue;
    const consumers = targetsOfKind(id, SERVICES);
    if (consumers.length === 0) {
      hints.push(`Nothing consumes from "${label.get(id)}", so its messages will pile up. Connect it to a worker or service.`);
    }
    for (const consumer of consumers) {
      handlers.push({
        id: `handler:${id}:${consumer}`,
        queueNodeId: id,
        consumerNodeId: consumer,
        // A consumer never re-publishes to the queue it reads from, or every message would loop forever.
        steps: [{ kind: 'call', nodeId: consumer, operation: 'process' }, ...inside(consumer, 'write', [consumer], id)],
      });
    }
  }

  // ── API flows ──
  const clientEdges = edges.filter((e) => kind.get(e.source) === 'client' && kind.has(e.target));
  if (clientEdges.length === 0) {
    return { flows: [], handlers, hints: ['Connect a client (like a browser or Next.js) to your system to send traffic.', ...hints] };
  }
  const client = clientEdges[0]!.source;
  /**
   * The CDN in front of an entry point, if there is one: the entry itself, or a CDN behind DNS.
   * With a service given, only a CDN that actually leads to that service counts, so
   * DNS → CDN → images and DNS → load balancer → API don't put the API behind the CDN.
   */
  const cdnFor = (entry: string, service?: string): string | undefined => {
    const k = kind.get(entry);
    if (k === 'cdn') return entry;
    if (k !== 'dns') return undefined;
    const cdns = targetsOfKind(entry, ['cdn']);
    return service ? cdns.find((c) => servicesBehind(c).includes(service)) : cdns[0];
  };
  const entries: Array<{ entry: string; service: string }> = [];
  /** Object storage reached straight from the client (pre-signed URLs) or through a CDN. */
  const media: Array<{ entry: string; store: string; cdn?: string }> = [];
  for (const e of clientEdges.filter((ce) => ce.source === client)) {
    const k = kind.get(e.target)!;
    const services = SERVICES.includes(k) ? [e.target] : ROUTERS.includes(k) ? servicesBehind(e.target) : [];
    for (const service of services) {
      if (!entries.some((x) => x.service === service)) entries.push({ entry: e.target, service });
    }
    if (k === 'object-storage' && !media.some((m) => m.store === e.target)) media.push({ entry: e.target, store: e.target });
    const cdn = cdnFor(e.target);
    if (cdn) {
      for (const store of targetsOfKind(cdn, ['object-storage'])) {
        const existing = media.find((m) => m.store === store);
        if (existing) Object.assign(existing, { entry: e.target, cdn });
        else media.push({ entry: e.target, store, cdn });
      }
    }
  }
  if (entries.length === 0 && media.length === 0) {
    return { flows: [], handlers, hints: ['Connect a backend (like Spring Boot or NestJS) behind your entry point.', ...hints] };
  }

  const flows: ApiFlow[] = [];
  const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'items';
  for (const { entry, service } of entries) {
    const name = label.get(service) ?? service;
    const slug = slugOf(name);
    const work: FlowStep = { kind: 'call', nodeId: service, operation: 'process' };
    const read = inside(service, 'read', [service]);
    const cdn = cdnFor(entry, service);
    // Behind a CDN, reads are answered at the edge on a hit and only misses reach the service.
    const readSteps: FlowStep[] = cdn
      ? [{ kind: 'cache-lookup', cacheNodeId: cdn, onHit: [], onMiss: [work, ...read], writeBackOnMiss: true }]
      : [work, ...read];
    flows.push({
      id: readFlowId(service),
      name: `Read · ${name}`,
      method: 'GET',
      path: `/api/${slug}/{id}`,
      entryNodeId: entry,
      steps: [...readSteps, { kind: 'respond', status: 200 }],
      retry: { attempts: 0, backoffMs: 0 },
    });
    if (writes(service, [service])) {
      flows.push({
        id: writeFlowId(service),
        name: `Write · ${name}`,
        method: 'POST',
        path: `/api/${slug}`,
        entryNodeId: entry,
        steps: [work, ...inside(service, 'write', [service]), { kind: 'respond', status: 201 }],
        retry: { attempts: 0, backoffMs: 0 },
      });
    }
  }
  for (const { entry, store, cdn } of media) {
    const name = label.get(store) ?? store;
    const get: FlowStep = { kind: 'call', nodeId: store, operation: 'read' };
    flows.push({
      id: readFlowId(store),
      name: `Download · ${name}`,
      method: 'GET',
      path: `/files/{key}`,
      entryNodeId: entry,
      steps: [...(cdn ? [{ kind: 'cache-lookup' as const, cacheNodeId: cdn, onHit: [], onMiss: [get], writeBackOnMiss: true }] : [get]), { kind: 'respond', status: 200 }],
      retry: { attempts: 0, backoffMs: 0 },
    });
    if (kind.get(entry) === 'object-storage' || edges.some((e) => e.source === client && e.target === store)) {
      flows.push({
        id: writeFlowId(store),
        name: `Upload · ${name}`,
        method: 'PUT',
        path: `/files/{key}`,
        entryNodeId: store,
        steps: [{ kind: 'call', nodeId: store, operation: 'write', effect: effectSaved(name) }, { kind: 'respond', status: 201 }],
        retry: { attempts: 0, backoffMs: 0 },
      });
    }
  }
  if (!flows.some((f) => touchesData(f.steps))) {
    hints.push('Add a cache or a database behind your backend to see data access in the simulation.');
  }
  return { flows, handlers, hints };
}

/**
 * Traffic mix for derived flows: an even share per entry service,
 * split 90% reads and 10% writes within each service.
 */
export function derivedMix(flows: ApiFlow[]): Workload['mix'] {
  const services = new Set(flows.map((f) => f.id.slice(f.id.indexOf(':') + 1)));
  return flows.map((f) => {
    const service = f.id.slice(f.id.indexOf(':') + 1);
    const hasWrite = flows.some((g) => g.id === writeFlowId(service));
    const share = 100 / services.size;
    const weight = isWriteFlow(f.id) ? share * 0.1 : hasWrite ? share * 0.9 : share;
    return { flowId: f.id, weight };
  });
}
