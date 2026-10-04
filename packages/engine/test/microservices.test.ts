import { getLibrary } from '@scalelab/catalog';
import type { Design, Workload } from '@scalelab/model';
import { type NodeSpec, buildDesign, microShop } from '@scalelab/templates';
import { describe, expect, it } from 'vitest';
import { type ScheduledChange, type SimulationResult, simulate } from '../src';

const libraryEffect = (id: string) => getLibrary(id)?.effect;
const constant = (ms: number) => ({ kind: 'constant' as const, valueMs: ms });

function run(design: Design, rps: number, durationSec = 20, changes: ScheduledChange[] = []): SimulationResult {
  const workload: Workload = { ...design.workloads[0]!, durationSec, pattern: { kind: 'constant', rps } };
  return simulate(design, workload, { libraryEffect, changes });
}

const nodeSummary = (r: SimulationResult, id: string) => r.nodes.find((n) => n.nodeId === id)!;
const sampleAt = (r: SimulationResult, sec: number, id: string) =>
  r.timeline.find((s) => s.simTimeSec === sec)!.nodes.find((n) => n.nodeId === id)!;

const web: NodeSpec = { id: 'web', tech: 'web-browser', label: 'Users', x: 0, y: 0 };
const service = (id: string, workers: number, ms: number, instances = 1): NodeSpec => ({
  id,
  tech: 'go-gin',
  label: id,
  x: 0,
  y: 0,
  config: { instances, workersPerInstance: workers, serviceTime: constant(ms), queueLimit: 10_000, timeoutMs: 60_000 },
});
const database = (id: string, pool: number, ms: number): NodeSpec => ({
  id,
  tech: 'postgresql',
  label: id,
  x: 0,
  y: 0,
  config: { connectionPool: pool, readQuery: constant(ms), writeQuery: constant(ms), queueLimit: 10_000, timeoutMs: 60_000 },
});
const stream = (id: string, partitions: number, extra: Record<string, unknown> = {}): NodeSpec => ({
  id,
  tech: 'kafka',
  label: id,
  x: 0,
  y: 0,
  config: { partitions, publishLatency: constant(2), ...extra },
});
const queue = (id: string, extra: Record<string, unknown> = {}): NodeSpec => ({
  id,
  tech: 'rabbitmq',
  label: id,
  x: 0,
  y: 0,
  config: { publishLatency: constant(1), ...extra },
});
const worker = (id: string, workers: number, ms: number, instances = 1): NodeSpec => ({
  id,
  tech: 'background-worker',
  label: id,
  x: 0,
  y: 0,
  config: { instances, workersPerInstance: workers, serviceTime: constant(ms), queueLimit: 10_000, timeoutMs: 60_000 },
});

/** Every request is a write that publishes, so message rates are easy to reason about. */
function writesOnly(design: Design): Design {
  const mix = design.workloads[0]!.mix.map((m) => ({ ...m, weight: m.flowId.startsWith('write:') ? 1 : 0 }));
  return { ...design, workloads: [{ ...design.workloads[0]!, mix: mix.filter((m) => m.weight > 0) }] };
}

describe('microservices: synchronous calls', () => {
  it('a callee frees its worker when its part is done, while the caller keeps waiting', () => {
    // api → helper (5 ms), then api → slow DB (100 ms). The helper is busy ~5 ms per request; api ~106 ms.
    const design = buildDesign(
      't',
      '',
      [web, service('api', 20, 1), service('helper', 20, 5), database('db', 200, 100)],
      [['web', 'api'], ['api', 'helper'], ['api', 'db']],
    );
    const r = run(design, 100);
    const api = nodeSummary(r, 'api').avgUtilization; // ≈ 100/s × 0.106 s / 20 workers = 0.53
    const helper = nodeSummary(r, 'helper').avgUtilization; // ≈ 100/s × 0.005 s / 20 workers = 0.025
    expect(api).toBeGreaterThan(0.4);
    expect(helper).toBeLessThan(0.06);
    expect(r.totals.errorRate).toBe(0);
  });

  it('a slow downstream service slows its callers end to end', () => {
    const fast = buildDesign('t', '', [web, service('api', 200, 2), service('helper', 200, 5)], [['web', 'api'], ['api', 'helper']]);
    const slow = buildDesign('t', '', [web, service('api', 200, 2), service('helper', 200, 150)], [['web', 'api'], ['api', 'helper']]);
    expect(run(slow, 50).totals.p50Ms).toBeGreaterThan(run(fast, 50).totals.p50Ms + 120);
  });

  it('a saturated downstream service backs up the caller (cascading)', () => {
    // helper can do 4 / 50 ms = 80 rps; we send 200.
    const design = buildDesign('t', '', [web, service('api', 100, 1), service('helper', 4, 50)], [['web', 'api'], ['api', 'helper']]);
    const r = run(design, 200, 15);
    expect(nodeSummary(r, 'helper').peakUtilization).toBeGreaterThan(0.95);
    expect(nodeSummary(r, 'api').peakUtilization).toBeGreaterThan(0.95);
  });

  it('every service behind the load balancer receives traffic', () => {
    const design = buildDesign(
      't',
      '',
      [web, { id: 'lb', tech: 'aws-alb', label: 'lb', x: 0, y: 0 }, service('a', 50, 5), service('b', 50, 5)],
      [['web', 'lb'], ['lb', 'a'], ['lb', 'b']],
    );
    const r = run(design, 400);
    const a = nodeSummary(r, 'a').served;
    const b = nodeSummary(r, 'b').served;
    expect(a / (a + b)).toBeGreaterThan(0.4);
    expect(a / (a + b)).toBeLessThan(0.6);
  });
});

