import { getTechnology } from '@scalelab/catalog';
import type { ArchEdge, ArchNode, Distribution } from '@scalelab/model';

const ADJECTIVES = ['swift', 'calm', 'bold', 'bright', 'quiet', 'rapid', 'steady', 'lucky'];

/** Short unique id like "redis-calm-4f2a". */
export function newId(prefix: string): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  return `${prefix}-${adj}-${Math.random().toString(16).slice(2, 6)}`;
}

/** A fresh node from the catalog defaults, ready to drop on the canvas. */
export function createNode(technologyId: string, position: { x: number; y: number }, existing: ArchNode[]): ArchNode {
  const tech = getTechnology(technologyId);
  if (!tech) throw new Error(`Unknown technology ${technologyId}`);
  const sameKind = existing.filter((n) => n.technologyId === technologyId).length;
  return {
    id: newId(technologyId),
    technologyId,
    label: sameKind === 0 ? tech.name : `${tech.name} ${sameKind + 1}`,
    position: { x: Math.round(position.x), y: Math.round(position.y) },
    config: JSON.parse(JSON.stringify(tech.defaults)) as ArchNode['config'],
    libraries: [],
  };
}

const CLIENT_LATENCY: Distribution = { kind: 'lognormal', meanMs: 20, p99Ms: 80 };
const INTERNAL_LATENCY: Distribution = { kind: 'lognormal', meanMs: 0.5, p99Ms: 2 };

export function createEdge(source: ArchNode, target: ArchNode, protocol: ArchEdge['protocol']): ArchEdge {
  const fromClient = getTechnology(source.technologyId)?.archetype === 'client';
  return {
    id: newId('e'),
    source: source.id,
    target: target.id,
    protocol,
    networkLatency: fromClient ? CLIENT_LATENCY : INTERNAL_LATENCY,
  };
}

export const PROTOCOL_LABEL: Record<ArchEdge['protocol'], string> = {
  http: 'HTTP',
  grpc: 'gRPC',
  graphql: 'GraphQL',
  websocket: 'WS',
  'db-query': 'SQL',
  'cache-op': 'cache',
  publish: 'publish',
  consume: 'consume',
  'object-io': 'objects',
  'dns-lookup': 'DNS',
  'internal-call': 'call',
};
