import { describe, expect, it } from 'vitest';
import { EventQueue } from '../src/event-queue';
import { Rng, lognormalParams, sample } from '../src/random';
import { type Clock, Resource } from '../src/resource';
import { summarize } from '../src/stats';
import { peakRate, rateAt } from '../src/traffic';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(7);
    const b = new Rng(7);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('differs across seeds', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  it('produces exponential samples with the requested mean', () => {
    const rng = new Rng(3);
    let sum = 0;
    for (let i = 0; i < 50_000; i++) sum += rng.exponential(40);
    expect(sum / 50_000).toBeCloseTo(40, 0);
  });

  it('produces lognormal samples matching mean and p99', () => {
    const rng = new Rng(11);
    const values = Array.from({ length: 100_000 }, () => sample(rng, { kind: 'lognormal', meanMs: 30, p99Ms: 120 }));
    const s = summarize(values);
    expect(s.mean).toBeGreaterThan(28.5);
    expect(s.mean).toBeLessThan(31.5);
    expect(s.p99).toBeGreaterThan(110);
    expect(s.p99).toBeLessThan(130);
  });

  it('keeps lognormal parameters finite for awkward inputs', () => {
    const { mu, sigma } = lognormalParams(10, 5000);
    expect(Number.isFinite(mu)).toBe(true);
    expect(Number.isFinite(sigma)).toBe(true);
  });
});

describe('EventQueue', () => {
  it('pops in time order and keeps insertion order for ties', () => {
    const q = new EventQueue();
    const order: string[] = [];
    q.push(5, () => order.push('c'));
    q.push(1, () => order.push('a'));
    q.push(5, () => order.push('d'));
    q.push(3, () => order.push('b'));
    while (q.size > 0) q.pop()!.fn();
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });
});

/** A tiny manual clock for testing resources in isolation. */
class TestClock implements Clock {
  t = 0;
  private q = new EventQueue();
  now() {
    return this.t;
  }
  schedule(delay: number, fn: () => void) {
    this.q.push(this.t + delay, fn);
  }
  runAll() {
    while (this.q.size > 0) {
      const e = this.q.pop()!;
      this.t = e.time;
      e.fn();
    }
  }
}

describe('Resource', () => {
  it('queues when full and serves in FIFO order', () => {
    const clock = new TestClock();
    const r = new Resource('r', 1, 10, Infinity, clock);
    const started: string[] = [];
    const take = (name: string) =>
      r.acquire(
        (lease) => {
          started.push(name);
          clock.schedule(10, () => r.release(lease));
        },
        () => started.push(`${name}:failed`),
      );
    take('a');
    take('b');
    take('c');
    expect(r.queueLength).toBe(2);
    clock.runAll();
    expect(started).toEqual(['a', 'b', 'c']);
  });

  it('rejects when the queue is full', () => {
    const clock = new TestClock();
    const r = new Resource('r', 1, 1, Infinity, clock);
    const failures: string[] = [];
    for (let i = 0; i < 3; i++) r.acquire(() => {}, (reason) => failures.push(reason));
    expect(failures).toEqual(['rejected']);
  });

  it('times out waiters that wait too long', () => {
    const clock = new TestClock();
    const r = new Resource('r', 1, 10, 50, clock);
    const failures: string[] = [];
    r.acquire((lease) => clock.schedule(100, () => r.release(lease)), () => {});
    r.acquire(() => failures.push('started'), (reason) => failures.push(reason));
    clock.runAll();
    expect(failures).toEqual(['timeout']);
  });

  it('fails waiters and invalidates leases when taken down', () => {
    const clock = new TestClock();
    const r = new Resource('r', 1, 10, Infinity, clock);
    let held: Parameters<Resource['release']>[0] | undefined;
    const failures: string[] = [];
    r.acquire((lease) => (held = lease), () => {});
    r.acquire(() => {}, (reason) => failures.push(reason));
    r.takeDown();
    expect(failures).toEqual(['down']);
    expect(r.isLive(held!)).toBe(false);
    r.bringUp();
    expect(r.inUse).toBe(0);
  });

  it('measures utilization as busy time over capacity', () => {
    const clock = new TestClock();
    const r = new Resource('r', 2, 10, Infinity, clock);
    r.acquire((lease) => clock.schedule(500, () => r.release(lease)), () => {});
    clock.runAll();
    clock.t = 1000;
    const s = r.sample();
    expect(s.busyMs / (s.capacity * 1000)).toBeCloseTo(0.25, 5);
  });
});

describe('traffic patterns', () => {
  it('ramps linearly', () => {
    const p = { kind: 'ramp' as const, fromRps: 100, toRps: 300 };
    expect(rateAt(p, 0, 10)).toBe(100);
    expect(rateAt(p, 5, 10)).toBe(200);
    expect(rateAt(p, 10, 10)).toBe(300);
    expect(peakRate(p)).toBe(300);
  });

  it('spikes inside the window only', () => {
    const p = { kind: 'spike' as const, baseRps: 100, spikeRps: 900, spikeAtSec: 10, spikeDurationSec: 5 };
    expect(rateAt(p, 9.9, 60)).toBe(100);
    expect(rateAt(p, 12, 60)).toBe(900);
    expect(rateAt(p, 15, 60)).toBe(100);
  });

  it('bursts periodically', () => {
    const p = { kind: 'burst' as const, baseRps: 10, burstRps: 500, burstEverySec: 10, burstDurationSec: 2 };
    expect(rateAt(p, 1, 60)).toBe(500);
    expect(rateAt(p, 5, 60)).toBe(10);
    expect(rateAt(p, 21, 60)).toBe(500);
  });
});