describe('async messaging', () => {
  const pipeline = (consumerMs: number, workers = 4, partitions = 0, instances = 1) =>
    writesOnly(
      buildDesign(
        't',
        '',
        [web, service('api', 200, 2), partitions > 0 ? stream('events', partitions) : queue('events'), worker('w', workers, consumerMs, instances)],
        [['web', 'api'], ['api', 'events'], ['events', 'w']],
      ),
    );

  it('producers do not wait for consumers', () => {
    const r = run(pipeline(500, 200), 100);
    // The 500 ms consumer is not on the request path; p95 is just the user's network round trip plus ~5 ms.
    expect(r.totals.p95Ms).toBeLessThan(250);
    expect(r.totals.errorRate).toBe(0);
  });

  it('consumers that keep up leave no backlog', () => {
    const r = run(pipeline(10, 4), 100); // capacity 400 msg/s
    expect(r.totals.messagesConsumed).toBeGreaterThan(r.totals.messagesPublished * 0.99);
    expect(nodeSummary(r, 'events').maxLagMs!).toBeLessThan(200);
  });

  it('slow consumers build a growing backlog and lag, while requests still succeed', () => {
    const r = run(pipeline(100, 4), 100); // capacity 40 msg/s, 100 published/s
    expect(r.totals.errorRate).toBe(0);
    const early = sampleAt(r, 5, 'events');
    const late = sampleAt(r, 18, 'events');
    expect(late.queueLength).toBeGreaterThan(early.queueLength * 2);
    expect(late.lagMs!).toBeGreaterThan(5000);
    expect(late.consumedPerSec!).toBeGreaterThan(35);
    expect(late.consumedPerSec!).toBeLessThan(45);
  });

  it('partitions cap consumer parallelism: more workers do not help, more partitions do', () => {
    const capped = run(pipeline(100, 10, 2, 2), 50, 20); // 20 workers, but 2 partitions → 20 msg/s
    const moreWorkers = run(pipeline(100, 20, 2, 2), 50, 20);
    const morePartitions = run(pipeline(100, 10, 20, 2), 50, 20);
    const lagAt = (r: SimulationResult) => sampleAt(r, 18, 'events').lagMs!;
    expect(sampleAt(capped, 18, 'events').consumedPerSec!).toBeLessThan(25);
    expect(lagAt(moreWorkers)).toBeGreaterThan(lagAt(capped) * 0.9);
    expect(lagAt(morePartitions)).toBeLessThan(500);
  });

  it('streams fan out: every consumer group gets every message', () => {
    const design = writesOnly(
      buildDesign(
        't',
        '',
        [web, service('api', 200, 2), stream('events', 0), worker('a', 10, 5), worker('b', 10, 5)],
        [['web', 'api'], ['api', 'events'], ['events', 'a'], ['events', 'b']],
      ),
    );
    const r = run(design, 100);
    expect(r.totals.messagesConsumed).toBeGreaterThan(r.totals.messagesPublished * 1.95);
    expect(nodeSummary(r, 'a').served).toBeGreaterThan(nodeSummary(r, 'b').served * 0.9);
  });

  it('queues make consumers compete: each message is processed once', () => {
    const design = writesOnly(
      buildDesign(
        't',
        '',
        [web, service('api', 200, 2), queue('jobs'), worker('a', 10, 5), worker('b', 10, 5)],
        [['web', 'api'], ['api', 'jobs'], ['jobs', 'a'], ['jobs', 'b']],
      ),
    );
    const r = run(design, 100);
    expect(r.totals.messagesConsumed).toBeLessThanOrEqual(r.totals.messagesPublished);
    expect(r.totals.messagesConsumed).toBeGreaterThan(r.totals.messagesPublished * 0.98);
    expect(nodeSummary(r, 'a').served).toBeGreaterThan(0);
    expect(nodeSummary(r, 'b').served).toBeGreaterThan(0);
  });

  it('a full backlog pushes back on producers', () => {
    const design = writesOnly(
      buildDesign(
        't',
        '',
        [web, service('api', 200, 2), queue('jobs', { maxBacklog: 50 }), worker('w', 1, 200)],
        [['web', 'api'], ['api', 'jobs'], ['jobs', 'w']],
      ),
    );
    const r = run(design, 100, 10);
    expect(r.totals.rejected).toBeGreaterThan(0);
    expect(sampleAt(r, 8, 'jobs').utilization).toBeGreaterThan(0.9);
  });

  it('nothing consuming means messages pile up', () => {
    const design = writesOnly(buildDesign('t', '', [web, service('api', 200, 2), queue('jobs')], [['web', 'api'], ['api', 'jobs']]));
    const r = run(design, 100, 10);
    expect(r.totals.messagesConsumed).toBe(0);
    expect(sampleAt(r, 9, 'jobs').queueLength).toBeGreaterThan(700);
  });

  it('a broker outage fails the requests that publish', () => {
    const r = run(pipeline(10, 4), 100, 10, [{ atSec: 0, nodeId: 'events', action: 'down' }]);
    expect(r.totals.ok).toBe(0);
    expect(r.totals.errors).toBeGreaterThan(0);
  });

  it('a consumer outage builds a backlog that drains once it is back', () => {
    const changes: ScheduledChange[] = [
      { atSec: 5, nodeId: 'w', action: 'down' },
      { atSec: 12, nodeId: 'w', action: 'up' },
    ];
    const r = run(pipeline(10, 4), 100, 25, changes);
    expect(r.totals.errorRate).toBe(0);
    expect(sampleAt(r, 11, 'events').queueLength).toBeGreaterThan(400);
    expect(sampleAt(r, 22, 'events').queueLength).toBeLessThan(20);
  });

  it('messages that keep failing are retried, then dead-lettered', () => {
    const design = writesOnly(
      buildDesign(
        't',
        '',
        [web, service('api', 200, 2), queue('jobs'), worker('w', 10, 5), database('db', 10, 5)],
        [['web', 'api'], ['api', 'jobs'], ['jobs', 'w'], ['w', 'db']],
      ),
    );
    const r = run(design, 50, 15, [{ atSec: 0, nodeId: 'db', action: 'down' }]);
    expect(r.totals.messagesConsumed).toBe(0);
    expect(r.totals.messagesDeadLettered).toBeGreaterThan(0);
    // Each dead letter took MAX_DELIVERIES attempts, so the worker saw more jobs than messages published.
    expect(nodeSummary(r, 'w').served).toBeGreaterThan(r.totals.messagesDeadLettered * 2);
  });
});

describe('ShopSphere microservices example', () => {
  it('is deterministic', () => {
    const d = microShop();
    const w = { ...d.workloads[0]!, durationSec: 20 };
    expect(simulate(d, w, { libraryEffect }).totals).toEqual(simulate(d, w, { libraryEffect }).totals);
  });

  it('teaches the partition lesson: email lag grows unless partitions and workers both scale', () => {
    const lag = (opts: Parameters<typeof microShop>[0]) => {
      const d = microShop(opts);
      const r = simulate(d, d.workloads[0]!, { libraryEffect });
      expect(r.totals.errorRate).toBe(0);
      return sampleAt(r, 55, 'kafka').lagMs!;
    };
    const base = lag({});
    expect(base).toBeGreaterThan(10_000);
    expect(lag({ emailWorkers: 6 })).toBeGreaterThan(base * 0.9);
    expect(lag({ partitions: 24, emailWorkers: 6 })).toBeLessThan(1000);
  }, 30_000);
});
