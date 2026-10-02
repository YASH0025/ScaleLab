import type { TrafficPattern } from '@scalelab/model';

/** Requests per second the pattern asks for at simulated time `tSec`. */
export function rateAt(pattern: TrafficPattern, tSec: number, durationSec: number): number {
  switch (pattern.kind) {
    case 'constant':
      return pattern.rps;
    case 'ramp': {
      const progress = durationSec > 0 ? Math.min(1, Math.max(0, tSec / durationSec)) : 1;
      return pattern.fromRps + (pattern.toRps - pattern.fromRps) * progress;
    }
    case 'spike': {
      const inSpike = tSec >= pattern.spikeAtSec && tSec < pattern.spikeAtSec + pattern.spikeDurationSec;
      return inSpike ? pattern.spikeRps : pattern.baseRps;
    }
    case 'burst': {
      const inBurst = tSec % pattern.burstEverySec < pattern.burstDurationSec;
      return inBurst ? pattern.burstRps : pattern.baseRps;
    }
  }
}

/** Upper bound on the rate, used for thinning. */
export function peakRate(pattern: TrafficPattern): number {
  switch (pattern.kind) {
    case 'constant':
      return pattern.rps;
    case 'ramp':
      return Math.max(pattern.fromRps, pattern.toRps);
    case 'spike':
      return Math.max(pattern.baseRps, pattern.spikeRps);
    case 'burst':
      return Math.max(pattern.baseRps, pattern.burstRps);
  }
}
