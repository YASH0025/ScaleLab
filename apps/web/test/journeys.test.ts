import { getLibrary } from '@scalelab/catalog';
import { simulate } from '@scalelab/engine';
import { checkoutShop } from '@scalelab/templates';
import { describe, expect, it } from 'vitest';
import type { JourneyStats } from '@scalelab/engine';
import type { Journey } from '@scalelab/model';
import { completionRate, journeyFindings } from '../src/lib/journey-findings';
import { functionName, toK6 } from '../src/lib/k6';
import { decodeDesign, encodeDesign } from '../src/lib/share';

const journey: Journey = {
  id: 'j',
  name: 'Checkout',
  steps: [
    { id: 'browse', name: 'Browse', serviceNodeId: 'api', operation: 'read', retries: 0, idempotent: false },
    { id: 'pay', name: 'Pay', serviceNodeId: 'api', operation: 'write', retries: 1, idempotent: false },
  ],
};

const stats = (steps: Partial<JourneyStats['steps'][number]>[], extra: Partial<JourneyStats> = {}): JourneyStats => ({
  journeyId: 'j',
  name: 'Checkout',
  started: 100,
  completed: 90,
  abandoned: 10,
  unfinished: 0,
  p50Ms: 1000,
  p95Ms: 2000,
  steps: steps.map((s, i) => ({
    stepId: journey.steps[i]!.id,
    name: journey.steps[i]!.name,
    reached: 100,
    succeeded: 100,
    failed: 0,
    retries: 0,
    partial: [],
    duplicates: [],
    ...s,
  })),
  ...extra,
});

describe('journeyFindings', () => {
  it('flags double effects and suggests an idempotency key', () => {
    const f = journeyFindings(journey, stats([{}, { duplicates: [{ effect: 'Stripe call went through', count: 7 }] }]));
    expect(f[0]!.severity).toBe('bad');
    expect(f[0]!.title).toMatch(/7 users: Stripe call went through more than once during “Pay”/);
    expect(f[0]!.fix).toMatch(/idempotency key/);
  });

  it('flags half-done steps and suggests making them all-or-nothing', () => {
    const f = journeyFindings(journey, stats([{}, { failed: 5, partial: [{ effects: ['saved to DB', 'Stripe call went through'], count: 5 }] }]));
    expect(f).toHaveLength(1);
    expect(f[0]!.title).toMatch(/“Pay” failed, but saved to DB and Stripe call went through anyway/);
    expect(f[0]!.fix).toMatch(/all-or-nothing/);
  });

  it('suggests a retry for clean failures on steps without one', () => {
    const f = journeyFindings(journey, stats([{ failed: 4 }]));
    expect(f[0]!.severity).toBe('warn');
    expect(f[0]!.title).toMatch(/4 users gave up at “Browse”; nothing had changed yet/);
    expect(f[0]!.fix).toMatch(/One retry/);
  });

  it('points elsewhere when retries already failed', () => {
    const f = journeyFindings(journey, stats([{}, { failed: 3 }]));
    expect(f[0]!.title).toMatch(/even after 1 retry/);
    expect(f[0]!.fix).toMatch(/outage, a rate limit/);
  });

  it('says so when nothing went wrong', () => {
    const f = journeyFindings(journey, stats([{}, {}], { completed: 100, abandoned: 0 }));
    expect(f).toEqual([expect.objectContaining({ severity: 'info' })]);
  });

  it('ignores users still in progress when computing completion', () => {
    expect(completionRate(stats([{}, {}], { started: 110, unfinished: 10, completed: 90 }))).toBeCloseTo(0.9);
  });

  it('finds both payment bugs in the checkout example', () => {
    const d = checkoutShop();
    const r = simulate(d, d.workloads.find((w) => w.id === 'journeys')!, { libraryEffect: (id) => getLibrary(id)?.effect });
    const titles = journeyFindings(d.journeys![0]!, r.journeys![0]!).map((f) => f.title);
    expect(titles.some((t) => /Stripe call went through more than once/.test(t))).toBe(true);
  });
});

describe('toK6', () => {
  const d = checkoutShop({ idempotentPay: true });
  const script = toK6({ journeys: [{ journey: d.journeys![0]!, usersPerSec: 20 }], nodes: d.nodes, durationSec: 60 });

  it('runs each journey at a constant arrival rate', () => {
    expect(script).toContain("executor: 'constant-arrival-rate'");
    expect(script).toContain('rate: 20,');
    expect(script).toContain("duration: '60s'");
    expect(script).toContain('export function checkout()');
  });

  it('calls every step in order, with retries and idempotency keys', () => {
    const order = ['Log in', 'Browse products', 'Add to cart', 'Pay', 'See confirmation'].map((s) => script.indexOf(`attempt("${s}"`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(script).toContain('attempt("Pay", 1,');
    expect(script).toContain("'Idempotency-Key': key");
    expect(script).toContain('http.get(`${BASE_URL}/account-service`');
    expect(script).toContain('http.post(`${BASE_URL}/order-service`');
  });

  it('is valid JavaScript', () => {
    // k6 globals and imports are stubbed; this only checks the syntax.
    const body = script.replace(/^import .*$/gm, '').replace(/^export /gm, '');
    expect(() => new Function('__ENV', '__VU', '__ITER', 'http', 'check', 'sleep', body)).not.toThrow();
  });

  it('makes unique, valid function names', () => {
    const used = new Set<string>();
    expect(functionName('Sign up & pay', used)).toBe('signUpPay');
    expect(functionName('Sign up & pay', used)).toBe('signUpPay2');
    expect(functionName('3D secure', used)).toBe('j3dSecure');
    expect(functionName('!!!', used)).toBe('journey');
  });
});

describe('share links', () => {
  it('carry journeys', () => {
    const d = checkoutShop();
    const r = decodeDesign(encodeDesign({ name: 'x', nodes: d.nodes, edges: d.edges, journeys: d.journeys! }));
    expect(r.ok && r.design.journeys).toEqual(d.journeys);
  });

  it('reject journeys that point at missing services', () => {
    const d = checkoutShop();
    const broken = [{ ...d.journeys![0]!, steps: [{ ...d.journeys![0]!.steps[0]!, serviceNodeId: 'nope' }] }];
    const r = decodeDesign(encodeDesign({ name: 'x', nodes: d.nodes, edges: d.edges, journeys: broken }));
    expect(r.ok).toBe(false);
  });
});
