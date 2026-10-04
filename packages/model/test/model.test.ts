import { describe, expect, it } from 'vitest';
import { checkConnection, isProtocolAllowed } from '../src/connections';
import type { Archetype, Design } from '../src/schemas';
import { validateDesign } from '../src/validate';

describe('checkConnection', () => {
  it('allows a backend to query a relational database', () => {
    const check = checkConnection('compute-service', 'relational-db');
    expect(check.valid).toBe(true);
    expect(check.protocols).toEqual(['db-query']);
  });

  it('rejects a client talking to a database directly, with a reason', () => {
    const check = checkConnection('client', 'relational-db');
    expect(check.valid).toBe(false);
    expect(check.reason).toBe("A client can't connect directly to a relational database. Route it through a service that owns that dependency.");
  });

  it('rejects connections to infrastructure groups', () => {
    expect(checkConnection('compute-service', 'infra-group').valid).toBe(false);
  });

  it('lets workers consume from queues but not publish to them backwards', () => {
    expect(isProtocolAllowed('message-queue', 'worker', 'consume')).toBe(true);
    expect(isProtocolAllowed('message-queue', 'worker', 'publish')).toBe(false);
  });
});

const ARCH: Record<string, Archetype> = {
  browser: 'client',
  alb: 'load-balancer',
  spring: 'compute-service',
  redis: 'cache',
  postgres: 'relational-db',
  k8s: 'infra-group',
};
const resolve = (id: string) => ARCH[id];

const latency = { kind: 'constant' as const, valueMs: 1 };
const base = { available: true, extraLatencyMs: 0 };

function validDesign(): Design {
  return {
    schemaVersion: 1,
    meta: { name: 'Test', description: '', createdAt: '2026-10-03T00:00:00Z' },
    nodes: [
      { id: 'c', technologyId: 'browser', label: 'Browser', position: { x: 0, y: 0 }, config: { type: 'client', ...base }, libraries: [] },
      {
        id: 'lb',
        technologyId: 'alb',
        label: 'ALB',
        position: { x: 0, y: 1 },
        config: { type: 'load-balancer', ...base, strategy: 'round-robin', overhead: latency, healthChecks: true },
        libraries: [],
      },
      {
        id: 'api',
        technologyId: 'spring',
        label: 'API',
        position: { x: 0, y: 2 },
        config: {
          type: 'compute',
          ...base,
          instances: 2,
          workersPerInstance: 50,
          serviceTime: { kind: 'exponential', meanMs: 40 },
          queueLimit: 200,
          timeoutMs: 2000,
        },
        libraries: [],
      },
      {
        id: 'db',
        technologyId: 'postgres',
        label: 'DB',
        position: { x: 0, y: 3 },
        config: {
          type: 'relational-db',
          ...base,
          connectionPool: 20,
          readQuery: { kind: 'exponential', meanMs: 10 },
          writeQuery: { kind: 'exponential', meanMs: 20 },
          queueLimit: 500,
          timeoutMs: 3000,
          readReplicas: 0,
        },
        libraries: [],
      },
    ],
    edges: [
      { id: 'e1', source: 'c', target: 'lb', protocol: 'http', networkLatency: latency },
      { id: 'e2', source: 'lb', target: 'api', protocol: 'http', networkLatency: latency },
      { id: 'e3', source: 'api', target: 'db', protocol: 'db-query', networkLatency: latency },
    ],
    flows: [
      {
        id: 'get-product',
        name: 'Get product',
        method: 'GET',
        path: '/products/{id}',
        entryNodeId: 'lb',
        steps: [
          { kind: 'call', nodeId: 'api', operation: 'process' },
          { kind: 'call', nodeId: 'db', operation: 'read' },
          { kind: 'respond', status: 200 },
        ],
        retry: { attempts: 0, backoffMs: 0 },
      },
    ],
    workloads: [
      { id: 'w', name: 'Steady', durationSec: 60, pattern: { kind: 'constant', rps: 100 }, mix: [{ flowId: 'get-product', weight: 1 }], seed: 42 },
    ],
  };
}

describe('validateDesign', () => {
  it('accepts a valid design', () => {
    expect(validateDesign(validDesign(), resolve)).toEqual([]);
  });

  it('reports shape errors from the schema', () => {
    const issues = validateDesign({ schemaVersion: 1 }, resolve);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('flags an invalid connection', () => {
    const design = validDesign();
    design.edges.push({ id: 'bad', source: 'c', target: 'db', protocol: 'db-query', networkLatency: latency });
    const issues = validateDesign(design, resolve);
    expect(issues.some((i) => i.targetId === 'bad')).toBe(true);
  });

  it('flags a protocol that is not allowed for the pair', () => {
    const design = validDesign();
    design.edges[2]!.protocol = 'http';
    expect(validateDesign(design, resolve).some((i) => i.targetId === 'e3')).toBe(true);
  });

  it('flags a config that does not match the technology', () => {
    const design = validDesign();
    design.nodes[3]!.config = { type: 'client', ...base };
    expect(validateDesign(design, resolve).some((i) => i.targetId === 'db')).toBe(true);
  });

  it('flags flows that reference missing nodes', () => {
    const design = validDesign();
    design.flows[0]!.steps.unshift({ kind: 'call', nodeId: 'ghost', operation: 'read' });
    expect(validateDesign(design, resolve).some((i) => i.message.includes('ghost'))).toBe(true);
  });

  it('flags workloads that reference missing flows', () => {
    const design = validDesign();
    design.workloads[0]!.mix[0]!.flowId = 'nope';
    expect(validateDesign(design, resolve).some((i) => i.targetId === 'w')).toBe(true);
  });

  it('warns about unconnected nodes', () => {
    const design = validDesign();
    design.nodes.push({ ...design.nodes[2]!, id: 'lonely', label: 'Lonely' });
    const issue = validateDesign(design, resolve).find((i) => i.targetId === 'lonely');
    expect(issue?.severity).toBe('warning');
  });

  it('only allows nodes inside infrastructure groups', () => {
    const design = validDesign();
    design.nodes[2]!.parentId = 'db';
    expect(validateDesign(design, resolve).some((i) => i.targetId === 'api')).toBe(true);
  });
});

describe('journey validation', () => {
  const step = (serviceNodeId: string) => ({ id: 's', name: 'Pay', serviceNodeId, operation: 'write' as const, retries: 0, idempotent: false });

  it('accepts journeys through services', () => {
    const design = validDesign();
    design.journeys = [{ id: 'j', name: 'Checkout', steps: [step('api')] }];
    design.workloads[0]!.journeys = [{ journeyId: 'j', usersPerSec: 10 }];
    expect(validateDesign(design, resolve)).toEqual([]);
  });

  it('rejects steps on missing nodes or non-services', () => {
    const design = validDesign();
    design.journeys = [{ id: 'j', name: 'Checkout', steps: [step('ghost'), step('db')] }];
    const messages = validateDesign(design, resolve).map((i) => i.message);
    expect(messages.some((m) => m.includes("its service doesn't exist"))).toBe(true);
    expect(messages.some((m) => m.includes('is not a service'))).toBe(true);
  });

  it('rejects workloads that run missing journeys', () => {
    const design = validDesign();
    design.workloads[0]!.journeys = [{ journeyId: 'nope', usersPerSec: 10 }];
    expect(validateDesign(design, resolve).some((i) => i.targetId === 'w')).toBe(true);
  });
});
