import { PRICING_NOTE, getLibrary, getTechnology, resolveArchetype } from '@scalelab/catalog';
import { simulate } from '@scalelab/engine';
import { type ArchEdge, type ArchNode, type Archetype, type ArchetypeConfig, type Design, deriveFlows, derivedMix } from '@scalelab/model';
import { type CostEstimate, databaseSizeSteps, estimateCost, formatUsd } from './cost';

export interface PlanTarget {
  /** Sustained requests per second the design must handle. */
  rps: number;
  /** 95th-percentile latency budget. */
  p95Ms: number;
  /** Highest acceptable share of failed requests, 0..1. */
  maxErrorRate: number;
  /** Highest acceptable consumer lag on queues and streams. */
  maxLagMs: number;
  /**
   * Headroom: the busiest component may be at most this busy (0..1) at the target load,
   * so a traffic bump or a slow query doesn't tip it over. Default 0.8.
   */
  maxUtilization?: number;
}

export interface PlanProgress {
  evaluations: number;
  maxEvaluations: number;
  message: string;
}

export interface PlanOptions {
  /** Simulated seconds per candidate. The second half is measured. Default 16. */
  evalDurationSec?: number;
  /** Most simulations to run before giving up. Default 40. */
  maxEvaluations?: number;
  seed?: number;
  onProgress?: (progress: PlanProgress) => void;
}

export type Knob = 'instances' | 'readReplicas' | 'connectionPool' | 'maxConnections' | 'partitions';

export interface PlanChange {
  nodeId: string;
  label: string;
  knob: Knob;
  from: number;
  to: number;
}

export interface Evaluation {
  p95Ms: number;
  errorRate: number;
  /** Highest consumer lag across queues at the end of the run. */
  lagMs: number;
  /** The busiest component's average utilization, 0..1 (queues excluded). */
  peakUtilization: number;
  /** Which component that is. */
  busiestNodeId: string | undefined;
  meets: boolean;
  /** 0 when every target is met; grows with how far off the design is. */
  violation: number;
  cost: CostEstimate;
  /** Per node: utilization, or lag relative to the budget for queues. ≥ 1 means over the limit. */
  pressure: Record<string, number>;
}

export type PlanStatus =
  /** The design missed the targets; the planner found a setup that meets them. */
  | 'met'
  /** The design already met the targets; the planner found a cheaper setup that still does. */
  | 'right-sized'
  /** The design already met the targets and nothing could be removed. */
  | 'already-optimal'
  /** No combination of the planner's knobs met the targets. */
  | 'unreachable'
  /** The design can't receive traffic yet (no client, no backend). */
  | 'no-traffic';

export interface PlanResult {
  status: PlanStatus;
  nodes: ArchNode[];
  changes: PlanChange[];
  before: Evaluation | undefined;
  after: Evaluation | undefined;
  evaluations: number;
  notes: string[];
}

/**
 * How deep a component sits in the request path. Saturation deeper down is the cause;
 * services above it only look busy because they wait.
 */
const DEPTH: Partial<Record<Archetype, number>> = {
  'load-balancer': 1,
  'compute-service': 2,
  worker: 2,
  'message-queue': 2.5,
  'event-stream': 2.5,
  cache: 3,
  'relational-db': 3,
};
const HOT = 0.85;
const DEFAULT_MAX_UTILIZATION = 0.8;
const LIMITS: Record<Knob, number> = { instances: 64, readReplicas: 5, connectionPool: 1600, maxConnections: 65_000, partitions: 512 };

const libraryEffect = (id: string) => getLibrary(id)?.effect;
const archetypeOf = (node: ArchNode) => getTechnology(node.technologyId)?.archetype;
const knobOf = (node: ArchNode, knob: Knob) => (node.config as Record<string, unknown>)[knob] as number | undefined;

function withKnob(nodes: ArchNode[], nodeId: string, knob: Knob, value: number): ArchNode[] {
  return nodes.map((n) => (n.id === nodeId ? { ...n, config: { ...n.config, [knob]: value } as ArchetypeConfig } : n));
}

const KNOB_LABEL: Record<Knob, string> = {
  instances: 'instances',
  readReplicas: 'read replicas',
  connectionPool: 'concurrent queries',
  maxConnections: 'max connections',
  partitions: 'partitions',
};

interface Step {
  nodeId: string;
  knob: Knob;
  to: number;
}
/** One candidate change; some fixes need two knobs turned together. */
type Move = Step[];

function step(node: ArchNode, knob: Knob, to: number): Step | undefined {
  const from = knobOf(node, knob);
  return from !== undefined && to > from && to <= LIMITS[knob] ? { nodeId: node.id, knob, to } : undefined;
}

