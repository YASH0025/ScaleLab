import type {
  ApiFlow,
  ArchEdge,
  ArchNode,
  CacheConfig,
  ComputeConfig,
  Design,
  Distribution,
  FlowStep,
  LibraryEffect,
  LoadBalancerConfig,
  MetricsSample,
  NodeMetricsSample,
  RelationalDbConfig,
  RequestStatus,
  RequestTrace,
  TraceSpan,
  Workload,
} from '@scalelab/model';
import { EventQueue } from './event-queue';
import { Rng, sample } from './random';
import { type AcquireFailure, type Clock, type Lease, Resource, type ResourceSample } from './resource';
import { round, summarize } from './stats';
import { peakRate, rateAt } from './traffic';

// ─────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────

/** Failure injection and live changes, scheduled at a simulated time. */
export type ScheduledChange =
  | { atSec: number; nodeId: string; action: 'down' | 'up'; instance?: number }
  | { atSec: number; nodeId: string; action: 'latency'; extraLatencyMs: number };

export interface SimulationOptions {
  /** Record a full trace for every Nth request. Default 100. */
  traceEvery?: number;
  /** Maximum traces kept. Default 200. */
  maxTraces?: number;
  /** After traffic stops, how long in-flight requests may finish. Default 10 s. */
  drainSec?: number;
  changes?: ScheduledChange[];
  /** Resolves a library id to its simulation effect (usually from the catalog). */
  libraryEffect?: (libraryId: string) => LibraryEffect | undefined;
  /** Safety valve against runaway runs. Default 50 million events. */
  maxEvents?: number;
}

export interface InstanceSample {
  utilization: number;
  queueLength: number;
  up: boolean;
}

export interface EngineNodeSample extends NodeMetricsSample {
  /** Operations started on this node during the second. */
  servedPerSec: number;
  up: boolean;
  /** Per-instance detail for backends with several instances. */
  instances?: InstanceSample[];
}

export interface EngineMetricsSample extends MetricsSample {
  /** Requests that arrived during the second (offered load). */
  offeredRps: number;
  inFlight: number;
  nodes: EngineNodeSample[];
}

export interface NodeSummary {
  nodeId: string;
  avgUtilization: number;
  peakUtilization: number;
  maxQueueLength: number;
  avgWaitMs: number;
  served: number;
}

export interface SimulationTotals {
  arrivals: number;
  /** Requests that got an answer: ok + fallback. */
  completed: number;
  ok: number;
  fallbacks: number;
  rejected: number;
  timedOut: number;
  errors: number;
  retries: number;
  /** Still in flight when the drain window ended. */
  unfinished: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  meanMs: number;
  peakThroughputRps: number;
  /** Failed share of finished requests, 0..1. */
  errorRate: number;
}

export interface SimulationResult {
  timeline: EngineMetricsSample[];
  totals: SimulationTotals;
  nodes: NodeSummary[];
  traces: RequestTrace[];
  warnings: string[];
  eventsProcessed: number;
  simulatedMs: number;
}

// ─────────────────────────────────────────────────────────────
// Runtime model
// ─────────────────────────────────────────────────────────────

interface Base {
  node: ArchNode;
  extraLatencyMs: number;
  up: boolean;
}
type RuntimeNode =
  | (Base & { kind: 'client' })
  | (Base & { kind: 'lb'; config: LoadBalancerConfig; rr: number })
  | (Base & { kind: 'compute'; config: ComputeConfig; instances: Resource[]; overheadMs: number; auth: Distribution[] })
  | (Base & { kind: 'cache'; config: CacheConfig; pool: Resource; hits: number; misses: number })
  | (Base & { kind: 'db'; config: RelationalDbConfig; primary: Resource; replicas: Resource[] })
  | (Base & { kind: 'passthrough' });

interface PreparedFlow {
  flow: ApiFlow;
  weight: number;
  clientId: string | undefined;
  /** First backend the flow calls; the load balancer picks an instance of it. */
  firstCompute: string | undefined;
}

interface Req {
  id: number;
  flow: PreparedFlow;
  startMs: number;
  attempt: number;
  traced: boolean;
  spans: TraceSpan[];
}

interface Attempt {
  req: Req;
  dead: boolean;
  leases: Lease[];
  held: Map<string, Lease>;
  preferred: Map<string, Resource>;
  location: string;
  path: string[];
  httpStatus: number;
}

