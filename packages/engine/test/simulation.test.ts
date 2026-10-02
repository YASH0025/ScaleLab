import { getLibrary } from '@scalelab/catalog';
import type { ApiFlow, Design, Workload } from '@scalelab/model';
import { shopSphere, type ShopSphereOptions } from '@scalelab/templates';
import { describe, expect, it } from 'vitest';
import { type ScheduledChange, type SimulationOptions, createSimulation, simulate } from '../src';

const libraryEffect = (id: string) => getLibrary(id)?.effect;

function run(
  options: ShopSphereOptions,
  rps: number,
  durationSec = 30,
  extra: Omit<SimulationOptions, 'libraryEffect'> & { seed?: number } = {},
) {
  const design = shopSphere(options);
  const workload: Workload = {
    ...design.workloads[0]!,
    durationSec,
    pattern: { kind: 'constant', rps },
    seed: extra.seed ?? 42,
  };
  return { design, result: simulate(design, workload, { libraryEffect, ...extra }) };
}

const node = (r: ReturnType<typeof run>['result'], id: string) => r.nodes.find((n) => n.nodeId === id)!;

/** One backend behind a client, nothing else: a textbook M/M/c queue. */
function singleService(opts: { workers: number; meanMs: number; queueLimit?: number; timeoutMs?: number }): Design {
  const flow: ApiFlow = {
    id: 'f',
    name: 'Work',
    method: 'GET',
    path: '/work',
    entryNodeId: 'svc',
    steps: [
      { kind: 'call', nodeId: 'svc', operation: 'process' },
      { kind: 'respond', status: 200 },
    ],
    retry: { attempts: 0, backoffMs: 0 },
  };
  return {
    schemaVersion: 1,
    meta: { name: 'single', description: '', createdAt: '2026-10-03T00:00:00Z' },
    nodes: [
      { id: 'c', technologyId: 'web-browser', label: 'Client', position: { x: 0, y: 0 }, config: { type: 'client', available: true, extraLatencyMs: 0 }, libraries: [] },
      {
        id: 'svc',
        technologyId: 'go-gin',
        label: 'Service',
        position: { x: 0, y: 1 },
        config: {
          type: 'compute',
          available: true,
          extraLatencyMs: 0,
          instances: 1,
          workersPerInstance: opts.workers,
          serviceTime: { kind: 'exponential', meanMs: opts.meanMs },
          queueLimit: opts.queueLimit ?? 10_000,
          timeoutMs: opts.timeoutMs ?? 60_000,
        },
        libraries: [],
      },
    ],
    edges: [{ id: 'e', source: 'c', target: 'svc', protocol: 'http', networkLatency: { kind: 'constant', valueMs: 0 } }],
    flows: [flow],
    workloads: [],
  };
}

const steady = (rps: number, durationSec = 60, seed = 1): Workload => ({
  id: 'w',
  name: 'w',
  durationSec,
  pattern: { kind: 'constant', rps },
  mix: [{ flowId: 'f', weight: 1 }],
  seed,
});

describe('queueing fundamentals', () => {
  it('utilization ≈ arrival rate × service time / workers at low load', () => {
    // 100 rps × 50 ms / 10 workers = 0.5
    const r = simulate(singleService({ workers: 10, meanMs: 50 }), steady(100));
    expect(r.nodes[0]!.avgUtilization).toBeGreaterThan(0.45);
    expect(r.nodes[0]!.avgUtilization).toBeLessThan(0.55);
    expect(r.totals.errorRate).toBe(0);
    expect(r.totals.meanMs).toBeGreaterThan(45);
    expect(r.totals.meanMs).toBeLessThan(60);
  });

  it('rejects requests when the queue is full', () => {
    const r = simulate(singleService({ workers: 1, meanMs: 100, queueLimit: 5 }), steady(50, 20));
    expect(r.totals.rejected).toBeGreaterThan(0);
    expect(r.totals.completed).toBeLessThan(r.totals.arrivals);
  });

  it('times out requests that wait too long', () => {
    const r = simulate(singleService({ workers: 1, meanMs: 100, timeoutMs: 200 }), steady(20, 20));
    expect(r.totals.timedOut).toBeGreaterThan(0);
  });

  it('accounts for every request', () => {
    const r = simulate(singleService({ workers: 2, meanMs: 50, queueLimit: 20, timeoutMs: 500 }), steady(80, 20));
    const t = r.totals;
    expect(t.ok + t.fallbacks + t.rejected + t.timedOut + t.errors + t.unfinished).toBe(t.arrivals);
  });
});

