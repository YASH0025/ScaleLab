import { getTechnology } from '@scalelab/catalog';
import type { EngineMetricsSample } from '@scalelab/engine';
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

/** How deep a component sits in the request path. Deeper saturation is the root cause. */
const DEPTH: Partial<Record<Archetype, number>> = {
  'load-balancer': 1,
  'compute-service': 2,
  cache: 3,
  'relational-db': 3,
};

export const HOT = 0.9;

/**
 * Picks the component most likely limiting throughput: the deepest one that is
 * saturated. When a database saturates, backends also look busy because their
 * threads wait on it, so the database is the real cause.
 */
export function findBottleneck(
  sample: EngineMetricsSample | undefined,
  nodes: ArchNode[],
  edges: ArchEdge[],
): Bottleneck | undefined {
  if (!sample) return undefined;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let best: { node: ArchNode; archetype: Archetype; util: number; queue: number } | undefined;
  for (const s of sample.nodes) {
    if (s.utilization < HOT) continue;
    const node = byId.get(s.nodeId);
    const archetype = node && getTechnology(node.technologyId)?.archetype;
    if (!node || !archetype) continue;
    const depth = DEPTH[archetype] ?? 0;
    const bestDepth = best ? (DEPTH[best.archetype] ?? 0) : -1;
    if (!best || depth > bestDepth || (depth === bestDepth && s.utilization > best.util)) {
      best = { node, archetype, util: s.utilization, queue: s.queueLength };
    }
  }
  if (!best) return undefined;

  const pct = Math.round(best.util * 100);
  const hasCache = nodes.some((n) => getTechnology(n.technologyId)?.archetype === 'cache') && edges.length > 0;
  const base = { nodeId: best.node.id, label: best.node.label, archetype: best.archetype, utilization: best.util, queueLength: best.queue };

  switch (best.archetype) {
    case 'relational-db':
      return {
        ...base,
        explanation: `Connection pool at ${pct}% with ${best.queue} requests waiting. Adding backend instances will increase database pressure without raising throughput.`,
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
        explanation: `Workers at ${pct}% with ${best.queue} requests waiting. The backend can't keep up with incoming traffic.`,
        suggestions: ['Add instances', 'Add workers per instance', 'Reduce service time'],
      };
    default:
      return {
        ...base,
        explanation: `${best.node.label} is at ${pct}% of its modeled capacity.`,
        suggestions: [],
      };
  }
}

export type Health = 'idle' | 'ok' | 'warm' | 'hot' | 'down';

export function healthOf(utilization: number | undefined, up = true): Health {
  if (!up) return 'down';
  if (utilization === undefined) return 'idle';
  if (utilization >= HOT) return 'hot';
  if (utilization >= 0.7) return 'warm';
  return 'ok';
}
