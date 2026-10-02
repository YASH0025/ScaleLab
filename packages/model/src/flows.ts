import type { ArchetypeResolver } from './validate';
import type { ApiFlow, ArchEdge, ArchNode, Archetype, FlowStep, Workload } from './schemas';

export interface DerivedFlows {
  flows: ApiFlow[];
  /** Why no flows could be derived, or what was simplified. Shown to the user. */
  hints: string[];
}

export const READ_FLOW_ID = 'auto-read';
export const WRITE_FLOW_ID = 'auto-write';

/**
 * Builds API flows from the canvas graph, so a design drawn from scratch can run
 * without a flow editor. It follows the request path:
 *   client → (load balancer) → backend → cache and/or database.
 *
 * - Read flow:  backend work, then cache lookup with database fallback on a miss.
 * - Write flow: backend work, then a database write (only when there is a database).
 */
export function deriveFlows(nodes: ArchNode[], edges: ArchEdge[], resolve: ArchetypeResolver): DerivedFlows {
  const hints: string[] = [];
  const archetype = new Map<string, Archetype>();
  for (const node of nodes) {
    const a = resolve(node.technologyId);
    if (a) archetype.set(node.id, a);
  }
  const targetsOf = (id: string, kind: Archetype) =>
    edges.filter((e) => e.source === id && archetype.get(e.target) === kind).map((e) => e.target);

  const clientEdge = edges.find((e) => archetype.get(e.source) === 'client');
  if (!clientEdge) {
    return { flows: [], hints: ['Connect a client (like a browser or Next.js) to your system to send traffic.'] };
  }
  const entryId = clientEdge.target;
  const entryKind = archetype.get(entryId);

  let backendId: string | undefined;
  if (entryKind === 'compute-service') {
    backendId = entryId;
  } else if (entryKind === 'load-balancer' || entryKind === 'gateway' || entryKind === 'cdn') {
    const backends = targetsOf(entryId, 'compute-service');
    backendId = backends[0];
    if (backends.length > 1) {
      hints.push('Only the first backend behind the load balancer receives traffic. Use its Instances setting to scale it.');
    }
  }
  if (!backendId) {
    return { flows: [], hints: ['Connect a backend (like Spring Boot or NestJS) behind your entry point.'] };
  }

  const cacheId = targetsOf(backendId, 'cache')[0];
  const dbId = targetsOf(backendId, 'relational-db')[0];
  if (!cacheId && !dbId) hints.push('Add a cache or a database behind your backend to see data access in the simulation.');

  const work: FlowStep = { kind: 'call', nodeId: backendId, operation: 'process' };
  const dbRead: FlowStep[] = dbId ? [{ kind: 'call', nodeId: dbId, operation: 'read' }] : [];
  const read: FlowStep[] = cacheId
    ? [{ kind: 'cache-lookup', cacheNodeId: cacheId, onHit: [], onMiss: dbRead, writeBackOnMiss: Boolean(dbId) }]
    : dbRead;

  const flows: ApiFlow[] = [
    {
      id: READ_FLOW_ID,
      name: 'Read',
      method: 'GET',
      path: '/api/items/{id}',
      entryNodeId: entryId,
      steps: [work, ...read, { kind: 'respond', status: 200 }],
      retry: { attempts: 0, backoffMs: 0 },
    },
  ];
  if (dbId) {
    flows.push({
      id: WRITE_FLOW_ID,
      name: 'Write',
      method: 'POST',
      path: '/api/items',
      entryNodeId: entryId,
      steps: [work, { kind: 'call', nodeId: dbId, operation: 'write' }, { kind: 'respond', status: 201 }],
      retry: { attempts: 0, backoffMs: 0 },
    });
  }
  return { flows, hints };
}

/** A typical read-heavy mix for derived flows: 90% reads, 10% writes. */
export function derivedMix(flows: ApiFlow[]): Workload['mix'] {
  return flows.map((f) => ({ flowId: f.id, weight: f.id === WRITE_FLOW_ID ? 1 : 9 }));
}
