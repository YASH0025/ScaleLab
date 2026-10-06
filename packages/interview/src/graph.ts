import { getTechnology } from '@scalelab/catalog';
import type { ArchEdge, ArchNode, Archetype } from '@scalelab/model';

export interface GraphNode {
  id: string;
  technologyId: string;
  archetype: Archetype;
  label: string;
  node: ArchNode;
}

export const SERVICES: Archetype[] = ['compute-service', 'serverless-function', 'realtime-server'];
export const WORKERS: Archetype[] = ['worker', 'serverless-function'];
export const ROUTERS: Archetype[] = ['dns', 'cdn', 'gateway', 'load-balancer'];
export const STORES: Archetype[] = ['relational-db', 'document-db', 'wide-column-db', 'search-engine', 'vector-db'];
export const PRIMARY_STORES: Archetype[] = ['relational-db', 'document-db', 'wide-column-db'];
export const QUEUES: Archetype[] = ['message-queue', 'event-stream'];

/** A read-only view of a design for checks: what's there and what connects to what. */
export class Graph {
  readonly nodes: GraphNode[];
  private readonly out = new Map<string, string[]>();
  private readonly inn = new Map<string, string[]>();
  private readonly byId: Map<string, GraphNode>;

  constructor(nodes: ArchNode[], edges: ArchEdge[]) {
    this.nodes = nodes.flatMap((n) => {
      const archetype = getTechnology(n.technologyId)?.archetype;
      return archetype ? [{ id: n.id, technologyId: n.technologyId, archetype, label: n.label, node: n }] : [];
    });
    this.byId = new Map(this.nodes.map((n) => [n.id, n]));
    for (const e of edges) {
      if (!this.byId.has(e.source) || !this.byId.has(e.target)) continue;
      this.out.set(e.source, [...(this.out.get(e.source) ?? []), e.target]);
      this.inn.set(e.target, [...(this.inn.get(e.target) ?? []), e.source]);
    }
  }

  get(id: string): GraphNode | undefined {
    return this.byId.get(id);
  }

  of(...archetypes: Archetype[]): GraphNode[] {
    return this.nodes.filter((n) => archetypes.includes(n.archetype));
  }

  has(...archetypes: Archetype[]): boolean {
    return this.of(...archetypes).length > 0;
  }

  hasTech(...ids: string[]): boolean {
    return this.nodes.some((n) => ids.includes(n.technologyId));
  }

  targets(id: string): GraphNode[] {
    return (this.out.get(id) ?? []).map((t) => this.byId.get(t)!);
  }

  sources(id: string): GraphNode[] {
    return (this.inn.get(id) ?? []).map((t) => this.byId.get(t)!);
  }

  /** Any edge from a node of one kind to a node of another. */
  linked(from: Archetype[], to: Archetype[]): boolean {
    return this.of(...from).some((n) => this.targets(n.id).some((t) => to.includes(t.archetype)));
  }

  /** Nodes reachable from `id` along the arrows. */
  reachable(id: string): GraphNode[] {
    const seen = new Set<string>([id]);
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const t of this.out.get(cur) ?? []) {
        if (!seen.has(t)) {
          seen.add(t);
          queue.push(t);
        }
      }
    }
    seen.delete(id);
    return [...seen].map((s) => this.byId.get(s)!);
  }

  /** Is there a path from any node of `from` to any node of `to`? */
  reaches(from: Archetype[], to: Archetype[]): boolean {
    return this.of(...from).some((n) => this.reachable(n.id).some((r) => to.includes(r.archetype)));
  }

  /** Nodes on the way in: what clients reach before the first service. */
  entryPath(): GraphNode[] {
    const found = new Map<string, GraphNode>();
    const queue = this.of('client').map((c) => c.id);
    const seen = new Set(queue);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const t of this.targets(cur)) {
        if (seen.has(t.id) || !ROUTERS.includes(t.archetype)) continue;
        seen.add(t.id);
        found.set(t.id, t);
        queue.push(t.id);
      }
    }
    return [...found.values()];
  }

  /** Services that users' requests reach (directly or through routers). */
  frontServices(): GraphNode[] {
    const entry = [...this.of('client'), ...this.entryPath()];
    const out = new Map<string, GraphNode>();
    for (const n of entry) for (const t of this.targets(n.id)) if (SERVICES.includes(t.archetype)) out.set(t.id, t);
    return [...out.values()];
  }

  /** Every service that does work on the request path, including ones called by other services. */
  requestServices(): GraphNode[] {
    const out = new Map<string, GraphNode>();
    const queue = this.frontServices();
    for (const s of queue) out.set(s.id, s);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const t of this.targets(cur.id)) {
        if (SERVICES.includes(t.archetype) && !out.has(t.id)) {
          out.set(t.id, t);
          queue.push(t);
        }
      }
    }
    return [...out.values()];
  }

  instances(n: GraphNode): number {
    return n.node.config.type === 'compute' ? n.node.config.instances : 1;
  }

  replicas(n: GraphNode): number {
    return n.node.config.type === 'relational-db' ? n.node.config.readReplicas : 0;
  }

  shards(n: GraphNode): number {
    return n.node.config.type === 'relational-db' ? (n.node.config.shards ?? 1) : 1;
  }

  rateLimit(n: GraphNode): number {
    return n.node.config.type === 'load-balancer' ? (n.node.config.rateLimitRps ?? 0) : 0;
  }
}

