import { buildDesign, shopSphere } from '@scalelab/templates';
import { describe, expect, it } from 'vitest';
import { HOURS_PER_MONTH, databaseSizeSteps, estimateCost, formatUsd } from '../src/cost';

const line = (est: ReturnType<typeof estimateCost>, id: string) => est.lines.find((l) => l.nodeId === id)!;

describe('estimateCost', () => {
  it('prices backends per instance', () => {
    const est = estimateCost(shopSphere({ backendInstances: 3 }).nodes);
    const api = line(est, 'api');
    expect(api.monthlyUsd).toBeCloseTo(0.096 * HOURS_PER_MONTH * 3, 1);
    expect(api.basis).toBe('3 × m6i.large');
  });

  it('sizes databases by concurrent queries and adds replicas', () => {
    expect(databaseSizeSteps(25, 25)).toBe(0);
    expect(databaseSizeSteps(30, 25)).toBe(1);
    expect(databaseSizeSteps(100, 25)).toBe(2);
    const est = estimateCost(shopSphere({ readReplicas: 1 }).nodes); // pool 30 → xlarge
    const db = line(est, 'postgres');
    expect(db.basis).toBe('db.m6g.xlarge + 1 read replica');
    expect(db.monthlyUsd).toBeCloseTo(0.159 * 2 * HOURS_PER_MONTH * 2, 1);
  });

  it('prices caches, frontends and clusters', () => {
    const est = estimateCost(shopSphere().nodes);
    expect(line(est, 'redis').monthlyUsd).toBeCloseTo(0.149 * HOURS_PER_MONTH, 1);
    expect(line(est, 'storefront').monthlyUsd).toBe(0);
    const kafka = estimateCost(
      buildDesign('t', '', [{ id: 'k', tech: 'kafka', label: 'k', x: 0, y: 0 }], []).nodes,
    );
    expect(line(kafka, 'k').monthlyUsd).toBeCloseTo(0.21 * 3 * HOURS_PER_MONTH, 1);
  });

  it('grows load balancer cost with traffic', () => {
    const nodes = shopSphere().nodes;
    const idle = line(estimateCost(nodes), 'alb').monthlyUsd;
    const busy = line(estimateCost(nodes, { requestsPerSec: 5000 }), 'alb').monthlyUsd;
    expect(idle).toBeCloseTo(0.0225 * HOURS_PER_MONTH, 1);
    expect(busy).toBeCloseTo((0.0225 + 5 * 0.008) * HOURS_PER_MONTH, 1);
  });

  it('prices SQS per message once usage is known', () => {
    const nodes = buildDesign('t', '', [{ id: 'q', tech: 'aws-sqs', label: 'q', x: 0, y: 0 }], []).nodes;
    expect(line(estimateCost(nodes), 'q').monthlyUsd).toBe(0);
    // 100 messages/s × 2.628 M s × 3 requests = 788.4 M requests × $0.40 / M
    expect(line(estimateCost(nodes, { messagesPerSec: { q: 100 } }), 'q').monthlyUsd).toBeCloseTo(315.36, 1);
  });

  it('marks third-party services as billed by the provider', () => {
    const nodes = buildDesign('t', '', [{ id: 's', tech: 'stripe', label: 's', x: 0, y: 0 }], []).nodes;
    const est = estimateCost(nodes);
    expect(line(est, 's').basis).toMatch(/Billed by Stripe/);
    expect(est.unpricedCount).toBe(0);
  });

  it('flags technologies without a price', () => {
    const nodes = buildDesign('t', '', [{ id: 'm', tech: 'kubernetes-cluster', label: 'm', x: 0, y: 0 }], []).nodes;
    const est = estimateCost(nodes);
    expect(est.unpricedCount).toBe(1);
    expect(line(est, 'm').unpriced).toBe(true);
  });

  it('adds up the lines', () => {
    const est = estimateCost(shopSphere().nodes, { requestsPerSec: 1000 });
    expect(est.monthlyUsd).toBeCloseTo(est.lines.reduce((s, l) => s + l.monthlyUsd, 0), 2);
  });
});

describe('formatUsd', () => {
  it('rounds large amounts and keeps cents for small ones', () => {
    expect(formatUsd(1234.56)).toBe('$1,235');
    expect(formatUsd(16.43)).toBe('$16.43');
  });
});
