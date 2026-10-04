import { getLibrary } from '@scalelab/catalog';
import { simulate } from '@scalelab/engine';
import { microShop, shopSphere } from '@scalelab/templates';
import { describe, expect, it } from 'vitest';
import { findBottleneck, findSustainedBottleneck, healthOf, healthOfSample } from '../src/lib/findings';

const libraryEffect = (id: string) => getLibrary(id)?.effect;

function runAt(rps: number, cache: boolean) {
  const design = shopSphere({ cache });
  const result = simulate(design, { ...design.workloads[0]!, durationSec: 20, pattern: { kind: 'constant', rps } }, { libraryEffect });
  return { design, sample: result.timeline[15]! };
}

describe('findBottleneck', () => {
  it('blames the database, not the busy backends, when PostgreSQL saturates', () => {
    const { design, sample } = runAt(4000, false);
    const b = findBottleneck(sample, design.nodes, design.edges);
    expect(b?.nodeId).toBe('postgres');
    expect(b?.suggestions).toContain('Add Redis in front');
    expect(b?.explanation).toMatch(/increase database pressure/);
  });

  it('suggests tuning the cache when one already exists', () => {
    const design = shopSphere({ cache: true, cacheHitRatio: 0.1 });
    const result = simulate(design, { ...design.workloads[0]!, durationSec: 20, pattern: { kind: 'constant', rps: 4000 } }, { libraryEffect });
    const b = findBottleneck(result.timeline[15], design.nodes, design.edges);
    expect(b?.nodeId).toBe('postgres');
    expect(b?.suggestions[0]).toBe('Raise the cache hit ratio');
  });

  it('reports nothing when everything has headroom', () => {
    const { design, sample } = runAt(1000, true);
    expect(findBottleneck(sample, design.nodes, design.edges)).toBeUndefined();
  });
});

describe('healthOf', () => {
  it('maps utilization to health', () => {
    expect(healthOf(undefined)).toBe('idle');
    expect(healthOf(0.5)).toBe('ok');
    expect(healthOf(0.75)).toBe('warm');
    expect(healthOf(0.95)).toBe('hot');
    expect(healthOf(0.2, false)).toBe('down');
  });
});

describe('queue findings', () => {
  const runMicro = (opts: Parameters<typeof microShop>[0], sec = 55) => {
    const design = microShop(opts);
    const result = simulate(design, design.workloads[0]!, { libraryEffect });
    return { design, sample: result.timeline.find((s) => s.simTimeSec === sec)! };
  };

  it('blames the partition limit when consumers have spare workers', () => {
    const { design, sample } = runMicro({ emailWorkers: 6 });
    const b = findBottleneck(sample, design.nodes, design.edges);
    expect(b?.nodeId).toBe('kafka');
    expect(b?.explanation).toMatch(/6 partitions/);
    expect(b?.explanation).toMatch(/won't help until you add partitions/);
    expect(b?.suggestions[0]).toBe('Add partitions');
  });

  it('blames busy consumers when partitions are not the limit', () => {
    const { design, sample } = runMicro({ partitions: 24 });
    const b = findBottleneck(sample, design.nodes, design.edges);
    expect(b?.nodeId).toBe('kafka');
    expect(b?.explanation).toMatch(/Email worker is \d+% busy/);
  });

  it('reports nothing once the backlog keeps up', () => {
    const { design, sample } = runMicro({ partitions: 24, emailWorkers: 6 });
    expect(findBottleneck(sample, design.nodes, design.edges)).toBeUndefined();
  });

  it('judges queue health by lag', () => {
    const base = { nodeId: 'q', utilization: 0, queueLength: 10, avgWaitMs: 0, servedPerSec: 10, up: true };
    expect(healthOfSample({ ...base, lagMs: 200 }, 'event-stream')).toBe('ok');
    expect(healthOfSample({ ...base, lagMs: 2000 }, 'event-stream')).toBe('warm');
    expect(healthOfSample({ ...base, lagMs: 9000 }, 'message-queue')).toBe('hot');
    expect(healthOfSample({ ...base, lagMs: 9000 }, 'relational-db')).toBe('ok');
  });
});

describe('findSustainedBottleneck', () => {
  const sample = (sec: number, util: number) => ({
    simTimeSec: sec,
    offeredRps: 100,
    throughputRps: 100,
    p50Ms: 10,
    p95Ms: 20,
    p99Ms: 30,
    errorRate: 0,
    inFlight: 0,
    nodes: [{ nodeId: 'postgres', utilization: util, queueLength: 5, avgWaitMs: 1, servedPerSec: 100, up: true }],
  });
  const design = shopSphere({ cache: false });

  it('ignores a one-second spike', () => {
    const samples = [0.7, 0.75, 0.95, 0.7, 0.72].map((u, i) => sample(i + 1, u));
    expect(findSustainedBottleneck(samples, design.nodes, design.edges)).toBeUndefined();
  });

  it('reports pressure that lasts', () => {
    const samples = [0.7, 0.93, 0.95, 0.96, 0.72].map((u, i) => sample(i + 1, u));
    expect(findSustainedBottleneck(samples, design.nodes, design.edges)?.nodeId).toBe('postgres');
  });
});