describe('determinism', () => {
  it('same design + same seed gives identical results', () => {
    const design = shopSphere();
    const a = simulate(design, design.workloads[0]!, { libraryEffect });
    const b = simulate(design, design.workloads[0]!, { libraryEffect });
    expect(a.totals).toEqual(b.totals);
    expect(a.timeline).toEqual(b.timeline);
    expect(a.traces).toEqual(b.traces);
  });

  it('a different seed gives different results', () => {
    const a = run({}, 1000, 10, { seed: 1 }).result;
    const b = run({}, 1000, 10, { seed: 2 }).result;
    expect(a.totals.arrivals).not.toBe(b.totals.arrivals);
  });

  it('stepping with runUntil matches a full run', () => {
    const design = shopSphere();
    const workload = { ...design.workloads[0]!, durationSec: 20 };
    const full = simulate(design, workload, { libraryEffect });
    const sim = createSimulation(design, workload, { libraryEffect });
    let t = 0;
    while (!sim.runUntil((t += 250))) {
      /* advance in chunks, like a Web Worker would */
    }
    expect(sim.result().totals).toEqual(full.totals);
  });
});

describe('architecture lessons (ShopSphere)', () => {
  it('a cache with a high hit ratio reduces database load', () => {
    const noCache = run({ cache: false }, 2000).result;
    const withCache = run({ cache: true, cacheHitRatio: 0.9 }, 2000).result;
    expect(node(withCache, 'postgres').avgUtilization).toBeLessThan(node(noCache, 'postgres').avgUtilization * 0.5);
  });

  it('adding backends does not fix a saturated database', () => {
    const two = run({ cache: false, backendInstances: 2 }, 4000).result;
    const eight = run({ cache: false, backendInstances: 8 }, 4000).result;
    expect(node(two, 'postgres').avgUtilization).toBeGreaterThan(0.9);
    expect(node(eight, 'postgres').avgUtilization).toBeGreaterThan(0.9);
    const ratio = eight.totals.completed / two.totals.completed;
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
    expect(eight.totals.errorRate).toBeGreaterThan(0.1);
  });

  it('a cache does fix the saturated database', () => {
    const r = run({ cache: true }, 4000).result;
    expect(r.totals.errorRate).toBe(0);
    expect(r.totals.completed / 30).toBeGreaterThan(3900);
    expect(node(r, 'postgres').avgUtilization).toBeLessThan(0.7);
  });

  it('read replicas raise read capacity', () => {
    const primaryOnly = run({ cache: false }, 4000).result;
    const replicas = run({ cache: false, readReplicas: 2 }, 4000).result;
    expect(replicas.totals.completed).toBeGreaterThan(primaryOnly.totals.completed * 1.3);
  });

  it('observes roughly the configured cache hit ratio', () => {
    const r = run({ cache: true, cacheHitRatio: 0.8 }, 1000).result;
    const ratios = r.timeline.flatMap((s) => s.nodes.filter((n) => n.nodeId === 'redis').map((n) => n.observedHitRatio ?? 0));
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    expect(avg).toBeGreaterThan(0.75);
    expect(avg).toBeLessThan(0.85);
  });
});

