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
const SERVICES: Archetype[] = ['compute-service', 'worker'];
/** Nodes that forward requests to services behind them. */
const ROUTERS: Archetype[] = ['load-balancer', 'gateway', 'cdn'];
const QUEUES: Archetype[] = ['message-queue', 'event-stream'];
const MAX_DEPTH = 6;

/**
 * Builds API flows and message handlers from the canvas graph, so a design drawn
 * from scratch can run without a flow editor. It follows the arrows:
 *
 *   client → (load balancer / gateway) → services
 *   service → other services   (synchronous calls, nested)
 *   service → cache, database   (data access)
 *   service → queue / stream    (async publish, on writes)
 *   queue → consumers           (each message runs the consumer's own dependencies)
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
    const db = targetsOfKind(serviceId, ['relational-db'])[0];
    if (mode === 'read') {
      const dbRead: FlowStep[] = db ? [{ kind: 'call', nodeId: db, operation: 'read' }] : [];
      if (cache) steps.push({ kind: 'cache-lookup', cacheNodeId: cache, onHit: [], onMiss: dbRead, writeBackOnMiss: Boolean(db) });
      else steps.push(...dbRead);
    } else {
      if (db) steps.push({ kind: 'call', nodeId: db, operation: 'write' });
      for (const q of targetsOfKind(serviceId, QUEUES)) {
        if (q !== skipQueue) steps.push({ kind: 'publish', nodeId: q });
      }
    }
    return steps;
  }

  /** Does anything at or below this service write data or publish messages? */
  function writes(serviceId: string, stack: string[]): boolean {
    if (targetsOfKind(serviceId, ['relational-db', ...QUEUES]).length > 0) return true;
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
  const entries: Array<{ entry: string; service: string }> = [];
  for (const e of clientEdges.filter((ce) => ce.source === client)) {
    const k = kind.get(e.target)!;
    const services = SERVICES.includes(k) ? [e.target] : ROUTERS.includes(k) ? servicesBehind(e.target) : [];
    for (const service of services) {
      if (!entries.some((x) => x.service === service)) entries.push({ entry: e.target, service });
    }
  }
  if (entries.length === 0) {
    return { flows: [], handlers, hints: ['Connect a backend (like Spring Boot or NestJS) behind your entry point.', ...hints] };
  }

  const flows: ApiFlow[] = [];
  for (const { entry, service } of entries) {
    const name = label.get(service) ?? service;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'items';
    const work: FlowStep = { kind: 'call', nodeId: service, operation: 'process' };
    const read = inside(service, 'read', [service]);
    flows.push({
      id: readFlowId(service),
      name: `Read · ${name}`,
      method: 'GET',
      path: `/api/${slug}/{id}`,
      entryNodeId: entry,
      steps: [work, ...read, { kind: 'respond', status: 200 }],
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
