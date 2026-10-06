import { getLibrary, upgradeNode } from '@scalelab/catalog';
import type { Design, Workload } from '@scalelab/model';
import { type NodeSpec, buildDesign } from '@scalelab/templates';
import { describe, expect, it } from 'vitest';
import { type SimulationResult, simulate } from '../src';

const libraryEffect = (id: string) => getLibrary(id)?.effect;
const constant = (ms: number) => ({ kind: 'constant' as const, valueMs: ms });

const users: NodeSpec = { id: 'users', tech: 'web-browser', label: 'Users', x: 0, y: 0 };
const api = (extra: Record<string, unknown> = {}): NodeSpec => ({
  id: 'api',
  tech: 'go-gin',
  label: 'API',
  x: 0,
  y: 0,
  config: { instances: 4, workersPerInstance: 200, serviceTime: constant(2), queueLimit: 10_000, timeoutMs: 30_000, ...extra },
});

function run(design: Design, rps: number, durationSec = 10, writeShare?: number): SimulationResult {
  const base = design.workloads[0]!;
  const mix =
    writeShare === undefined
      ? base.mix
      : base.mix.map((m) => ({ ...m, weight: m.flowId.startsWith('write:') ? writeShare : 1 - writeShare }));
  const workload: Workload = { ...base, durationSec, pattern: { kind: 'constant', rps }, mix };
  return simulate(design, workload, { libraryEffect });
}

const served = (r: SimulationResult, id: string) => r.nodes.find((n) => n.nodeId === id)!;

describe('CDN', () => {
  const design = (hitRatio: number) =>
    buildDesign(
      't',
      '',
      [users, { id: 'cdn', tech: 'aws-cloudfront', label: 'CDN', x: 0, y: 0, config: { hitRatio } }, api(), { id: 'db', tech: 'postgresql', label: 'DB', x: 0, y: 0 }],
      [['users', 'cdn'], ['cdn', 'api'], ['api', 'db']],
    );

  it('answers hits at the edge, so only misses reach the service', () => {
    const r = run(design(0.9), 1000, 10, 0);
    const reachedApi = served(r, 'api').served;
    expect(reachedApi).toBeGreaterThan(700);
    expect(reachedApi).toBeLessThan(1300); // about 10% of 10,000 reads
    expect(r.totals.errorRate).toBe(0);
  });

  it('lets every write through to the service', () => {
    const r = run(design(1), 500, 10, 1);
    expect(served(r, 'api').served).toBeGreaterThan(4500);
  });

  it('serves media from object storage through the CDN', () => {
    const d = buildDesign(
      't',
      '',
      [users, { id: 'cdn', tech: 'cloudflare-cdn', label: 'CDN', x: 0, y: 0, config: { hitRatio: 0.95 } }, { id: 's3', tech: 'aws-s3', label: 'Images', x: 0, y: 0 }],
      [['users', 'cdn'], ['cdn', 's3']],
    );
    expect(d.flows.map((f) => f.name)).toEqual(['Download · Images']);
    const r = run(d, 2000, 10);
    expect(r.totals.errorRate).toBe(0);
    expect(served(r, 's3').served).toBeLessThan(2000); // 5% of 20,000
  });

  it('supports direct uploads to object storage', () => {
    const d = buildDesign('t', '', [users, { id: 's3', tech: 'aws-s3', label: 'Uploads', x: 0, y: 0 }], [['users', 's3']]);
    expect(d.flows.map((f) => f.name)).toEqual(['Download · Uploads', 'Upload · Uploads']);
  });
});

describe('API gateway and rate limiting', () => {
  it('answers 429 above the limit and protects the service behind it', () => {
    const d = buildDesign('t', '', [users, { id: 'rl', tech: 'rate-limiter', label: 'Limiter', x: 0, y: 0, config: { rateLimitRps: 1000 } }, api()], [['users', 'rl'], ['rl', 'api']]);
    const r = run(d, 2000, 10);
    expect(r.totals.rejected / r.totals.arrivals).toBeGreaterThan(0.4);
    expect(r.totals.rejected / r.totals.arrivals).toBeLessThan(0.6);
    const s = r.timeline.find((x) => x.simTimeSec === 5)!.nodes.find((n) => n.nodeId === 'rl')!;
    expect(s.servedPerSec).toBe(1000);
    expect(s.failedPerSec).toBeGreaterThan(800);
  });

  it('routes through DNS and a gateway to the service', () => {
    const d = buildDesign(
      't',
      '',
      [users, { id: 'dns', tech: 'aws-route53', label: 'DNS', x: 0, y: 0 }, { id: 'gw', tech: 'aws-api-gateway', label: 'Gateway', x: 0, y: 0 }, api()],
      [['users', 'dns'], ['dns', 'gw'], ['gw', 'api']],
    );
    expect(d.flows[0]!.entryNodeId).toBe('dns');
    expect(run(d, 500, 5).totals.errorRate).toBe(0);
  });
});

