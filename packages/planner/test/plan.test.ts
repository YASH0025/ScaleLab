import { buildDesign, microShop, shopSphere } from '@scalelab/templates';
import { describe, expect, it } from 'vitest';
import { type PlanProgress, type PlanTarget, describeChange, planCapacity } from '../src';

const target: PlanTarget = { rps: 3000, p95Ms: 300, maxErrorRate: 0.001, maxLagMs: 5000 };
const knob = (r: ReturnType<typeof planCapacity>, nodeId: string, k: string) => r.changes.find((c) => c.nodeId === nodeId && c.knob === k);

describe('planCapacity', () => {
  it('scales a design that misses the targets until it meets them', () => {
    const d = shopSphere({ cache: false });
    const r = planCapacity(d.nodes, d.edges, target);
    expect(r.status).toBe('met');
    expect(r.before!.meets).toBe(false);
    expect(r.before!.errorRate).toBeGreaterThan(0.01);
    expect(r.after!.meets).toBe(true);
    // The database is the bottleneck, so that's what gets more capacity, not the backends.
    expect(r.changes.some((c) => c.nodeId === 'postgres')).toBe(true);
    expect(knob(r, 'api', 'instances')).toBeUndefined();
  }, 60_000);

  it('right-sizes an oversized design and reports the saving', () => {
    const d = shopSphere({ backendInstances: 10, readReplicas: 2 });
    const r = planCapacity(d.nodes, d.edges, target);
    expect(r.status).toBe('right-sized');
    expect(r.after!.meets).toBe(true);
    expect(r.after!.cost.monthlyUsd).toBeLessThan(r.before!.cost.monthlyUsd * 0.5);
    // Keeps the redundancy the design already had.
    expect(knob(r, 'api', 'instances')?.to).toBe(2);
    expect(r.notes[0]).toMatch(/saves \$[\d,]+ a month/);
  }, 60_000);

  it('raises Kafka partitions before paying for more workers', () => {
    const d = microShop();
    const r = planCapacity(d.nodes, d.edges, target);
    expect(r.status).toBe('met');
    expect(r.before!.lagMs).toBeGreaterThan(target.maxLagMs);
    expect(r.after!.lagMs).toBeLessThanOrEqual(target.maxLagMs);
    const partitions = knob(r, 'kafka', 'partitions');
    expect(partitions!.to).toBeGreaterThan(partitions!.from);
  }, 60_000);

  it('says when only faster code would help', () => {
    const d = shopSphere();
    const r = planCapacity(d.nodes, d.edges, { ...target, p95Ms: 40 });
    expect(r.status).toBe('unreachable');
    expect(r.notes.some((n) => /work itself is too slow/.test(n))).toBe(true);
  }, 60_000);

  it('explains when the design cannot receive traffic', () => {
    const d = buildDesign('t', '', [{ id: 'api', tech: 'go-gin', label: 'api', x: 0, y: 0 }], []);
    const r = planCapacity(d.nodes, d.edges, target);
    expect(r.status).toBe('no-traffic');
    expect(r.notes[0]).toMatch(/client/);
  });

  it('is deterministic and reports progress within its budget', () => {
    const d = shopSphere({ cache: false });
    const progress: PlanProgress[] = [];
    const a = planCapacity(d.nodes, d.edges, target, { maxEvaluations: 6, onProgress: (p) => progress.push(p) });
    const b = planCapacity(d.nodes, d.edges, target, { maxEvaluations: 6 });
    expect(a.changes).toEqual(b.changes);
    expect(a.evaluations).toBeLessThanOrEqual(6);
    expect(progress.length).toBe(a.evaluations);
    expect(progress[0]!.message).toBe('Testing your current design');
  }, 60_000);

  it('never changes the input design', () => {
    const d = shopSphere({ cache: false });
    const snapshot = JSON.stringify(d.nodes);
    planCapacity(d.nodes, d.edges, target, { maxEvaluations: 5 });
    expect(JSON.stringify(d.nodes)).toBe(snapshot);
  }, 60_000);
});

describe('headroom', () => {
  it('keeps every component under the utilization limit at the target load', () => {
    const d = shopSphere({ cache: false });
    const r = planCapacity(d.nodes, d.edges, { ...target, rps: 5000, maxUtilization: 0.8 });
    expect(r.status).toBe('met');
    expect(r.after!.peakUtilization).toBeLessThanOrEqual(0.8);
  }, 60_000);

  it('a looser limit allows a cheaper setup', () => {
    const d = shopSphere({ cache: false });
    const strict = planCapacity(d.nodes, d.edges, { ...target, rps: 5000, maxUtilization: 0.7 });
    const loose = planCapacity(d.nodes, d.edges, { ...target, rps: 5000, maxUtilization: 0.95 });
    expect(strict.after!.meets && loose.after!.meets).toBe(true);
    expect(loose.after!.cost.monthlyUsd).toBeLessThanOrEqual(strict.after!.cost.monthlyUsd);
  }, 90_000);
});

describe('describeChange', () => {
  it('reads like a sentence', () => {
    expect(describeChange({ nodeId: 'k', label: 'Order events', knob: 'partitions', from: 6, to: 12 })).toBe('Order events: 6 → 12 partitions');
  });
});
