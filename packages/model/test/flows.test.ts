import { describe, expect, it } from 'vitest';
import { deriveFlows, derivedMix, isWriteFlow, readFlowId, writeFlowId } from '../src/flows';
import type { ArchEdge, ArchNode, Archetype, FlowStep } from '../src/schemas';

const ARCH: Record<string, Archetype> = {
  stripe: 'external-api',
  auth: 'auth-provider',
  web: 'client',
  lb: 'load-balancer',
  gw: 'gateway',
  api: 'compute-service',
  orders: 'compute-service',
  inventory: 'compute-service',
  cache: 'cache',
  db: 'relational-db',
  db2: 'relational-db',
  kafka: 'event-stream',
  mq: 'message-queue',
  worker: 'worker',
};
const resolve = (id: string) => ARCH[id.replace(/\d+$/, '')] ?? ARCH[id];
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
const graph = (ids: string[], links: Array<[string, string]>) => ({
  nodes: ids.map(node),
  edges: links.map(([a, b]) => edge(a, b)),
});

describe('deriveFlows: single service', () => {
  it('builds read and write flows through LB, backend, cache and database', () => {
    const g = graph(['web', 'lb', 'api', 'cache', 'db'], [['web', 'lb'], ['lb', 'api'], ['api', 'cache'], ['api', 'db']]);
    const { flows, handlers, hints } = deriveFlows(g.nodes, g.edges, resolve);
    expect(hints).toEqual([]);
    expect(handlers).toEqual([]);
    expect(flows.map((f) => f.id)).toEqual([readFlowId('api'), writeFlowId('api')]);
    const [read, write] = flows;
    expect(read!.entryNodeId).toBe('lb');
    expect(read!.steps[0]).toEqual({ kind: 'call', nodeId: 'api', operation: 'process' });
    expect(read!.steps[1]).toMatchObject({ kind: 'cache-lookup', cacheNodeId: 'cache', writeBackOnMiss: true });
    expect(write!.steps[1]).toEqual({ kind: 'call', nodeId: 'db', operation: 'write', effect: 'saved to db' });
  });

  it('works without a load balancer or cache', () => {
    const g = graph(['web', 'api', 'db'], [['web', 'api'], ['api', 'db']]);
    const { flows } = deriveFlows(g.nodes, g.edges, resolve);
    expect(flows[0]!.entryNodeId).toBe('api');
    expect(flows[0]!.steps[1]).toEqual({ kind: 'call', nodeId: 'db', operation: 'read' });
  });

  it('explains what is missing', () => {
    expect(deriveFlows([node('api')], [], resolve).hints[0]).toMatch(/client/);
    const noBackend = graph(['web', 'lb'], [['web', 'lb']]);
    expect(deriveFlows(noBackend.nodes, noBackend.edges, resolve).hints[0]).toMatch(/backend/);
    const onlyBackend = graph(['web', 'api'], [['web', 'api']]);
    const result = deriveFlows(onlyBackend.nodes, onlyBackend.edges, resolve);
    expect(result.flows).toHaveLength(1);
    expect(result.hints[0]).toMatch(/cache or a database/);
  });
});

describe('deriveFlows: microservices', () => {
  it('sends traffic to every service behind the load balancer', () => {
    const g = graph(['web', 'lb', 'api', 'orders', 'db', 'db2'], [
      ['web', 'lb'],
      ['lb', 'api'],
      ['lb', 'orders'],
      ['api', 'db'],
      ['orders', 'db2'],
    ]);
    const { flows } = deriveFlows(g.nodes, g.edges, resolve);
    expect(flows.map((f) => f.id).sort()).toEqual(
      [readFlowId('api'), writeFlowId('api'), readFlowId('orders'), writeFlowId('orders')].sort(),
    );
    const mix = derivedMix(flows);
    const total = (svc: string) => mix.filter((m) => m.flowId.endsWith(svc)).reduce((a, m) => a + m.weight, 0);
    expect(total('api')).toBeCloseTo(total('orders'));
    expect(mix.find((m) => m.flowId === writeFlowId('api'))!.weight).toBeCloseTo(total('api') * 0.1);
  });

  it('nests calls to downstream services with their own dependencies', () => {
    const g = graph(['web', 'orders', 'inventory', 'db', 'db2'], [
      ['web', 'orders'],
      ['orders', 'inventory'],
      ['orders', 'db'],
      ['inventory', 'db2'],
    ]);
    const read = deriveFlows(g.nodes, g.edges, resolve).flows.find((f) => f.id === readFlowId('orders'))!;
    const call = read.steps.find((s) => s.kind === 'service-call') as Extract<FlowStep, { kind: 'service-call' }>;
    expect(call.nodeId).toBe('inventory');
    expect(call.steps).toEqual([{ kind: 'call', nodeId: 'db2', operation: 'read' }]);
  });

  it('looks through an internal gateway to find downstream services', () => {
    const g = graph(['web', 'orders', 'gw', 'inventory', 'db'], [
      ['web', 'orders'],
      ['orders', 'gw'],
      ['gw', 'inventory'],
      ['inventory', 'db'],
    ]);
    const read = deriveFlows(g.nodes, g.edges, resolve).flows[0]!;
    expect(read.steps.some((s) => s.kind === 'service-call' && s.nodeId === 'inventory')).toBe(true);
  });

  it('survives call cycles', () => {
    const g = graph(['web', 'orders', 'inventory', 'db'], [
      ['web', 'orders'],
      ['orders', 'inventory'],
      ['inventory', 'orders'],
      ['inventory', 'db'],
    ]);
    const { flows } = deriveFlows(g.nodes, g.edges, resolve);
    expect(JSON.stringify(flows).length).toBeLessThan(5000);
  });
});