const moreInstances = (node: ArchNode) =>
  node.config.type === 'compute' ? step(node, 'instances', Math.max(node.config.instances + 1, Math.ceil(node.config.instances * 1.5))) : undefined;

/** Ways to give a component more capacity. */
function growMoves(node: ArchNode, nodes: ArchNode[], edges: ArchEdge[]): Move[] {
  const c = node.config;
  const moves: Array<Move | undefined> = [];
  const one = (s: Step | undefined) => moves.push(s ? [s] : undefined);
  switch (c.type) {
    case 'compute':
      one(moreInstances(node));
      break;
    case 'relational-db':
      one(step(node, 'readReplicas', c.readReplicas + 1));
      one(step(node, 'connectionPool', c.connectionPool * 2));
      break;
    case 'cache':
      one(step(node, 'maxConnections', c.maxConnections * 2));
      break;
    case 'queue': {
      const consumers = edges
        .filter((e) => e.source === node.id)
        .map((e) => nodes.find((n) => n.id === e.target))
        .filter((n): n is ArchNode => n?.config.type === 'compute');
      const partitions = c.fanOut && c.partitions > 0 ? c.partitions * 2 : undefined;
      if (partitions !== undefined) one(step(node, 'partitions', partitions));
      for (const consumer of consumers) {
        if (consumer.config.type !== 'compute') continue;
        // Falling behind usually needs more consumers; with a partition cap, more partitions too.
        const scaleConsumer = moreInstances(consumer);
        if (partitions !== undefined) {
          const needed = Math.ceil(partitions / consumer.config.workersPerInstance);
          const p = step(node, 'partitions', partitions);
          const w = step(consumer, 'instances', Math.max(needed, consumer.config.instances + 1));
          if (p && w) moves.push([p, w]);
        } else {
          one(scaleConsumer);
        }
      }
      break;
    }
    default:
      break;
  }
  return moves.filter((m): m is Move => m !== undefined);
}

function applyMove(nodes: ArchNode[], move: Move): ArchNode[] {
  return move.reduce((acc, s) => withKnob(acc, s.nodeId, s.knob, s.to), nodes);
}

/** Ways to remove capacity that costs money. `floor` keeps redundancy the design already had. */
function shrinkMoves(node: ArchNode, original: ArchNode | undefined): Array<{ knob: Knob; to: number }> {
  const c = node.config;
  const moves: Array<{ knob: Knob; to: number }> = [];
  if (c.type === 'compute') {
    const floor = original?.config.type === 'compute' && original.config.instances >= 2 ? 2 : 1;
    if (c.instances >= floor * 2 + 2) moves.push({ knob: 'instances', to: Math.max(floor, Math.floor(c.instances / 2)) });
    if (c.instances > floor) moves.push({ knob: 'instances', to: c.instances - 1 });
  }
  if (c.type === 'relational-db') {
    if (c.readReplicas > 0) moves.push({ knob: 'readReplicas', to: c.readReplicas - 1 });
    const pricing = getTechnology(node.technologyId)?.pricing;
    if (pricing?.kind === 'database') {
      const steps = databaseSizeSteps(c.connectionPool, pricing.queriesPerUnit);
      if (steps > 0) moves.push({ knob: 'connectionPool', to: pricing.queriesPerUnit * 2 ** (steps - 1) });
    }
  }
  return moves;
}

/**
 * Finds the cheapest setup that meets the targets, by simulating candidates the way
 * an engineer would: scale up the component closest to the root cause, keep the change
 * that helps most per dollar, repeat; then take away anything that isn't needed.
 *
 * It changes capacity only (instances, replicas, database size, partitions). It never
 * changes behavior such as cache hit ratios or service times; when only those would help,
 * it says so.
 */