interface Bucket {
  arrivals: number;
  ok: number;
  fallbacks: number;
  failed: number;
  latencies: number[];
}

const FAILURE_STATUS: Record<AcquireFailure, { status: RequestStatus; http: number }> = {
  rejected: { status: 'rejected', http: 503 },
  timeout: { status: 'timeout', http: 504 },
  down: { status: 'error', http: 503 },
};

/**
 * Runs a design under a workload as a discrete-event simulation.
 *
 * Model in one paragraph: requests arrive as a (possibly time-varying) Poisson stream.
 * Each one follows its API flow. A backend worker is held from the moment the request
 * reaches the backend until the response is sent (thread-per-request), so slow
 * dependencies back up the backend too. Caches, databases and backend workers are pools
 * of slots with FIFO queues; when every slot is busy, requests wait, get rejected when the
 * queue is full, or time out. Nothing is scripted: bottlenecks emerge from these rules.
 */
export class Simulation implements Clock {
  private readonly events = new EventQueue();
  private readonly arrivalRng: Rng;
  private readonly serviceRng: Rng;
  private readonly nodes = new Map<string, RuntimeNode>();
  private readonly edges = new Map<string, ArchEdge>();
  private readonly flows: PreparedFlow[] = [];
  private readonly totalWeight: number;
  private readonly durationMs: number;
  private readonly endMs: number;
  private readonly peakRps: number;
  private readonly pattern: Workload['pattern'];
  private readonly options: Required<Omit<SimulationOptions, 'libraryEffect' | 'changes'>>;
  private readonly warnings = new Set<string>();

  private clock = 0;
  private nextRequestId = 0;
  private inFlight = 0;
  private eventsProcessed = 0;
  private finished = false;

  private readonly buckets: Bucket[] = [];
  private readonly timeline: EngineMetricsSample[] = [];
  private readonly traces: RequestTrace[] = [];
  private readonly servedCounts = new Map<Resource, number>();
  private readonly nodeAgg = new Map<string, { utilSum: number; utilPeak: number; maxQueue: number; waitSum: number; waitCount: number; served: number; samples: number }>();
  private readonly totals = {
    arrivals: 0,
    ok: 0,
    fallbacks: 0,
    rejected: 0,
    timedOut: 0,
    errors: 0,
    retries: 0,
  };
  private readonly successLatencies: number[] = [];

  constructor(design: Design, workload: Workload, options: SimulationOptions = {}) {
    this.options = {
      traceEvery: options.traceEvery ?? 100,
      maxTraces: options.maxTraces ?? 200,
      drainSec: options.drainSec ?? 10,
      maxEvents: options.maxEvents ?? 50_000_000,
    };
    this.arrivalRng = new Rng(workload.seed);
    this.serviceRng = new Rng((workload.seed ^ 0x5bd1e995) >>> 0);
    this.durationMs = workload.durationSec * 1000;
    this.endMs = this.durationMs + this.options.drainSec * 1000;
    this.peakRps = peakRate(workload.pattern);
    this.pattern = workload.pattern;

    for (const edge of design.edges) this.edges.set(`${edge.source}|${edge.target}`, edge);
    for (const node of design.nodes) this.nodes.set(node.id, this.buildRuntime(node, options.libraryEffect));

    const flowsById = new Map(design.flows.map((f) => [f.id, f]));
    for (const entry of workload.mix) {
      const flow = flowsById.get(entry.flowId);
      if (!flow) throw new Error(`Workload "${workload.name}" uses unknown flow "${entry.flowId}".`);
      this.assertNodes(flow);
      this.flows.push({
        flow,
        weight: entry.weight,
        clientId: this.findClient(flow.entryNodeId),
        firstCompute: this.firstCompute(flow),
      });
    }
    this.totalWeight = this.flows.reduce((sum, f) => sum + f.weight, 0);

    for (const change of options.changes ?? []) {
      this.events.push(change.atSec * 1000, () => this.applyChange(change));
    }
    if (this.peakRps > 0) this.scheduleNextArrival();
    this.events.push(1000, () => this.sampleSecond());
  }

  // ── Clock ──────────────────────────────────────────────────

  now(): number {
    return this.clock;
  }

  schedule(delayMs: number, fn: () => void): void {
    this.events.push(this.clock + Math.max(0, delayMs), fn);
  }