describe('data stores', () => {
  it('runs NoSQL, wide-column and search stores, reading them side by side', () => {
    const d = buildDesign(
      't',
      '',
      [
        users,
        api(),
        { id: 'mongo', tech: 'mongodb', label: 'Mongo', x: 0, y: 0 },
        { id: 'cass', tech: 'cassandra', label: 'Cassandra', x: 0, y: 0 },
        { id: 'es', tech: 'elasticsearch', label: 'Search', x: 0, y: 0 },
      ],
      [['users', 'api'], ['api', 'mongo'], ['api', 'cass'], ['api', 'es']],
    );
    const read = d.flows.find((f) => f.id === 'read:api')!;
    expect(read.steps.some((s) => s.kind === 'parallel')).toBe(true);
    const r = run(d, 300, 10);
    expect(r.totals.errorRate).toBe(0);
    for (const id of ['mongo', 'cass', 'es']) expect(served(r, id).served).toBeGreaterThan(2500);
  });

  it('adds capacity with each shard', () => {
    const d = (shards: number) =>
      buildDesign(
        't',
        '',
        [users, api(), { id: 'db', tech: 'postgresql', label: 'DB', x: 0, y: 0, config: { connectionPool: 20, readQuery: constant(20), queueLimit: 100_000, timeoutMs: 60_000, shards } }],
        [['users', 'api'], ['api', 'db']],
      );
    // 20 connections × 20 ms = 1,000 queries per second per shard.
    const one = run(d(1), 2000, 10, 0);
    const four = run(d(4), 2000, 10, 0);
    expect(served(one, 'db').peakUtilization).toBeGreaterThan(0.95);
    expect(served(four, 'db').peakUtilization).toBeLessThan(0.7);
    expect(four.totals.p95Ms).toBeLessThan(one.totals.p95Ms / 5);
  });
});

describe('serverless and real-time', () => {
  it('throttles functions past their concurrency limit', () => {
    const d = buildDesign(
      't',
      '',
      [users, { id: 'fn', tech: 'aws-lambda', label: 'Function', x: 0, y: 0, config: { workersPerInstance: 50, serviceTime: constant(100) } }],
      [['users', 'fn']],
    );
    // 50 concurrent × 100 ms = 500 per second; 1,000 per second arrive.
    const r = run(d, 1000, 10);
    expect(r.totals.rejected / r.totals.arrivals).toBeGreaterThan(0.3);
  });

  it('lets functions consume from a queue', () => {
    const d = buildDesign(
      't',
      '',
      [users, api(), { id: 'q', tech: 'aws-sqs', label: 'Queue', x: 0, y: 0 }, { id: 'fn', tech: 'aws-lambda', label: 'Function', x: 0, y: 0 }],
      [['users', 'api'], ['api', 'q'], ['q', 'fn']],
    );
    const r = run(d, 500, 10, 0.5);
    expect(r.totals.messagesConsumed).toBeGreaterThan(2000);
  });

  it('takes traffic straight into WebSocket servers', () => {
    const d = buildDesign('t', '', [users, { id: 'ws', tech: 'websocket-server', label: 'Chat', x: 0, y: 0 }, { id: 'cache', tech: 'redis', label: 'Presence', x: 0, y: 0 }], [
      ['users', 'ws'],
      ['ws', 'cache'],
    ]);
    const r = run(d, 2000, 5);
    expect(r.totals.errorRate).toBe(0);
    expect(served(r, 'ws').served).toBeGreaterThan(9000);
  });
});

it('ignores monitoring, which sits off the request path', () => {
  const d = buildDesign('t', '', [users, api(), { id: 'prom', tech: 'prometheus', label: 'Metrics', x: 0, y: 0 }], [['users', 'api'], ['api', 'prom']]);
  const r = run(d, 200, 5);
  expect(r.totals.errorRate).toBe(0);
  expect(r.warnings).toEqual([]);
});

it('upgrades saved placeholder configs to the real defaults', () => {
  const old = { id: 'm', technologyId: 'mongodb', label: 'm', position: { x: 0, y: 0 }, libraries: [], config: { type: 'generic' as const, available: false, extraLatencyMs: 0, params: {} } };
  const upgraded = upgradeNode(old);
  expect(upgraded.config.type).toBe('relational-db');
  expect(upgraded.config.available).toBe(false);
  const current = upgradeNode(upgraded);
  expect(current).toBe(upgraded);
});
