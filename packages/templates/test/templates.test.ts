import { resolveArchetype } from '@scalelab/catalog';
import { validateDesign } from '@scalelab/model';
import { describe, expect, it } from 'vitest';
import { shopSphere } from '../src';

describe('ShopSphere template', () => {
  it('is a valid design with the cache', () => {
    const issues = validateDesign(shopSphere(), resolveArchetype);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('is a valid design without the cache', () => {
    const issues = validateDesign(shopSphere({ cache: false }), resolveArchetype);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('applies options', () => {
    const design = shopSphere({ backendInstances: 8, cacheHitRatio: 0.95, readReplicas: 2 });
    const api = design.nodes.find((n) => n.id === 'api')!;
    const redis = design.nodes.find((n) => n.id === 'redis')!;
    const db = design.nodes.find((n) => n.id === 'postgres')!;
    expect(api.config.type === 'compute' && api.config.instances).toBe(8);
    expect(redis.config.type === 'cache' && redis.config.hitRatio).toBe(0.95);
    expect(db.config.type === 'relational-db' && db.config.readReplicas).toBe(2);
  });

  it('does not share default objects with the catalog', () => {
    const a = shopSphere({ backendInstances: 5 });
    const b = shopSphere();
    const instances = (d: typeof a) => {
      const c = d.nodes.find((n) => n.id === 'api')!.config;
      return c.type === 'compute' ? c.instances : -1;
    };
    expect(instances(a)).toBe(5);
    expect(instances(b)).toBe(2);
  });
});