describe('failures', () => {
  it('killing a backend instance shifts traffic to the survivor', () => {
    const changes: ScheduledChange[] = [{ atSec: 20, nodeId: 'api', instance: 0, action: 'down' }];
    const r = run({ cache: true }, 1000, 40, { changes }).result;
    const before = r.timeline.find((s) => s.simTimeSec === 15)!.nodes.find((n) => n.nodeId === 'api')!;
    const after = r.timeline.find((s) => s.simTimeSec === 30)!.nodes.find((n) => n.nodeId === 'api')!;
    expect(before.instances!.every((i) => i.up)).toBe(true);
    expect(after.instances![0]!.up).toBe(false);
    expect(after.instances![0]!.utilization).toBe(0);
    expect(after.instances![1]!.utilization).toBeGreaterThan(before.instances![1]!.utilization * 1.5);
    const late = r.timeline.filter((s) => s.simTimeSec > 22 && s.simTimeSec <= 40);
    expect(late.every((s) => s.errorRate === 0)).toBe(true);
    expect(r.totals.completed).toBeGreaterThan(r.totals.arrivals * 0.99);
  });

  it('when Redis goes down every read falls through to PostgreSQL', () => {
    const healthy = run({ cache: true }, 1000, 20).result;
    const redisDown = run({ cache: true }, 1000, 20, {
      changes: [{ atSec: 0, nodeId: 'redis', action: 'down' }],
    }).result;
    const dbOpsPerRequest = (r: typeof healthy) => node(r, 'postgres').served / r.totals.arrivals;
    expect(dbOpsPerRequest(healthy)).toBeLessThan(0.4);
    expect(dbOpsPerRequest(redisDown)).toBeGreaterThan(0.95);
    expect(redisDown.totals.errorRate).toBe(0);
  });

  it('a database outage fails requests, or returns the fallback when one is defined', () => {
    const changes: ScheduledChange[] = [{ atSec: 0, nodeId: 'postgres', action: 'down' }];
    const failing = run({ cache: false }, 200, 10, { changes }).result;
    expect(failing.totals.errors).toBeGreaterThan(0);
    expect(failing.totals.ok).toBe(0);

    const design = shopSphere({ cache: false });
    for (const f of design.flows) f.fallback = { status: 200 };
    const withFallback = simulate(
      design,
      { ...design.workloads[0]!, durationSec: 10, pattern: { kind: 'constant', rps: 200 } },
      { libraryEffect, changes },
    );
    expect(withFallback.totals.fallbacks).toBeGreaterThan(0);
    expect(withFallback.totals.errors).toBe(0);
  });

  it('added latency on a dependency shows up in response times', () => {
    const base = run({ cache: false }, 500, 20).result;
    const slow = run({ cache: false }, 500, 20, {
      changes: [{ atSec: 0, nodeId: 'postgres', action: 'latency', extraLatencyMs: 100 }],
    }).result;
    expect(slow.totals.p50Ms).toBeGreaterThan(base.totals.p50Ms + 80);
  });

  it('retries amplify load on an overloaded system', () => {
    const design = singleService({ workers: 1, meanMs: 100, queueLimit: 5 });
    const noRetry = simulate(design, steady(30, 20));
    design.flows[0]!.retry = { attempts: 2, backoffMs: 50 };
    const withRetry = simulate(design, steady(30, 20));
    expect(withRetry.totals.retries).toBeGreaterThan(0);
    expect(withRetry.nodes[0]!.served).toBeGreaterThanOrEqual(noRetry.nodes[0]!.served);
    expect(withRetry.totals.retries + withRetry.totals.arrivals).toBeGreaterThan(withRetry.totals.arrivals);
  });
});

describe('results', () => {
  it('records sampled traces with spans', () => {
    const r = run({ cache: true }, 500, 10, { traceEvery: 10 }).result;
    expect(r.traces.length).toBeGreaterThan(0);
    const trace = r.traces.find((t) => t.status === 'ok')!;
    expect(trace.spans.length).toBeGreaterThan(2);
    expect(trace.totalMs).toBeGreaterThan(0);
    expect(r.traces.some((t) => t.spans.some((s) => s.outcome === 'cache-hit' || s.outcome === 'cache-miss'))).toBe(true);
  });

  it('produces one timeline sample per second with offered load', () => {
    const r = run({ cache: true }, 1000, 15).result;
    expect(r.timeline.length).toBeGreaterThanOrEqual(15);
    const mid = r.timeline[7]!;
    expect(mid.offeredRps).toBeGreaterThan(850);
    expect(mid.offeredRps).toBeLessThan(1150);
  });

  it('follows a spike pattern', () => {
    const design = shopSphere();
    const r = simulate(
      design,
      {
        ...design.workloads[0]!,
        durationSec: 30,
        pattern: { kind: 'spike', baseRps: 200, spikeRps: 2000, spikeAtSec: 10, spikeDurationSec: 5 },
      },
      { libraryEffect },
    );
    const at = (sec: number) => r.timeline.find((s) => s.simTimeSec === sec)!.offeredRps;
    expect(at(5)).toBeLessThan(400);
    expect(at(13)).toBeGreaterThan(1600);
    expect(at(25)).toBeLessThan(400);
  });

  it('applies library effects to backend processing time', () => {
    const withLibs = run({ cache: true }, 300, 20).result;
    const design = shopSphere({ cache: true });
    const bare = simulate(design, { ...design.workloads[0]!, durationSec: 20, pattern: { kind: 'constant', rps: 300 } });
    // Spring Data JPA adds ~2 ms per request in the catalog.
    expect(withLibs.totals.meanMs).toBeGreaterThan(bare.totals.meanMs);
  });
});