  // ── Running ────────────────────────────────────────────────

  get done(): boolean {
    return this.finished;
  }

  get currentTimeMs(): number {
    return this.clock;
  }

  /** Latest per-second sample, for live UI updates. */
  get latestSample(): EngineMetricsSample | undefined {
    return this.timeline[this.timeline.length - 1];
  }

  /** Advances the simulation up to `untilMs` of simulated time. Returns true when finished. */
  runUntil(untilMs: number): boolean {
    while (!this.finished) {
      const next = this.events.peekTime();
      if (next === undefined || next > this.endMs) {
        this.finished = true;
        break;
      }
      if (next > untilMs) break;
      const entry = this.events.pop()!;
      this.clock = entry.time;
      entry.fn();
      if (++this.eventsProcessed >= this.options.maxEvents) {
        this.warnings.add(`Stopped after ${this.options.maxEvents.toLocaleString()} events.`);
        this.finished = true;
      }
    }
    return this.finished;
  }

  run(): SimulationResult {
    this.runUntil(Number.POSITIVE_INFINITY);
    return this.result();
  }

  result(): SimulationResult {
    const latency = summarize(this.successLatencies);
    const finishedCount =
      this.totals.ok + this.totals.fallbacks + this.totals.rejected + this.totals.timedOut + this.totals.errors;
    const failed = this.totals.rejected + this.totals.timedOut + this.totals.errors;
    return {
      timeline: this.timeline,
      totals: {
        ...this.totals,
        completed: this.totals.ok + this.totals.fallbacks,
        unfinished: this.inFlight,
        p50Ms: round(latency.p50),
        p95Ms: round(latency.p95),
        p99Ms: round(latency.p99),
        meanMs: round(latency.mean),
        peakThroughputRps: this.timeline.reduce((max, s) => Math.max(max, s.throughputRps), 0),
        errorRate: finishedCount === 0 ? 0 : round(failed / finishedCount, 4),
      },
      nodes: [...this.nodeAgg.entries()].map(([nodeId, a]) => ({
        nodeId,
        avgUtilization: a.samples === 0 ? 0 : round(a.utilSum / a.samples, 3),
        peakUtilization: round(a.utilPeak, 3),
        maxQueueLength: a.maxQueue,
        avgWaitMs: a.waitCount === 0 ? 0 : round(a.waitSum / a.waitCount),
        served: a.served,
      })),
      traces: this.traces,
      warnings: [...this.warnings],
      eventsProcessed: this.eventsProcessed,
      simulatedMs: this.clock,
    };
  }

  // ── Setup ──────────────────────────────────────────────────

  private buildRuntime(node: ArchNode, libraryEffect: SimulationOptions['libraryEffect']): RuntimeNode {
    const c = node.config;
    const base = { node, extraLatencyMs: c.extraLatencyMs, up: c.available };
    const pool = (suffix: string, capacity: number, queueLimit: number, timeoutMs: number): Resource => {
      const r = new Resource(`${node.id}${suffix}`, capacity, queueLimit, timeoutMs, this);
      if (!c.available) r.takeDown();
      return r;
    };
    switch (c.type) {
      case 'client':
        return { ...base, kind: 'client' };
      case 'load-balancer':
        return { ...base, kind: 'lb', config: c, rr: 0 };
      case 'compute': {
        let overheadMs = 0;
        const auth: Distribution[] = [];
        for (const lib of node.libraries) {
          const effect = libraryEffect?.(lib.libraryId);
          if (effect?.kind === 'add-overhead') overheadMs += effect.perRequestMs;
          if (effect?.kind === 'auth-step') auth.push(effect.latency);
        }
        const instances = Array.from({ length: c.instances }, (_, i) =>
          pool(`#${i + 1}`, c.workersPerInstance, c.queueLimit, c.timeoutMs),
        );
        return { ...base, kind: 'compute', config: c, instances, overheadMs, auth };
      }
      case 'cache':
        return {
          ...base,
          kind: 'cache',
          config: c,
          pool: pool('', c.maxConnections, c.maxConnections * 10, 1000),
          hits: 0,
          misses: 0,
        };
      case 'relational-db':
        return {
          ...base,
          kind: 'db',
          config: c,
          primary: pool('', c.connectionPool, c.queueLimit, c.timeoutMs),
          replicas: Array.from({ length: c.readReplicas }, (_, i) =>
            pool(`/replica-${i + 1}`, c.connectionPool, c.queueLimit, c.timeoutMs),
          ),
        };
      case 'generic':
        return { ...base, kind: 'passthrough' };
    }
  }

