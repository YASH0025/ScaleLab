import { getLibrary } from '@scalelab/catalog';
import { simulate } from '@scalelab/engine';
import { shopSphere } from '@scalelab/templates';
import { describe, expect, it } from 'vitest';
import { findBottleneck, healthOf } from '../src/lib/findings';

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
