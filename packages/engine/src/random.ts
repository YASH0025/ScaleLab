import type { Distribution } from '@scalelab/model';

/**
 * Seeded pseudo-random number generator (mulberry32).
 * The same seed always produces the same sequence, on every machine.
 * That's what lets collaborators run the same simulation locally and see identical results.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Standard normal variate (Box–Muller). */
  normal(): number {
    const u1 = 1 - this.next(); // (0, 1]
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** Exponential variate with the given mean. */
  exponential(mean: number): number {
    return -mean * Math.log(1 - this.next());
  }
}

const Z99 = 2.3263478740408408; // 99th percentile of the standard normal

/**
 * Lognormal parameters from a mean and a p99, the two numbers people actually know.
 * Solves mean = e^(mu + s²/2) and p99 = e^(mu + z·s), taking the smaller root for s.
 */
export function lognormalParams(meanMs: number, p99Ms: number): { mu: number; sigma: number } {
  const d = Math.log(Math.max(p99Ms, meanMs * 1.0001) / meanMs);
  const disc = Z99 * Z99 - 2 * d;
  const sigma = disc >= 0 ? Z99 - Math.sqrt(disc) : Z99;
  return { mu: Math.log(meanMs) - (sigma * sigma) / 2, sigma };
}

/** Draws one duration in milliseconds from a distribution. */
export function sample(rng: Rng, dist: Distribution): number {
  switch (dist.kind) {
    case 'constant':
      return dist.valueMs;
    case 'exponential':
      return rng.exponential(dist.meanMs);
    case 'lognormal': {
      const { mu, sigma } = lognormalParams(dist.meanMs, dist.p99Ms);
      return Math.exp(mu + sigma * rng.normal());
    }
  }
}

/** Long-run mean of a distribution, used for capacity estimates. */
export function meanOf(dist: Distribution): number {
  switch (dist.kind) {
    case 'constant':
      return dist.valueMs;
    case 'exponential':
    case 'lognormal':
      return dist.meanMs;
  }
}
