import { getTechnology } from '@scalelab/catalog';
import type { EngineMetricsSample, EngineNodeSample } from '@scalelab/engine';
import type { ArchEdge, ArchNode, Archetype } from '@scalelab/model';

export interface Bottleneck {
  nodeId: string;
  label: string;
  archetype: Archetype;
  utilization: number;
  queueLength: number;
  explanation: string;
  suggestions: string[];
}

/**
 * How deep a component sits in the request path. Deeper saturation is the root cause:
 * when a database saturates, the services waiting on it look busy too.
 * A lagging queue ranks just above its consumers, and below the data stores they use.
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

export const HOT = 0.9;
/** Consumer lag at which a queue counts as falling behind. */
export const LAG_HOT_MS = 5000;
export const LAG_WARM_MS = 1000;

const QUEUES: Archetype[] = ['message-queue', 'event-stream'];
const isQueue = (a: Archetype | undefined) => a !== undefined && QUEUES.includes(a);

/** Queues are in trouble when consumers fall behind or the backlog fills; everything else by utilization. */
function pressure(s: EngineNodeSample, archetype: Archetype): number {
  if (isQueue(archetype) && (s.lagMs ?? 0) >= LAG_HOT_MS) return Math.max(HOT, s.utilization);
  return s.utilization;
}

const seconds = (ms: number) => (ms >= 10_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 1000).toFixed(1)} s`);

/**
 * Picks the component most likely limiting the system: the deepest one under pressure,
 * and explains it with the evidence behind it.
 */
export function findBottleneck(
  sample: EngineMetricsSample | undefined,
  nodes: ArchNode[],
  edges: ArchEdge[],
): Bottleneck | undefined {
  if (!sample) return undefined;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const archetypeOf = (id: string) => {
    const n = byId.get(id);
    return n ? getTechnology(n.technologyId)?.archetype : undefined;
  };
  let best: { node: ArchNode; archetype: Archetype; util: number; s: EngineNodeSample } | undefined;
  for (const s of sample.nodes) {
    const node = byId.get(s.nodeId);
    const archetype = archetypeOf(s.nodeId);
    if (!node || !archetype) continue;
    const util = pressure(s, archetype);
    if (util < HOT) continue;
    const depth = DEPTH[archetype] ?? 0;
    const bestDepth = best ? (DEPTH[best.archetype] ?? 0) : -1;
    if (!best || depth > bestDepth || (depth === bestDepth && util > best.util)) {
      best = { node, archetype, util, s };
    }
  }
  if (!best) return undefined;

  const pct = Math.round(best.util * 100);
  const queue = best.s.queueLength;
  const hasCache = nodes.some((n) => getTechnology(n.technologyId)?.archetype === 'cache') && edges.length > 0;
  const base = { nodeId: best.node.id, label: best.node.label, archetype: best.archetype, utilization: best.util, queueLength: queue };

  switch (best.archetype) {
    case 'relational-db':
      return {
        ...base,
        explanation: `Connection pool at ${pct}% with ${queue} requests waiting. Adding backend instances will increase database pressure without raising throughput.`,
        suggestions: hasCache
          ? ['Raise the cache hit ratio', 'Add a read replica', 'Raise the connection pool']
          : ['Add Redis in front', 'Add a read replica', 'Raise the connection pool'],
      };
    case 'cache':
      return {
        ...base,
        explanation: `Cache connections at ${pct}%. Requests are queueing for the cache itself.`,
        suggestions: ['Raise max connections', 'Lower read latency'],
      };
    case 'compute-service':
      return {
        ...base,
        explanation: `Workers at ${pct}% with ${queue} requests waiting. The service can't keep up, and every service calling it slows down too.`,
        suggestions: ['Add instances', 'Add workers per instance', 'Reduce service time'],
      };
    case 'worker':
      return {
        ...base,
        explanation: `Workers at ${pct}% busy processing messages. Work is arriving faster than it can be done.`,
        suggestions: ['Add instances', 'Add workers per instance', 'Reduce service time'],
      };
    case 'message-queue':
    case 'event-stream':
      return { ...base, ...explainQueue(best.node, best.s, sample, edges, byId, archetypeOf) };
    default:
      return {
        ...base,
        explanation: `${best.node.label} is at ${pct}% of its modeled capacity.`,
        suggestions: [],
      };
  }
}

