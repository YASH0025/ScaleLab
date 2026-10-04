import { getLibrary } from '@scalelab/catalog';
import type { Design, Journey, Workload } from '@scalelab/model';
import { type NodeSpec, buildDesign, checkoutShop } from '@scalelab/templates';
import { describe, expect, it } from 'vitest';
import { type ScheduledChange, type SimulationResult, simulate } from '../src';

const libraryEffect = (id: string) => getLibrary(id)?.effect;
const constant = (ms: number) => ({ kind: 'constant' as const, valueMs: ms });

const web: NodeSpec = { id: 'web', tech: 'web-browser', label: 'Users', x: 0, y: 0 };
const api: NodeSpec = {
  id: 'api',
  tech: 'go-gin',
  label: 'API',
  x: 0,
  y: 0,
  config: { instances: 2, workersPerInstance: 200, serviceTime: constant(2), queueLimit: 10_000, timeoutMs: 60_000 },
};
const db: NodeSpec = {
  id: 'db',
  tech: 'postgresql',
  label: 'DB',
  x: 0,
  y: 0,
  config: { connectionPool: 100, readQuery: constant(2), writeQuery: constant(3), queueLimit: 10_000, timeoutMs: 60_000 },
};
const stripe = (extra: Record<string, unknown>): NodeSpec => ({
  id: 'stripe',
  tech: 'stripe',
  label: 'Stripe',
  x: 0,
  y: 0,
  config: { latency: constant(100), errorRate: 0, timeoutRate: 0, timeoutMs: 1000, rateLimitRps: 0, ...extra },
});

const pay = (retries = 0, idempotent = false): Journey => ({
  id: 'j',
  name: 'Checkout',
  steps: [{ id: 'pay', name: 'Pay', serviceNodeId: 'api', operation: 'write', retries, idempotent }],
});

function payDesign(stripeConfig: Record<string, unknown>, journey: Journey = pay()): Design {
  return buildDesign('t', '', [web, api, db, stripe(stripeConfig)], [['web', 'api'], ['api', 'db'], ['api', 'stripe']], {
    journeys: [journey],
    usersPerSec: 50,
  });
}

function runJourneys(design: Design, durationSec = 20, changes: ScheduledChange[] = []): SimulationResult {
  const workload: Workload = { ...design.workloads.find((w) => w.id === 'journeys')!, durationSec };
  return simulate(design, workload, { libraryEffect, changes });
}

const payStep = (r: SimulationResult) => r.journeys![0]!.steps[0]!;

describe('external services', () => {
  it('a healthy provider lets every journey complete', () => {
    const r = runJourneys(payDesign({}));
    const j = r.journeys![0]!;
    expect(j.started).toBeGreaterThan(800);
    expect(j.completed).toBe(j.started);
    expect(payStep(r).partial).toEqual([]);
  });

  it('errors fail the step before anything happens at the provider', () => {
    const r = runJourneys(payDesign({ errorRate: 1 }));
    const step = payStep(r);
    expect(step.succeeded).toBe(0);
    // The order was saved first, so the failure leaves only that behind; Stripe did nothing.
    expect(step.partial).toEqual([{ effects: ['saved to DB'], count: step.failed }]);
  });

  it('timeouts fail the step after the provider already did the work', () => {
    const r = runJourneys(payDesign({ timeoutRate: 1 }));
    const step = payStep(r);
    expect(step.succeeded).toBe(0);
    expect(step.partial[0]!.effects).toEqual(['saved to DB', 'Stripe call went through']);
    expect(step.partial[0]!.count).toBe(step.failed);
    expect(r.totals.timedOut).toBeGreaterThan(0);
  });

  it('a slow reply past the caller timeout counts as a timeout', () => {
    const r = runJourneys(payDesign({ latency: constant(2000), timeoutMs: 1000 }), 10);
    expect(payStep(r).succeeded).toBe(0);
    expect(r.totals.timedOut).toBeGreaterThan(0);
  });

  it('rate limits answer 429 beyond the allowed calls per second', () => {
    const r = runJourneys(payDesign({ rateLimitRps: 20 }), 15);
    const step = payStep(r);
    expect(step.failed / step.reached).toBeGreaterThan(0.4); // 50 users/s against a 20/s limit
    expect(r.totals.rejected).toBeGreaterThan(0);
  });

  it('a provider outage fails every call', () => {
    const r = runJourneys(payDesign({}), 10, [{ atSec: 0, nodeId: 'stripe', action: 'down' }]);
    expect(payStep(r).succeeded).toBe(0);
  });

  it('reports calls and failures per second on the provider', () => {
    const r = runJourneys(payDesign({ errorRate: 0.5 }), 10);
    const s = r.timeline.find((x) => x.simTimeSec === 5)!.nodes.find((n) => n.nodeId === 'stripe')!;
    expect(s.servedPerSec).toBeGreaterThan(30);
    expect(s.failedPerSec!).toBeGreaterThan(s.servedPerSec * 0.3);
  });
});