  private assertNodes(flow: ApiFlow): void {
    const missing: string[] = [];
    const visit = (steps: FlowStep[]) => {
      for (const s of steps) {
        if (s.kind === 'call' || s.kind === 'publish') {
          if (!this.nodes.has(s.nodeId)) missing.push(s.nodeId);
        } else if (s.kind === 'cache-lookup') {
          if (!this.nodes.has(s.cacheNodeId)) missing.push(s.cacheNodeId);
          visit(s.onHit);
          visit(s.onMiss);
        } else if (s.kind === 'parallel') {
          s.branches.forEach(visit);
        }
      }
    };
    if (!this.nodes.has(flow.entryNodeId)) missing.push(flow.entryNodeId);
    visit(flow.steps);
    if (missing.length > 0) throw new Error(`Flow "${flow.name}" uses unknown nodes: ${missing.join(', ')}.`);
  }

  private findClient(entryId: string): string | undefined {
    for (const edge of this.edges.values()) {
      if (edge.target === entryId && this.nodes.get(edge.source)?.kind === 'client') return edge.source;
    }
    return undefined;
  }

  private firstCompute(flow: ApiFlow): string | undefined {
    if (this.nodes.get(flow.entryNodeId)?.kind === 'compute') return flow.entryNodeId;
    const find = (steps: FlowStep[]): string | undefined => {
      for (const s of steps) {
        if (s.kind === 'call' && this.nodes.get(s.nodeId)?.kind === 'compute') return s.nodeId;
        if (s.kind === 'cache-lookup') return undefined; // a cache step before any backend call
      }
      return undefined;
    };
    return find(flow.steps);
  }

  // ── Traffic ────────────────────────────────────────────────

  /** Non-homogeneous Poisson arrivals via thinning. */
  private scheduleNextArrival(): void {
    const gapMs = this.arrivalRng.exponential(1000 / this.peakRps);
    const at = this.clock + gapMs;
    if (at >= this.durationMs) return;
    this.events.push(at, () => {
      const rate = rateAt(this.pattern, this.clock / 1000, this.durationMs / 1000);
      if (this.arrivalRng.next() * this.peakRps < rate) this.startRequest(this.pickFlow());
      this.scheduleNextArrival();
    });
  }

  private pickFlow(): PreparedFlow {
    let r = this.arrivalRng.next() * this.totalWeight;
    for (const f of this.flows) {
      r -= f.weight;
      if (r < 0) return f;
    }
    return this.flows[this.flows.length - 1]!;
  }

  // ── Requests ───────────────────────────────────────────────

  private startRequest(flow: PreparedFlow): void {
    const id = this.nextRequestId++;
    const req: Req = {
      id,
      flow,
      startMs: this.clock,
      attempt: 0,
      traced: id % this.options.traceEvery === 0 && this.traces.length < this.options.maxTraces,
      spans: [],
    };
    this.totals.arrivals++;
    this.bucket(this.clock).arrivals++;
    this.inFlight++;
    this.startAttempt(req);
  }

  private startAttempt(req: Req): void {
    const entry = req.flow.flow.entryNodeId;
    const att: Attempt = {
      req,
      dead: false,
      leases: [],
      held: new Map(),
      preferred: new Map(),
      location: req.flow.clientId ?? entry,
      path: req.flow.clientId ? [req.flow.clientId] : [],
      httpStatus: 200,
    };
    const hop = req.flow.clientId ? this.hopLatency(req.flow.clientId, entry) : 0;
    this.schedule(hop, () => this.arriveAtEntry(att));
  }