describe('deriveFlows: queues and consumers', () => {
  it('publishes on writes and builds a handler per consumer', () => {
    const g = graph(['web', 'orders', 'db', 'kafka', 'worker', 'db2'], [
      ['web', 'orders'],
      ['orders', 'db'],
      ['orders', 'kafka'],
      ['kafka', 'worker'],
      ['worker', 'db2'],
    ]);
    const { flows, handlers, hints } = deriveFlows(g.nodes, g.edges, resolve);
    expect(hints).toEqual([]);
    const write = flows.find((f) => isWriteFlow(f.id))!;
    expect(write.steps).toContainEqual({ kind: 'publish', nodeId: 'kafka', effect: 'sent to kafka' });
    const read = flows.find((f) => !isWriteFlow(f.id))!;
    expect(read.steps.some((s) => s.kind === 'publish')).toBe(false);
    expect(handlers).toEqual([
      {
        id: 'handler:kafka:worker',
        queueNodeId: 'kafka',
        consumerNodeId: 'worker',
        steps: [
          { kind: 'call', nodeId: 'worker', operation: 'process' },
          { kind: 'call', nodeId: 'db2', operation: 'write', effect: 'saved to db2' },
        ],
      },
    ]);
  });

  it('gives a service with only a queue a write flow', () => {
    const g = graph(['web', 'api', 'mq', 'worker'], [['web', 'api'], ['api', 'mq'], ['mq', 'worker']]);
    const { flows } = deriveFlows(g.nodes, g.edges, resolve);
    expect(flows.some((f) => f.id === writeFlowId('api'))).toBe(true);
  });

  it('warns when nothing consumes from a queue', () => {
    const g = graph(['web', 'api', 'db', 'kafka'], [['web', 'api'], ['api', 'db'], ['api', 'kafka']]);
    const { hints } = deriveFlows(g.nodes, g.edges, resolve);
    expect(hints.some((h) => h.includes('Nothing consumes from "kafka"'))).toBe(true);
  });

  it('never makes a consumer re-publish to the queue it reads from', () => {
    const g = graph(['web', 'api', 'mq', 'worker'], [['web', 'api'], ['api', 'mq'], ['mq', 'worker'], ['worker', 'mq']]);
    const { handlers } = deriveFlows(g.nodes, g.edges, resolve);
    expect(handlers[0]!.steps.some((s) => s.kind === 'publish')).toBe(false);
  });
});

describe('deriveFlows: external services', () => {
  it('calls external APIs after data, with a side effect on writes only', () => {
    const g = graph(['web', 'orders', 'db', 'stripe', 'kafka'], [
      ['web', 'orders'],
      ['orders', 'db'],
      ['orders', 'stripe'],
      ['orders', 'kafka'],
    ]);
    const { flows } = deriveFlows(g.nodes, g.edges, resolve);
    const write = flows.find((f) => isWriteFlow(f.id))!;
    expect(write.steps.slice(1, 4)).toEqual([
      { kind: 'call', nodeId: 'db', operation: 'write', effect: 'saved to db' },
      { kind: 'call', nodeId: 'stripe', operation: 'write', effect: 'stripe call went through' },
      { kind: 'publish', nodeId: 'kafka', effect: 'sent to kafka' },
    ]);
    const read = flows.find((f) => !isWriteFlow(f.id))!;
    expect(read.steps).toContainEqual({ kind: 'call', nodeId: 'stripe', operation: 'read' });
  });

  it('gives a service that only calls an external API a write flow', () => {
    const g = graph(['web', 'api', 'auth'], [['web', 'api'], ['api', 'auth']]);
    const { flows } = deriveFlows(g.nodes, g.edges, resolve);
    expect(flows.some((f) => f.id === writeFlowId('api'))).toBe(true);
  });
});