export function planCapacity(nodes: ArchNode[], edges: ArchEdge[], target: PlanTarget, options: PlanOptions = {}): PlanResult {
  const duration = options.evalDurationSec ?? 16;
  const maxEvaluations = options.maxEvaluations ?? 40;
  const seed = options.seed ?? 7;
  const maxUtilization = target.maxUtilization ?? DEFAULT_MAX_UTILIZATION;
  // Components above the headroom limit are candidates even before they're "hot".
  const hotAt = Math.min(HOT, maxUtilization);
  const notes: string[] = [];
  let evaluations = 0;

  const { flows, hints } = deriveFlows(nodes, edges, resolveArchetype);
  if (flows.length === 0) {
    return { status: 'no-traffic', nodes, changes: [], before: undefined, after: undefined, evaluations, notes: hints };
  }

  const evaluate = (candidate: ArchNode[], message: string): Evaluation => {
    evaluations++;
    options.onProgress?.({ evaluations, maxEvaluations, message });
    const derived = deriveFlows(candidate, edges, resolveArchetype);
    const design: Design = {
      schemaVersion: 1,
      meta: { name: 'plan', description: '', createdAt: new Date(0).toISOString() },
      nodes: candidate,
      edges,
      flows: derived.flows,
      handlers: derived.handlers,
      workloads: [],
    };
    const result = simulate(
      design,
      { id: 'plan', name: 'plan', durationSec: duration, pattern: { kind: 'constant', rps: target.rps }, mix: derivedMix(derived.flows), seed },
      { libraryEffect, drainSec: 2, traceEvery: Number.MAX_SAFE_INTEGER, maxTraces: 0 },
    );
    // Measure the second half, once queues have had time to build.
    const window = result.timeline.filter((s) => s.simTimeSec > duration / 2 && s.simTimeSec <= duration);
    const served = window.reduce((sum, s) => sum + s.throughputRps, 0);
    const p95Ms = served === 0 ? Number.POSITIVE_INFINITY : window.reduce((sum, s) => sum + s.p95Ms * s.throughputRps, 0) / served;
    const errorRate = window.length === 0 ? 1 : window.reduce((sum, s) => sum + s.errorRate, 0) / window.length;
    const last = window[window.length - 1];

    const pressure: Record<string, number> = {};
    const messagesPerSec: Record<string, number> = {};
    let lagMs = 0;
    let peakUtilization = 0;
    let busiestNodeId: string | undefined;
    for (const node of candidate) {
      const samples = window.map((s) => s.nodes.find((n) => n.nodeId === node.id)).filter((s) => s !== undefined);
      if (samples.length === 0) continue;
      const util = samples.reduce((sum, s) => sum + s.utilization, 0) / samples.length;
      if (node.config.type === 'queue') {
        const lag = last?.nodes.find((n) => n.nodeId === node.id)?.lagMs ?? 0;
        lagMs = Math.max(lagMs, lag);
        pressure[node.id] = Math.max(util, lag / target.maxLagMs);
        messagesPerSec[node.id] = samples.reduce((sum, s) => sum + s.servedPerSec, 0) / samples.length;
      } else {
        pressure[node.id] = util;
        if (util > peakUtilization) {
          peakUtilization = util;
          busiestNodeId = node.id;
        }
      }
    }
    const violation =
      Math.max(0, Math.min(p95Ms, 1e6) / target.p95Ms - 1) +
      Math.max(0, errorRate - target.maxErrorRate) * 20 +
      Math.max(0, lagMs / target.maxLagMs - 1) +
      Math.max(0, peakUtilization - maxUtilization);
    return {
      p95Ms: Number.isFinite(p95Ms) ? Math.round(p95Ms * 10) / 10 : p95Ms,
      errorRate: Math.round(errorRate * 10_000) / 10_000,
      lagMs: Math.round(lagMs),
      peakUtilization: Math.round(peakUtilization * 1000) / 1000,
      busiestNodeId,
      meets: p95Ms <= target.p95Ms && errorRate <= target.maxErrorRate && lagMs <= target.maxLagMs && peakUtilization <= maxUtilization,
      violation,
      cost: estimateCost(candidate, { requestsPerSec: target.rps, messagesPerSec }),
      pressure,
    };
  };

  const label = new Map(nodes.map((n) => [n.id, n.label]));
  const originalById = new Map(nodes.map((n) => [n.id, n]));
  const describe = (nodeId: string, knob: Knob, to: number) => `${label.get(nodeId)}: ${to} ${KNOB_LABEL[knob]}`;

  const before = evaluate(nodes, 'Testing your current design');
  let current = nodes;
  let currentEval = before;

  // ── Grow until the targets are met ──
  while (!currentEval.meets && evaluations < maxEvaluations) {
    const hot = current
      .map((n) => ({ node: n, archetype: archetypeOf(n), pressure: currentEval.pressure[n.id] ?? 0 }))
      .filter((h) => h.archetype && h.pressure >= hotAt && growMoves(h.node, current, edges).length > 0)
      .sort((a, b) => (DEPTH[b.archetype!] ?? 0) - (DEPTH[a.archetype!] ?? 0) || b.pressure - a.pressure)
      .slice(0, 3);
    if (hot.length === 0) break;

    let best: { nodes: ArchNode[]; evaluation: Evaluation; score: number } | undefined;
    for (const { node } of hot) {
      for (const move of growMoves(node, current, edges)) {
        if (evaluations >= maxEvaluations) break;
        const candidate = applyMove(current, move);
        const evaluation = evaluate(candidate, `Trying ${move.map((s) => describe(s.nodeId, s.knob, s.to)).join(' + ')}`);
        const gain = currentEval.violation - evaluation.violation;
        const extra = Math.max(1, evaluation.cost.monthlyUsd - currentEval.cost.monthlyUsd);
        // Anything that meets every target beats anything that doesn't; among those, the cheapest wins.
        const score = evaluation.meets ? 1e9 - extra : gain / extra;
        if (gain > 1e-6 && (!best || score > best.score)) best = { nodes: candidate, evaluation, score };
      }
    }
    if (!best) break;
    current = best.nodes;
    currentEval = best.evaluation;
  }

  const grew = current !== nodes;
  if (!currentEval.meets) {
    const stuck = current
      .filter((n) => (currentEval.pressure[n.id] ?? 0) >= hotAt)
      .map((n) => n.label);
    if (stuck.length > 0) {
      notes.push(
        `Still over the limit: ${stuck.join(', ')}. ${
          evaluations >= maxEvaluations ? 'The search ran out of attempts; try a lower target or a larger starting setup.' : 'Adding capacity there didn’t help enough.'
        }`,
      );
    } else if (currentEval.p95Ms > target.p95Ms) {
      notes.push(
        `Latency stays at ${Math.round(currentEval.p95Ms)} ms even though nothing is busy. The work itself is too slow for a ${target.p95Ms} ms budget: reduce service or query times, or add a cache.`,
      );
    }
    notes.push(PRICING_NOTE);
    return { status: 'unreachable', nodes: current, changes: diff(nodes, current, label), before, after: currentEval, evaluations, notes };
  }

  // ── Take away anything that isn't needed ──
  let shrunk = true;
  while (shrunk && evaluations < maxEvaluations) {
    shrunk = false;
    const options = current
      .flatMap((node) => shrinkMoves(node, originalById.get(node.id)).map((move) => ({ node, move })))
      .map((o) => {
        const candidate = withKnob(current, o.node.id, o.move.knob, o.move.to);
        return { ...o, candidate, saving: currentEval.cost.monthlyUsd - estimateCost(candidate, { requestsPerSec: target.rps }).monthlyUsd };
      })
      .filter((o) => o.saving > 0.5)
      .sort((a, b) => b.saving - a.saving);
    for (const o of options) {
      if (evaluations >= maxEvaluations) break;
      const evaluation = evaluate(o.candidate, `Checking if ${describe(o.node.id, o.move.knob, o.move.to)} is enough`);
      if (evaluation.meets) {
        current = o.candidate;
        currentEval = evaluation;
        shrunk = true;
        break;
      }
    }
  }

  const changes = diff(nodes, current, label);
  if (current.some((n) => n.config.type === 'compute' && originalById.get(n.id)?.config.type === 'compute' && (originalById.get(n.id)!.config as { instances: number }).instances >= 2)) {
    notes.push('Services that already had 2 or more instances keep at least 2, so one failure doesn’t take them down.');
  }
  if (currentEval.cost.unpricedCount > 0) {
    notes.push(`${currentEval.cost.unpricedCount} component${currentEval.cost.unpricedCount > 1 ? 's aren’t' : ' isn’t'} priced yet and count as $0.`);
  }
  notes.push(PRICING_NOTE);

  const status: PlanStatus = grew ? 'met' : changes.length > 0 ? 'right-sized' : 'already-optimal';
  if (status === 'right-sized') {
    notes.unshift(`Your design already met the targets. This setup meets them too and saves ${formatUsd(before.cost.monthlyUsd - currentEval.cost.monthlyUsd)} a month.`);
  }
  return { status, nodes: current, changes, before, after: currentEval, evaluations, notes };
}

function diff(from: ArchNode[], to: ArchNode[], label: Map<string, string>): PlanChange[] {
  const changes: PlanChange[] = [];
  const knobs: Knob[] = ['instances', 'readReplicas', 'connectionPool', 'maxConnections', 'partitions'];
  for (const node of to) {
    const original = from.find((n) => n.id === node.id);
    if (!original) continue;
    for (const knob of knobs) {
      const a = knobOf(original, knob);
      const b = knobOf(node, knob);
      if (a !== undefined && b !== undefined && a !== b) changes.push({ nodeId: node.id, label: label.get(node.id) ?? node.id, knob, from: a, to: b });
    }
  }
  return changes;
}

export function describeChange(change: PlanChange): string {
  return `${change.label}: ${change.from} → ${change.to} ${KNOB_LABEL[change.knob]}`;
}