  private arriveAtEntry(att: Attempt): void {
    const flow = att.req.flow;
    const entry = this.nodes.get(flow.flow.entryNodeId)!;
    const steps = flow.flow.steps;
    const proceed = () => this.runSteps(att, steps, 0, () => this.complete(att));

    if (entry.kind === 'lb') {
      att.location = entry.node.id;
      att.path.push(entry.node.id);
      if (!entry.up) return this.fail(att, 'error', 503, entry.node.id);
      const overhead = sample(this.serviceRng, entry.config.overhead) + entry.extraLatencyMs;
      this.span(att, entry.node.id, 0, overhead, 'complete');
      this.schedule(overhead, () => {
        if (att.dead) return;
        if (flow.firstCompute) {
          const target = this.nodes.get(flow.firstCompute);
          if (target?.kind === 'compute') {
            const chosen = this.chooseInstance(target.instances, entry);
            if (!chosen) return this.fail(att, 'rejected', 503, entry.node.id);
            att.preferred.set(target.node.id, chosen);
          }
        }
        proceed();
      });
      return;
    }
    if (entry.kind === 'compute') {
      return this.touch(att, entry.node.id, proceed);
    }
    att.location = entry.node.id;
    proceed();
  }

  private runSteps(att: Attempt, steps: FlowStep[], index: number, done: () => void): void {
    if (att.dead) return;
    if (index >= steps.length) return done();
    this.runStep(att, steps[index]!, () => this.runSteps(att, steps, index + 1, done));
  }

  private runStep(att: Attempt, step: FlowStep, next: () => void): void {
    switch (step.kind) {
      case 'respond':
        att.httpStatus = step.status;
        return next();
      case 'call':
        return this.call(att, step.nodeId, step.operation, next);
      case 'cache-lookup':
        return this.cacheLookup(att, step, next);
      case 'parallel': {
        let remaining = step.branches.length;
        if (remaining === 0) return next();
        for (const branch of step.branches) {
          this.runSteps(att, branch, 0, () => {
            if (--remaining === 0 && !att.dead) next();
          });
        }
        return;
      }
      case 'publish': {
        this.warnings.add('Publishing to queues and streams is not simulated yet; it only adds network latency.');
        const lat = this.hopLatency(att.location, step.nodeId);
        return this.schedule(lat, () => this.continueIfAlive(att, next));
      }
    }
  }

  private call(att: Attempt, nodeId: string, operation: 'read' | 'write' | 'process', next: () => void): void {
    const node = this.nodes.get(nodeId)!;
    switch (node.kind) {
      case 'compute':
        return this.touch(att, nodeId, () => {
          let workMs = sample(this.serviceRng, node.config.serviceTime) + node.overheadMs + node.extraLatencyMs;
          for (const auth of node.auth) workMs += sample(this.serviceRng, auth);
          this.span(att, nodeId, 0, workMs, 'complete');
          this.schedule(workMs, () => this.continueIfAlive(att, next));
        });
      case 'cache': {
        const dist = operation === 'write' ? node.config.writeLatency : node.config.readLatency;
        return this.remoteOp(att, node, node.pool, dist, next, (reason) => this.failFromAcquire(att, reason, nodeId));
      }
      case 'db': {
        const target = operation === 'write' ? node.primary : this.pickReadReplica(node);
        const dist = operation === 'write' ? node.config.writeQuery : node.config.readQuery;
        return this.remoteOp(att, node, target, dist, next, (reason) => this.failFromAcquire(att, reason, nodeId));
      }
      case 'passthrough': {
        this.warnings.add(`"${node.node.label}" is not simulated yet; it only adds network latency.`);
        const lat = this.hopLatency(att.location, nodeId) * 2;
        return this.schedule(lat, () => this.continueIfAlive(att, next));
      }
      case 'client':
      case 'lb':
        return next();
    }
  }

  private cacheLookup(att: Attempt, step: Extract<FlowStep, { kind: 'cache-lookup' }>, next: () => void): void {
    const node = this.nodes.get(step.cacheNodeId)!;
    if (node.kind !== 'cache') {
      this.warnings.add(`Cache lookup on "${node.node.label}", which is not a cache; treated as a miss.`);
      return this.runSteps(att, step.onMiss, 0, next);
    }
    // A cache that is down or overloaded degrades to a miss instead of failing the request.
    const asMiss = () => {
      node.misses++;
      this.runSteps(att, step.onMiss, 0, next);
    };
    if (!node.pool.up) {
      this.span(att, node.node.id, 0, 0, 'failed');
      return asMiss();
    }
    this.remoteOp(
      att,
      node,
      node.pool,
      node.config.readLatency,
      () => {
        if (this.serviceRng.next() < node.config.hitRatio) {
          node.hits++;
          this.markLastSpan(att, 'cache-hit');
          this.runSteps(att, step.onHit, 0, next);
        } else {
          node.misses++;
          this.markLastSpan(att, 'cache-miss');
          this.runSteps(att, step.onMiss, 0, () => {
            if (!step.writeBackOnMiss || !node.pool.up) return next();
            this.remoteOp(att, node, node.pool, node.config.writeLatency, next, () => next());
          });
        }
      },
      () => asMiss(),
    );
  }