/** Why a queue is falling behind: no consumers, a partition cap, or busy consumers. */
function explainQueue(
  queueNode: ArchNode,
  s: EngineNodeSample,
  sample: EngineMetricsSample,
  edges: ArchEdge[],
  byId: Map<string, ArchNode>,
  archetypeOf: (id: string) => Archetype | undefined,
): { explanation: string; suggestions: string[] } {
  const waiting = `${s.queueLength.toLocaleString()} messages waiting${s.lagMs ? `, the oldest for ${seconds(s.lagMs)}` : ''}`;
  const filling = s.utilization >= HOT ? ' The backlog is almost full, so publishing will start to fail.' : ' Requests still succeed, but the work they triggered is delayed.';
  const consumers = edges
    .filter((e) => e.source === queueNode.id && ['worker', 'compute-service'].includes(archetypeOf(e.target) ?? ''))
    .map((e) => byId.get(e.target)!)
    .filter(Boolean);
  if (consumers.length === 0) {
    return {
      explanation: `Nothing consumes from ${queueNode.label}: ${waiting}.${filling}`,
      suggestions: ['Connect a worker'],
    };
  }
  const partitions = queueNode.config.type === 'queue' ? queueNode.config.partitions : 0;
  const busiest = consumers
    .map((c) => ({ node: c, util: sample.nodes.find((n) => n.nodeId === c.id)?.utilization ?? 0 }))
    .sort((a, b) => b.util - a.util)[0]!;
  const workers = (n: ArchNode) => (n.config.type === 'compute' ? n.config.instances * n.config.workersPerInstance : 0);
  const capped = partitions > 0 && consumers.some((c) => workers(c) > partitions) && busiest.util < HOT;

  if (capped) {
    return {
      explanation: `Consumers are falling behind: ${waiting}. ${queueNode.label} has ${partitions} partitions, so each consumer group processes only ${partitions} messages at a time. Adding consumer instances won't help until you add partitions.${filling}`,
      suggestions: ['Add partitions', 'Reduce consumer service time'],
    };
  }
  return {
    explanation: `Consumers are falling behind: ${waiting}. ${busiest.node.label} is ${Math.round(busiest.util * 100)}% busy.${filling}`,
    suggestions:
      partitions > 0 && consumers.some((c) => workers(c) >= partitions)
        ? ['Add partitions and consumer instances', 'Reduce consumer service time']
        : ['Add consumer instances', 'Add workers per instance', 'Reduce consumer service time'],
  };
}

/** A bottleneck must last this many seconds in a row to count in a run's summary. */
export const SUSTAINED_SECONDS = 3;

/**
 * The bottleneck of a whole run: the component under pressure for the longest stretch,
 * as long as it lasted at least `minSeconds` in a row. A one-second spike is noise,
 * not a bottleneck, especially for queue consumers whose backlog absorbs bursts.
 */
export function findSustainedBottleneck(
  samples: readonly EngineMetricsSample[],
  nodes: ArchNode[],
  edges: ArchEdge[],
  minSeconds = SUSTAINED_SECONDS,
): Bottleneck | undefined {
  let best: { bottleneck: Bottleneck; streak: number } | undefined;
  let streakId: string | undefined;
  let streak = 0;
  for (const sample of samples) {
    const b = findBottleneck(sample, nodes, edges);
    if (b && b.nodeId === streakId) streak++;
    else {
      streakId = b?.nodeId;
      streak = b ? 1 : 0;
    }
    if (b && streak >= minSeconds && (!best || streak >= best.streak)) best = { bottleneck: b, streak };
  }
  return best?.bottleneck;
}

export type Health = 'idle' | 'ok' | 'warm' | 'hot' | 'down';

export function healthOf(utilization: number | undefined, up = true): Health {
  if (!up) return 'down';
  if (utilization === undefined) return 'idle';
  if (utilization >= HOT) return 'hot';
  if (utilization >= 0.7) return 'warm';
  return 'ok';
}

/** Health of a live node sample; queues are judged by consumer lag as well as backlog fullness. */
export function healthOfSample(s: EngineNodeSample | undefined, archetype: Archetype | undefined): Health {
  if (!s) return 'idle';
  if (!s.up) return 'down';
  if (isQueue(archetype)) {
    const lag = s.lagMs ?? 0;
    if (lag >= LAG_HOT_MS || s.utilization >= HOT) return 'hot';
    if (lag >= LAG_WARM_MS || s.utilization >= 0.7) return 'warm';
    return 'ok';
  }
  if (s.failedPerSec !== undefined) {
    // Outside services: judged by the share of calls that fail, and by how close they are to the rate limit.
    const failShare = s.servedPerSec > 0 ? s.failedPerSec / s.servedPerSec : 0;
    if (failShare >= 0.1 || s.utilization >= HOT) return 'hot';
    if (failShare >= 0.02 || s.utilization >= 0.7) return 'warm';
    return 'ok';
  }
  return healthOf(s.utilization, s.up);
}