// ─── Reusable checks ─────────────────────────────────────────────────────────

/** Traffic enters through a load balancer, gateway or CDN, not straight into one server. */
export const hasEntryPoint = (g: Graph) => g.entryPath().some((n) => n.archetype !== 'dns');

/** Every service on the request path has at least two instances (serverless scales by itself). */
export const servicesRedundant = (g: Graph) => {
  const services = g.requestServices().filter((s) => s.archetype !== 'serverless-function');
  return services.length > 0 && services.every((s) => g.instances(s) >= 2);
};

/** Some service reads through a cache in front of a data store. */
export const cacheBeforeStore = (g: Graph) =>
  g.of(...SERVICES, 'worker').some((s) => {
    const t = g.targets(s.id);
    return t.some((x) => x.archetype === 'cache') && t.some((x) => STORES.includes(x.archetype));
  });

/** The main data store survives losing a machine: replicas, or a store that replicates by design. */
export const storeReplicated = (g: Graph) =>
  g.of(...PRIMARY_STORES).some((s) => s.archetype === 'wide-column-db' || g.replicas(s) >= 1);

/** Data is split across machines: shards, or a store that partitions by design. */
export const storeSharded = (g: Graph) => g.of(...PRIMARY_STORES).some((s) => s.archetype === 'wide-column-db' || g.shards(s) >= 2);

/** A CDN sits in front of users' requests. */
export const cdnInFront = (g: Graph) => g.entryPath().some((n) => n.archetype === 'cdn');

/** Media lives in object storage and is served through a CDN. */
export const mediaThroughCdn = (g: Graph) => g.linked(['cdn'], ['object-storage']);

/** Object storage is used for files. */
export const usesObjectStorage = (g: Graph) => g.has('object-storage') && g.sources(g.of('object-storage')[0]!.id).length > 0;

/** Slow work goes through a queue or stream to background consumers. */
export const queueToWorkers = (g: Graph) =>
  g.linked(SERVICES, QUEUES) && g.of(...QUEUES).some((q) => g.targets(q.id).some((t) => [...WORKERS, ...SERVICES].includes(t.archetype)));

/** An event stream (Kafka) feeds consumers. */
export const streamToConsumers = (g: Graph) =>
  g.of('event-stream').some((q) => g.sources(q.id).length > 0 && g.targets(q.id).some((t) => [...WORKERS, ...SERVICES].includes(t.archetype)));

/** A rate limit is set on the way in. */
export const rateLimited = (g: Graph) => g.entryPath().some((n) => g.rateLimit(n) > 0);

export const usesStore = (archetypes: Archetype[]) => (g: Graph) => g.linked([...SERVICES, 'worker'], archetypes);

export const usesTech = (...techIds: string[]) => (g: Graph) => g.nodes.some((n) => techIds.includes(n.technologyId) && g.sources(n.id).length > 0);

export const monitored = (g: Graph) => g.has('observability') && g.of('observability').some((o) => g.sources(o.id).length > 0);

export const usersReach = (archetypes: Archetype[]) => (g: Graph) =>
  g.of('client').some((c) => g.targets(c.id).some((t) => archetypes.includes(t.archetype)) || g.entryPath().some((r) => g.targets(r.id).some((t) => archetypes.includes(t.archetype))));