  /** Ensures the attempt holds a worker on a backend, moving there over the network. */
  private touch(att: Attempt, nodeId: string, cont: () => void): void {
    if (att.held.has(nodeId)) return cont();
    const node = this.nodes.get(nodeId);
    if (node?.kind !== 'compute') return cont();
    const instance = att.preferred.get(nodeId) ?? this.chooseInstance(node.instances);
    if (!instance) return this.fail(att, 'rejected', 503, nodeId);
    const from = att.location;
    const lat = from === nodeId ? 0 : this.hopLatency(from, nodeId);
    this.schedule(lat, () => {
      if (att.dead) return;
      const requestedAt = this.clock;
      instance.acquire(
        (lease, waitMs) => {
          this.countServed(instance);
          if (att.dead) return instance.release(lease);
          att.held.set(nodeId, lease);
          att.leases.push(lease);
          att.location = nodeId;
          att.path.push(nodeId);
          this.span(att, instance.id, waitMs, 0, 'complete', requestedAt);
          cont();
        },
        (reason) => this.failFromAcquire(att, reason, instance.id),
      );
    });
  }

  /** A round trip to a cache or database: travel, wait for a slot, work, travel back. */
  private remoteOp(
    att: Attempt,
    node: RuntimeNode,
    resource: Resource,
    dist: Distribution,
    next: () => void,
    onFail: (reason: AcquireFailure) => void,
  ): void {
    const from = att.location;
    const nodeId = node.node.id;
    this.schedule(this.hopLatency(from, nodeId), () => {
      if (att.dead) return;
      const requestedAt = this.clock;
      resource.acquire(
        (lease, waitMs) => {
          this.countServed(resource);
          if (att.dead) return resource.release(lease);
          const workMs = sample(this.serviceRng, dist) + node.extraLatencyMs;
          this.span(att, resource.id, waitMs, workMs, 'complete', requestedAt);
          this.schedule(workMs, () => {
            if (!resource.isLive(lease)) {
              if (att.dead) return;
              return this.fail(att, 'error', 502, resource.id);
            }
            resource.release(lease);
            if (att.dead) return;
            this.schedule(this.hopLatency(nodeId, from), () => this.continueIfAlive(att, next));
          });
        },
        (reason) => {
          if (!att.dead) onFail(reason);
        },
      );
    });
  }

  private continueIfAlive(att: Attempt, next: () => void): void {
    if (att.dead) return;
    for (const lease of att.leases) {
      if (!lease.resource.isLive(lease)) return this.fail(att, 'error', 502, lease.resource.id);
    }
    next();
  }

  private chooseInstance(instances: Resource[], lb?: Extract<RuntimeNode, { kind: 'lb' }>): Resource | undefined {
    const live = instances.filter((r) => r.up);
    if (live.length === 0) return undefined;
    const strategy = lb?.config.strategy ?? 'least-connections';
    if (strategy === 'round-robin' && lb) return live[lb.rr++ % live.length];
    if (strategy === 'random') return live[Math.floor(this.serviceRng.next() * live.length)];
    let best = live[0]!;
    for (const r of live) {
      if (r.inUse + r.queueLength < best.inUse + best.queueLength) best = r;
    }
    return best;
  }

  private pickReadReplica(node: Extract<RuntimeNode, { kind: 'db' }>): Resource {
    let best = node.primary;
    for (const r of node.replicas) {
      if (!r.up) continue;
      if (!best.up || r.inUse + r.queueLength < best.inUse + best.queueLength) best = r;
    }
    return best;
  }

  // ── Finishing ──────────────────────────────────────────────

  private complete(att: Attempt): void {
    if (att.dead) return;
    att.dead = true;
    this.releaseAll(att);
    let back = 0;
    for (let i = att.path.length - 1; i > 0; i--) back += this.hopLatency(att.path[i]!, att.path[i - 1]!);
    this.schedule(back, () => {
      const status: RequestStatus = att.httpStatus >= 500 ? 'error' : 'ok';
      this.finish(att.req, status, att.httpStatus);
    });
  }