describe('journeys', () => {
  it('retries without an idempotency key charge some customers twice', () => {
    const r = runJourneys(payDesign({ timeoutRate: 0.3 }, pay(2, false)));
    const dup = payStep(r).duplicates.find((d) => d.effect === 'Stripe call went through');
    expect(dup?.count ?? 0).toBeGreaterThan(50);
  });

  it('an idempotency key stops double charges', () => {
    const r = runJourneys(payDesign({ timeoutRate: 0.3 }, pay(2, true)));
    expect(payStep(r).duplicates.filter((d) => d.effect === 'Stripe call went through')).toEqual([]);
  });

  it('retries recover users from failures that left nothing behind', () => {
    const noRetry = runJourneys(payDesign({ errorRate: 0.2 }, pay(0)));
    const withRetry = runJourneys(payDesign({ errorRate: 0.2 }, pay(2, true)));
    const rate = (r: SimulationResult) => r.journeys![0]!.completed / r.journeys![0]!.started;
    expect(rate(noRetry)).toBeLessThan(0.85);
    expect(rate(withRetry)).toBeGreaterThan(0.98);
    expect(payStep(withRetry).retries).toBeGreaterThan(0);
  });

  it('users who fail a step stop there', () => {
    const journey: Journey = {
      id: 'j',
      name: 'Two steps',
      steps: [
        { id: 'a', name: 'Pay', serviceNodeId: 'api', operation: 'write', retries: 0, idempotent: false },
        { id: 'b', name: 'Look', serviceNodeId: 'api', operation: 'read', retries: 0, idempotent: false },
      ],
    };
    const r = runJourneys(payDesign({ errorRate: 1 }, journey));
    const j = r.journeys![0]!;
    expect(j.steps[1]!.reached).toBe(0);
    expect(j.abandoned).toBe(j.started - j.unfinished);
  });

  it('explains when a step has no path to run', () => {
    const design = buildDesign('t', '', [web, api, db], [['web', 'api'], ['api', 'db']], {
      journeys: [{ id: 'j', name: 'J', steps: [{ id: 's', name: 'Write', serviceNodeId: 'db', operation: 'write', retries: 0, idempotent: false }] }],
    });
    expect(() => runJourneys(design)).toThrow(/has no write path/);
  });

  it('journeys can run alongside normal traffic', () => {
    const design = payDesign({});
    const workload: Workload = {
      ...design.workloads[0]!,
      durationSec: 10,
      pattern: { kind: 'constant', rps: 200 },
      journeys: [{ journeyId: 'j', usersPerSec: 20 }],
    };
    const r = simulate(design, workload, { libraryEffect });
    expect(r.journeys![0]!.started).toBeGreaterThan(150);
    expect(r.totals.arrivals).toBeGreaterThan(2000);
  });
});

describe('checkout example', () => {
  const run = (opts: Parameters<typeof checkoutShop>[0]) => {
    const d = checkoutShop(opts);
    return simulate(d, d.workloads.find((w) => w.id === 'journeys')!, { libraryEffect });
  };
  const step = (r: SimulationResult, id: string) => r.journeys![0]!.steps.find((s) => s.stepId === id)!;

  it('is deterministic', () => {
    expect(run({}).journeys).toEqual(run({}).journeys);
  });

  it('shows double charges with retries, none with an idempotency key, and charged-without-order with no retries', () => {
    const retry = step(run({}), 'pay');
    const idempotent = step(run({ idempotentPay: true }), 'pay');
    const noRetry = step(run({ payRetries: 0 }), 'pay');
    expect(retry.duplicates.find((d) => d.effect === 'Stripe call went through')!.count).toBeGreaterThan(5);
    expect(idempotent.duplicates).toEqual([]);
    const chargedNoOrder = noRetry.partial.find((p) => p.effects.includes('Stripe call went through') && !p.effects.includes('saved to Orders DB'));
    expect(chargedNoOrder!.count).toBeGreaterThan(5);
  });
});
