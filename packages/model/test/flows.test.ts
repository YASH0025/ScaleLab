import { describe, expect, it } from 'vitest';
import { WRITE_FLOW_ID, deriveFlows, derivedMix } from '../src/flows';
import type { ArchEdge, ArchNode, Archetype } from '../src/schemas';

const ARCH: Record<string, Archetype> = {
  web: 'client',
  lb: 'load-balancer',
  api: 'compute-service',
  cache: 'cache',
  db: 'relational-db',
};
const resolve = (id: string) => ARCH[id];
const node = (id: string): ArchNode => ({
  id,
  technologyId: id,
  label: id,
  position: { x: 0, y: 0 },
  config: { type: 'generic', available: true, extraLatencyMs: 0, params: {} },
  libraries: [],
});
const edge = (source: string, target: string): ArchEdge => ({
  id: `${source}-${target}`,
  source,
  target,
  protocol: 'http',
  networkLatency: { kind: 'constant', valueMs: 0 },
});

describe('deriveFlows', () => {
  it('builds read and write flows through LB, backend, cache and database', () => {
    const nodes = ['web', 'lb', 'api', 'cache', 'db'].map(node);
    const edges = [edge('web', 'lb'), edge('lb', 'api'), edge('api', 'cache'), edge('api', 'db')];
    const { flows, hints } = deriveFlows(nodes, edges, resolve);
    expect(hints).toEqual([]);
    expect(flows).toHaveLength(2);
    const [read, write] = flows;
    expect(read!.entryNodeId).toBe('lb');
    expect(read!.steps[0]).toEqual({ kind: 'call', nodeId: 'api', operation: 'process' });
    expect(read!.steps[1]).toMatchObject({ kind: 'cache-lookup', cacheNodeId: 'cache', writeBackOnMiss: true });
    expect(write!.steps[1]).toEqual({ kind: 'call', nodeId: 'db', operation: 'write' });
    expect(derivedMix(flows).find((m) => m.flowId === WRITE_FLOW_ID)?.weight).toBe(1);
  });

  it('works without a load balancer or cache', () => {
    const nodes = ['web', 'api', 'db'].map(node);
    const { flows } = deriveFlows(nodes, [edge('web', 'api'), edge('api', 'db')], resolve);
    expect(flows[0]!.entryNodeId).toBe('api');
    expect(flows[0]!.steps[1]).toEqual({ kind: 'call', nodeId: 'db', operation: 'read' });
  });

  it('explains what is missing', () => {
    expect(deriveFlows([node('api')], [], resolve).hints[0]).toMatch(/client/);
    expect(deriveFlows(['web', 'lb'].map(node), [edge('web', 'lb')], resolve).hints[0]).toMatch(/backend/);
    const onlyBackend = deriveFlows(['web', 'api'].map(node), [edge('web', 'api')], resolve);
    expect(onlyBackend.flows).toHaveLength(1);
    expect(onlyBackend.hints[0]).toMatch(/cache or a database/);
  });
});