  private failFromAcquire(att: Attempt, reason: AcquireFailure, where: string): void {
    const { status, http } = FAILURE_STATUS[reason];
    this.fail(att, status, http, where);
  }

  private fail(att: Attempt, status: RequestStatus, http: number, where: string): void {
    if (att.dead) return;
    att.dead = true;
    this.releaseAll(att);
    const req = att.req;
    if (req.traced) req.spans.push({ nodeId: where, startMs: this.clock - req.startMs, waitMs: 0, serviceMs: 0, outcome: status === 'timeout' ? 'timeout' : status === 'rejected' ? 'rejected' : 'failed' });
    const flow = req.flow.flow;
    if (req.attempt < flow.retry.attempts) {
      req.attempt++;
      this.totals.retries++;
      this.schedule(flow.retry.backoffMs, () => this.startAttempt(req));
      return;
    }
    if (flow.fallback && att.path.some((id) => this.nodes.get(id)?.kind === 'compute')) {
      return this.finish(req, 'fallback', flow.fallback.status);
    }
    this.finish(req, status, http);
  }

  private releaseAll(att: Attempt): void {
    for (const lease of att.leases) lease.resource.release(lease);
    att.leases = [];
    att.held.clear();
  }

  private finish(req: Req, status: RequestStatus, http: number): void {
    this.inFlight--;
    const latency = this.clock - req.startMs;
    const bucket = this.bucket(this.clock);
    switch (status) {
      case 'ok':
        this.totals.ok++;
        bucket.ok++;
        break;
      case 'fallback':
        this.totals.fallbacks++;
        bucket.fallbacks++;
        break;
      case 'rejected':
        this.totals.rejected++;
        bucket.failed++;
        break;
      case 'timeout':
        this.totals.timedOut++;
        bucket.failed++;
        break;
      case 'error':
        this.totals.errors++;
        bucket.failed++;
        break;
    }
    if (status === 'ok' || status === 'fallback') {
      bucket.latencies.push(latency);
      this.successLatencies.push(latency);
    }
    if (req.traced) {
      this.traces.push({
        requestId: `r${req.id}`,
        flowId: req.flow.flow.id,
        startMs: round(req.startMs, 2),
        totalMs: round(latency, 2),
        status,
        httpStatus: http,
        spans: req.spans,
      });
    }
  }

  // ── Changes (failure injection) ────────────────────────────

  private applyChange(change: ScheduledChange): void {
    const node = this.nodes.get(change.nodeId);
    if (!node) {
      this.warnings.add(`Change targets unknown node "${change.nodeId}".`);
      return;
    }
    if (change.action === 'latency') {
      node.extraLatencyMs = change.extraLatencyMs;
      return;
    }
    const resources = this.resourcesOf(node);
    const targets =
      change.instance !== undefined && node.kind === 'compute'
        ? node.instances.slice(change.instance, change.instance + 1)
        : resources;
    for (const r of targets) {
      if (change.action === 'down') r.takeDown();
      else r.bringUp();
    }
    if (change.instance === undefined) node.up = change.action === 'up';
  }

  private resourcesOf(node: RuntimeNode): Resource[] {
    switch (node.kind) {
      case 'compute':
        return node.instances;
      case 'cache':
        return [node.pool];
      case 'db':
        return [node.primary, ...node.replicas];
      default:
        return [];
    }
  }

  // ── Metrics ────────────────────────────────────────────────

  private bucket(timeMs: number): Bucket {
    const index = Math.floor(timeMs / 1000);
    while (this.buckets.length <= index) {
      this.buckets.push({ arrivals: 0, ok: 0, fallbacks: 0, failed: 0, latencies: [] });
    }
    return this.buckets[index]!;
  }

  private countServed(resource: Resource): void {
    this.servedCounts.set(resource, (this.servedCounts.get(resource) ?? 0) + 1);
  }

