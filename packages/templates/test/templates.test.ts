import { resolveArchetype } from '@scalelab/catalog';
import { validateDesign } from '@scalelab/model';
import { describe, expect, it } from 'vitest';
import { checkoutShop, microShop, shopSphere } from '../src';

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

describe('ShopSphere microservices template', () => {
  it('is a valid design', () => {
    const issues = validateDesign(microShop(), resolveArchetype);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('derives flows for both services and handlers for both consumers', () => {
    const d = microShop();
    expect(d.flows.map((f) => f.id).sort()).toEqual(['read:catalog', 'read:orders', 'write:catalog', 'write:orders']);
    expect(d.handlers?.map((h) => h.consumerNodeId).sort()).toEqual(['analytics', 'email']);
    const ordersWrite = d.flows.find((f) => f.id === 'write:orders')!;
    expect(ordersWrite.steps).toContainEqual({ kind: 'publish', nodeId: 'kafka', effect: 'sent to Order events' });
    expect(ordersWrite.steps.some((s) => s.kind === 'service-call' && s.nodeId === 'inventory')).toBe(true);
  });

  it('applies options', () => {
    const d = microShop({ partitions: 24, emailWorkers: 6 });
    const kafka = d.nodes.find((n) => n.id === 'kafka')!.config;
    const email = d.nodes.find((n) => n.id === 'email')!.config;
    expect(kafka.type === 'queue' && kafka.partitions).toBe(24);
    expect(email.type === 'compute' && email.instances).toBe(6);
  });
});

describe('ShopSphere checkout template', () => {
  it('is a valid design with a valid journey', () => {
    const d = checkoutShop();
    expect(validateDesign(d, resolveArchetype).filter((i) => i.severity === 'error')).toEqual([]);
    expect(d.journeys?.[0]?.steps.map((s) => s.name)).toEqual(['Log in', 'Browse products', 'Add to cart', 'Pay', 'See confirmation']);
  });

  it('charges the card before saving the order', () => {
    const d = checkoutShop();
    const pay = d.flows.find((f) => f.id === 'write:orders')!;
    const effects = JSON.stringify(pay.steps);
    expect(effects.indexOf('Stripe call went through')).toBeLessThan(effects.indexOf('saved to Orders DB'));
  });

  it('applies options to the Pay step and Stripe', () => {
    const d = checkoutShop({ payRetries: 3, idempotentPay: true, stripeTimeoutRate: 0.05 });
    const step = d.journeys![0]!.steps.find((s) => s.id === 'pay')!;
    expect(step.retries).toBe(3);
    expect(step.idempotent).toBe(true);
    const stripe = d.nodes.find((n) => n.id === 'stripe')!.config;
    expect(stripe.type === 'external' && stripe.timeoutRate).toBe(0.05);
  });
});
