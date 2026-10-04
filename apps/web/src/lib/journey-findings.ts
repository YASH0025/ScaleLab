import type { JourneyStats } from '@scalelab/engine';
import type { Journey } from '@scalelab/model';

/**
 * Turns journey results into plain-language findings with a fix for each.
 * The two classic ones are "charged twice" (a retry repeated a side effect)
 * and "charged but no order" (a step failed after something already happened).
 */
export interface JourneyFinding {
  severity: 'bad' | 'warn' | 'info';
  stepId: string;
  /** How many users this affected. */
  count: number;
  title: string;
  fix: string;
}

const users = (n: number) => `${n.toLocaleString()} user${n === 1 ? '' : 's'}`;
const quote = (s: string) => `“${s}”`;
const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

export function journeyFindings(journey: Journey, stats: JourneyStats): JourneyFinding[] {
  const out: JourneyFinding[] = [];
  for (const step of stats.steps) {
    const def = journey.steps.find((s) => s.id === step.stepId);
    const retries = def?.retries ?? 0;

    for (const dup of step.duplicates) {
      out.push({
        severity: 'bad',
        stepId: step.stepId,
        count: dup.count,
        title: `${users(dup.count)}: ${dup.effect} more than once during ${quote(step.name)}`,
        fix: def?.idempotent
          ? `Retries of ${quote(step.name)} still repeat this. Make sure the idempotency key reaches the service that does it.`
          : `A retry repeated work that had already happened. Send an idempotency key with ${quote(step.name)} so the service ignores repeats (Stripe, PayPal and most payment APIs support one).`,
      });
    }

    let partialTotal = 0;
    for (const p of step.partial) {
      partialTotal += p.count;
      out.push({
        severity: 'bad',
        stepId: step.stepId,
        count: p.count,
        title: `${users(p.count)}: ${quote(step.name)} failed, but ${list(p.effects)} anyway`,
        fix:
          `The user saw an error while part of the work was done. Make ${quote(step.name)} all-or-nothing: do the risky call last, ` +
          `undo earlier changes when it fails (refund, cancel), or ` +
          (retries === 0 ? 'retry it with an idempotency key so the user can finish.' : 'record the outcome and finish it in the background.'),
      });
    }

    const clean = step.failed - partialTotal;
    if (clean > 0) {
      out.push(
        retries === 0
          ? {
              severity: 'warn',
              stepId: step.stepId,
              count: clean,
              title: `${users(clean)} gave up at ${quote(step.name)}; nothing had changed yet`,
              fix: `These failures left nothing behind, so they are safe to retry. One retry on ${quote(step.name)} would recover most of them.`,
            }
          : {
              severity: 'warn',
              stepId: step.stepId,
              count: clean,
              title: `${users(clean)} gave up at ${quote(step.name)} even after ${retries} ${retries === 1 ? 'retry' : 'retries'}`,
              fix: 'Retrying does not help here. Check the components on this path for an outage, a rate limit or a full queue.',
            },
      );
    }
  }
  const order: Record<JourneyFinding['severity'], number> = { bad: 0, warn: 1, info: 2 };
  out.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);

  if (out.length === 0 && stats.started > 0) {
    out.push({
      severity: 'info',
      stepId: '',
      count: stats.completed,
      title: 'Every user who started finished, with no repeated or half-done work',
      fix: 'Try a rough day: raise the error or timeout rate on an outside service, or take one down while it runs.',
    });
  }
  return out;
}

/** Share of users who finished, ignoring those still in progress when the run ended. */
export function completionRate(stats: JourneyStats): number {
  const settled = stats.started - stats.unfinished;
  return settled > 0 ? stats.completed / settled : 0;
}