  private sampleSecond(): void {
    const second = Math.round(this.clock / 1000);
    const bucket = this.bucket(this.clock - 1);
    const lat = summarize(bucket.latencies);
    const finished = bucket.ok + bucket.fallbacks + bucket.failed;
    const nodes: EngineNodeSample[] = [];

    for (const node of this.nodes.values()) {
      const resources = this.resourcesOf(node);
      if (resources.length === 0) continue;
      const samples: ResourceSample[] = resources.map((r) => r.sample());
      let busy = 0;
      let cap = 0;
      let queue = 0;
      let waitSum = 0;
      let waitCount = 0;
      let served = 0;
      for (let i = 0; i < resources.length; i++) {
        const s = samples[i]!;
        busy += s.busyMs;
        if (s.up) cap += s.capacity;
        queue += s.queueLength;
        waitSum += s.waitSumMs;
        waitCount += s.waitCount;
        served += this.servedCounts.get(resources[i]!) ?? 0;
        this.servedCounts.set(resources[i]!, 0);
      }
      const utilization = cap === 0 ? 0 : Math.min(1, busy / (cap * 1000));
      const sampleOut: EngineNodeSample = {
        nodeId: node.node.id,
        utilization: round(utilization, 3),
        queueLength: queue,
        avgWaitMs: waitCount === 0 ? 0 : round(waitSum / waitCount),
        servedPerSec: served,
        up: samples.some((s) => s.up),
      };
      if (node.kind === 'compute' && resources.length > 1) {
        sampleOut.instances = samples.map((s) => ({
          utilization: s.up ? round(Math.min(1, s.busyMs / (s.capacity * 1000)), 3) : 0,
          queueLength: s.queueLength,
          up: s.up,
        }));
      }
      if (node.kind === 'cache') {
        const lookups = node.hits + node.misses;
        if (lookups > 0) sampleOut.observedHitRatio = round(node.hits / lookups, 3);
        node.hits = 0;
        node.misses = 0;
      }
      nodes.push(sampleOut);

      const agg = this.nodeAgg.get(node.node.id) ?? { utilSum: 0, utilPeak: 0, maxQueue: 0, waitSum: 0, waitCount: 0, served: 0, samples: 0 };
      agg.utilSum += utilization;
      agg.utilPeak = Math.max(agg.utilPeak, utilization);
      agg.maxQueue = Math.max(agg.maxQueue, queue);
      agg.waitSum += waitSum;
      agg.waitCount += waitCount;
      agg.served += served;
      agg.samples++;
      this.nodeAgg.set(node.node.id, agg);
    }

    this.timeline.push({
      simTimeSec: second,
      offeredRps: bucket.arrivals,
      throughputRps: bucket.ok + bucket.fallbacks,
      p50Ms: round(lat.p50),
      p95Ms: round(lat.p95),
      p99Ms: round(lat.p99),
      errorRate: finished === 0 ? 0 : round(bucket.failed / finished, 4),
      inFlight: this.inFlight,
      nodes,
    });

    const trafficOver = this.clock >= this.durationMs;
    if (!trafficOver || this.inFlight > 0) {
      if (this.clock + 1000 <= this.endMs) this.events.push(this.clock + 1000, () => this.sampleSecond());
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  private hopLatency(from: string, to: string): number {
    if (from === to) return 0;
    const edge = this.edges.get(`${from}|${to}`) ?? this.edges.get(`${to}|${from}`);
    return edge ? sample(this.serviceRng, edge.networkLatency) : 0;
  }

  private span(
    att: Attempt,
    nodeId: string,
    waitMs: number,
    serviceMs: number,
    outcome: TraceSpan['outcome'],
    requestedAt = this.clock,
  ): void {
    const req = att.req;
    if (!req.traced) return;
    req.spans.push({
      nodeId,
      startMs: round(requestedAt - req.startMs, 2),
      waitMs: round(waitMs, 2),
      serviceMs: round(serviceMs, 2),
      outcome,
    });
  }

  private markLastSpan(att: Attempt, outcome: TraceSpan['outcome']): void {
    const last = att.req.spans[att.req.spans.length - 1];
    if (att.req.traced && last) last.outcome = outcome;
  }
}

/** Runs a whole simulation in one call. */
export function simulate(design: Design, workload: Workload, options?: SimulationOptions): SimulationResult {
  return createSimulation(design, workload, options).run();
}

/** Creates a simulation you can advance step by step (e.g. from a Web Worker). */
export function createSimulation(design: Design, workload: Workload, options?: SimulationOptions): Simulation {
  return new Simulation(design, workload, options);
}
