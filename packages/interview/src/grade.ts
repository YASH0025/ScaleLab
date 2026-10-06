import { getLibrary, resolveArchetype } from '@scalelab/catalog';
import { type ScheduledChange, type SimulationResult, simulate } from '@scalelab/engine';
import { type ApiFlow, type Design, type Workload, deriveFlows, derivedMix, isWriteFlow } from '@scalelab/model';
import { estimateCost, formatUsd } from '@scalelab/planner';
import { Graph, SERVICES, STORES } from './graph';
import type { GradeInput, Problem } from './types';

/** Points per section. They add up to 100; nice-to-haves add up to 5 more, capped at 100. */
export const POINTS = { estimation: 15, design: 35, performance: 25, resilience: 15, cost: 10 } as const;
const NICE_POINTS = 1;
const NICE_CAP = 5;
const SIM_SECONDS = 12;
const FAILURE_AT_SEC = 4;
const SEED = 7;

export type Verdict = 'Strong hire' | 'Hire' | 'Lean no hire' | 'No hire';

export interface EstimateResult {
  id: string;
  question: string;
  unit: string;
  answer: number | undefined;
  expected: number;
  points: number;
  max: number;
  working: string;
  /** "close" within 2×, "near" within 4×. */
  closeness: 'close' | 'near' | 'off' | 'missing';
}

export interface CheckResult {
  id: string;
  label: string;
  kind: 'must' | 'nice' | 'outcome';
  passed: boolean;
  why: string;
  fix: string;
  concepts: string[];
}

export interface LoadResult {
  ran: boolean;
  rps: number;
  p95Ms: number;
  errorRate: number;
  /** Components averaging 85% busy or more. */
  hot: Array<{ label: string; utilization: number }>;
  monthlyUsd?: number;
}

export interface GradeReport {
  score: number;
  verdict: Verdict;
  sections: {
    estimation: { score: number; max: number; items: EstimateResult[] };
    design: { score: number; max: number; bonus: number; checks: CheckResult[] };
    performance: { score: number; max: number; peak: LoadResult; targets: Problem['targets']; notes: string[] };
    resilience: { score: number; max: number; errorRate: number; broke: string[]; notes: string[] };
    cost: { score: number; max: number; monthlyUsd: number; referenceUsd: number; notes: string[] };
  };
  strengths: string[];
  improvements: string[];
  conceptsShown: string[];
  conceptsToReview: string[];
  /** Things the flow builder couldn't model ("nothing consumes from X"). */
  hints: string[];
}

export type Progress = (message: string) => void;

const pct = (v: number) => `${(v * 100).toFixed(v < 0.01 && v > 0 ? 2 : 1)}%`;

/** The derived traffic mix, re-weighted so writes make up the problem's write share. */
export function mixFor(flows: ApiFlow[], writeShare: number): Workload['mix'] {
  const base = derivedMix(flows);
  const writes = base.filter((m) => isWriteFlow(m.flowId));
  const reads = base.filter((m) => !isWriteFlow(m.flowId));
  if (writes.length === 0 || reads.length === 0) return base;
  const sum = (xs: typeof base) => xs.reduce((s, m) => s + m.weight, 0);
  const rs = sum(reads);
  const ws = sum(writes);
  return [
    ...reads.map((m) => ({ ...m, weight: ((1 - writeShare) * m.weight) / rs })),
    ...writes.map((m) => ({ ...m, weight: (writeShare * m.weight) / ws })),
  ];
}

function prepare(design: Pick<Design, 'nodes' | 'edges'>) {
  const { flows, handlers, hints } = deriveFlows(design.nodes, design.edges, resolveArchetype);
  const full: Design = {
    schemaVersion: 1,
    meta: { name: 'Interview', description: '', createdAt: new Date(0).toISOString() },
    nodes: design.nodes,
    edges: design.edges,
    flows,
    handlers,
    workloads: [],
  };
  return { full, flows, hints };
}

function load(full: Design, flows: ApiFlow[], problem: Problem, changes: ScheduledChange[] = []): SimulationResult {
  const workload: Workload = {
    id: 'interview',
    name: 'Interview peak',
    durationSec: SIM_SECONDS,
    pattern: { kind: 'constant', rps: problem.targets.peakRps },
    mix: mixFor(flows, problem.targets.writeShare),
    seed: SEED,
  };
  return simulate(full, workload, { libraryEffect: (id) => getLibrary(id)?.effect, changes });
}

export function scoreEstimate(answer: number | undefined, expected: number, max: number): Pick<EstimateResult, 'points' | 'closeness'> {
  if (answer === undefined || !Number.isFinite(answer) || answer <= 0) return { points: 0, closeness: 'missing' };
  const ratio = Math.max(answer / expected, expected / answer);
  if (ratio <= 2) return { points: max, closeness: 'close' };
  if (ratio <= 4) return { points: max / 2, closeness: 'near' };
  return { points: 0, closeness: 'off' };
}

export function verdictFor(score: number): Verdict {
  if (score >= 85) return 'Strong hire';
  if (score >= 70) return 'Hire';
  if (score >= 50) return 'Lean no hire';
  return 'No hire';
}

/**
 * Grades a design the way a thorough interviewer would, but with evidence:
 * the estimates, what the design contains, how it holds up at peak load,
 * what happens when parts fail, and what it costs compared with a strong answer.
 */
export function grade({ problem, design, estimates }: GradeInput, onProgress: Progress = () => {}): GradeReport {
  const g = new Graph(design.nodes, design.edges);
  const round1 = (n: number) => Math.round(n * 10) / 10;

  // ── Estimation ──
  onProgress('Checking your estimates');
  const perEstimate = problem.estimates.length ? POINTS.estimation / problem.estimates.length : 0;
  const estimateItems: EstimateResult[] = problem.estimates.map((e) => {
    const s = scoreEstimate(estimates[e.id], e.answer, perEstimate);
    return { id: e.id, question: e.question, unit: e.unit, answer: estimates[e.id], expected: e.answer, max: perEstimate, working: e.working, ...s };
  });
  const estimationScore = round1(estimateItems.reduce((s, e) => s + e.points, 0));

  // ── Design ──
  onProgress('Reviewing your design');
  const checks: CheckResult[] = problem.checks.map((c) => ({
    id: c.id,
    label: c.label,
    kind: c.kind,
    passed: c.test(g),
    why: c.why,
    fix: c.fix,
    concepts: c.concepts,
  }));
  const musts = checks.filter((c) => c.kind === 'must');
  const nices = checks.filter((c) => c.kind === 'nice');
  const designScore = round1(musts.length ? (POINTS.design * musts.filter((c) => c.passed).length) / musts.length : 0);
  const bonus = Math.min(NICE_CAP, nices.filter((c) => c.passed).length * NICE_POINTS);

  // ── Peak load ──
  const { full, flows, hints } = prepare(design);
  const perfNotes: string[] = [];
  let perfScore = 0;
  let peak: LoadResult = { ran: false, rps: problem.targets.peakRps, p95Ms: 0, errorRate: 1, hot: [] };
  let peakResult: SimulationResult | undefined;
  const t = problem.targets;
  if (flows.length === 0) {
    perfNotes.push(hints[0] ?? 'Connect users to your services so traffic can flow.');
  } else {
    onProgress(`Sending ${t.peakRps.toLocaleString('en-US')} requests per second`);
    try {
      peakResult = load(full, flows, problem);
      const hot = peakResult.nodes
        .filter((n) => n.avgUtilization >= 0.85)
        .map((n) => ({ id: n.nodeId, label: g.get(n.nodeId)?.label ?? n.nodeId, utilization: n.avgUtilization }))
        // A rate limiter at its limit is doing its job, not a bottleneck.
        .filter((n) => !(g.get(n.id) && g.rateLimit(g.get(n.id)!) > 0));
      peak = { ran: true, rps: t.peakRps, p95Ms: Math.round(peakResult.totals.p95Ms), errorRate: peakResult.totals.errorRate, hot: hot.map(({ label, utilization }) => ({ label, utilization })) };

      const latencyPts = peak.p95Ms <= t.p95Ms ? 10 : peak.p95Ms <= t.p95Ms * 2 ? 5 : 0;
      const errorPts = peak.errorRate <= t.maxErrorRate ? 10 : peak.errorRate <= Math.max(t.maxErrorRate * 5, 0.01) ? 5 : 0;
      const headroomPts = hot.length === 0 ? 5 : 0;
      perfScore = latencyPts + errorPts + headroomPts;
      if (latencyPts < 10) perfNotes.push(`p95 latency was ${peak.p95Ms.toLocaleString('en-US')} ms against a target of ${t.p95Ms} ms.`);
      if (errorPts < 10) perfNotes.push(`${pct(peak.errorRate)} of requests failed, more than the ${pct(t.maxErrorRate)} allowed.`);
      for (const h of hot) perfNotes.push(`${h.label} averaged ${Math.round(h.utilization * 100)}% busy: no headroom for a bigger spike.`);
    } catch (err) {
      perfNotes.push(`The design couldn't be simulated: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Outcome checks (problems where the result itself is the lesson) ──
  const outcomeChecks: CheckResult[] = (problem.simChecks ?? []).map((c) => ({
    id: c.id,
    label: c.label,
    kind: 'outcome',
    passed: peakResult ? c.test(peakResult, g) : false,
    why: c.why,
    fix: c.fix,
    concepts: c.concepts,
  }));
  if (outcomeChecks.length) {
    const failed = outcomeChecks.filter((c) => !c.passed).length;
    perfScore = Math.max(0, perfScore - failed * 5);
  }

  // ── Failure drill ──
  let resilienceScore = 0;
  let chaosError = 1;
  const broke: string[] = [];
  const resilienceNotes: string[] = [];
  if (peak.ran) {
    const changes: ScheduledChange[] = [];
    for (const s of g.of(...SERVICES, 'worker').filter((n) => n.archetype !== 'serverless-function')) {
      const n = g.instances(s);
      changes.push({ atSec: FAILURE_AT_SEC, nodeId: s.id, action: 'down', instance: 0 });
      broke.push(n > 1 ? `1 of ${n} instances of ${s.label}` : `${s.label} (its only instance)`);
    }
    // Caches in front of a database fail over to it. A cache that is itself the store
    // (a geo index, counters) would be run replicated in production, so it stays up.
    const frontCaches = g.of('cache').filter((c) => g.sources(c.id).some((s) => g.targets(s.id).some((t) => STORES.includes(t.archetype))));
    for (const c of frontCaches) {
      changes.push({ atSec: FAILURE_AT_SEC, nodeId: c.id, action: 'down' });
      broke.push(/cache/i.test(c.label) ? `the ${c.label}` : `the ${c.label} cache`);
    }
    if (changes.length > 0) {
      onProgress(`Breaking things: ${broke.slice(0, 2).join(', ')}${broke.length > 2 ? '…' : ''}`);
      try {
        const r = load(full, flows, problem, changes);
        // Requests in flight on a lost instance fail at once; what counts is how the system runs after that.
        const after = r.timeline.filter((s) => s.simTimeSec > FAILURE_AT_SEC + 1 && s.simTimeSec <= SIM_SECONDS);
        chaosError = after.length ? after.reduce((sum, s) => sum + s.errorRate, 0) / after.length : r.totals.errorRate;
        // Measured against the healthy run, so a rate limiter's normal 429s don't count as damage.
        const added = Math.max(0, chaosError - peak.errorRate);
        const allowed = Math.max(t.maxErrorRate * 2, 0.005);
        resilienceScore = added <= allowed ? POINTS.resilience : added <= Math.max(allowed, 0.05) ? 8 : 0;
        resilienceNotes.push(
          added < 0.0005
            ? `After losing ${broke.join(', ')}, the system kept serving as before.`
            : `After losing ${broke.join(', ')}, ${pct(added)} more requests failed than in the healthy run.`,
        );
        if (resilienceScore < POINTS.resilience) {
          const single = g.of(...SERVICES, 'worker').filter((s) => s.archetype !== 'serverless-function' && g.instances(s) < 2);
          if (single.length) resilienceNotes.push(`${single.map((s) => s.label).join(', ')} had a single instance, so losing it stopped that part of the system.`);
          if (frontCaches.length) resilienceNotes.push('Without the cache, every read hit the database. Make sure it can carry the load alone, or add replicas.');
        }
      } catch {
        resilienceNotes.push('The failure drill could not run on this design.');
      }
    }
  } else {
    resilienceNotes.push('The failure drill needs a design that runs at peak first.');
  }

  // ── Cost ──
  onProgress('Pricing your design');
  // Priced at average traffic (a third of peak), running around the clock.
  const usage = { requestsPerSec: Math.round(t.peakRps / 3) };
  const monthlyUsd = estimateCost(design.nodes, usage).monthlyUsd;
  const referenceUsd = estimateCost(problem.reference().nodes, usage).monthlyUsd;
  const costNotes: string[] = [];
  let costScore = 0;
  if (perfScore < 12) {
    costNotes.push('Cost counts once the design handles peak load; a cheap design that falls over isn’t a saving.');
  } else {
    const ratio = referenceUsd > 0 ? monthlyUsd / referenceUsd : 1;
    costScore = ratio <= 1.25 ? POINTS.cost : ratio <= 2 ? 6 : ratio <= 3 ? 3 : 0;
    costNotes.push(`About ${formatUsd(monthlyUsd)} a month at average traffic, against ${formatUsd(referenceUsd)} for the model answer.`);
    if (ratio > 1.25) costNotes.push('Look for capacity you don’t need: oversized instance counts, databases or clusters.');
  }

  // ── Total ──
  const score = Math.min(100, Math.round(estimationScore + designScore + bonus + perfScore + resilienceScore + costScore));
  const allChecks = [...checks, ...outcomeChecks];
  const conceptsShown = [...new Set(allChecks.filter((c) => c.passed).flatMap((c) => c.concepts))];
  if (estimationScore >= POINTS.estimation / 2) conceptsShown.push('estimation');
  if (peak.ran && peak.p95Ms <= t.p95Ms) conceptsShown.push('latency');
  if (resilienceScore === POINTS.resilience) conceptsShown.push('failover');
  if (costScore >= 6) conceptsShown.push('cost');
  const conceptsToReview = [...new Set(allChecks.filter((c) => !c.passed && c.kind !== 'nice').flatMap((c) => c.concepts))].filter(
    (c) => !conceptsShown.includes(c),
  );

  const strengths: string[] = [];
  if (peak.ran && perfScore >= 20) strengths.push(`Held ${t.peakRps.toLocaleString('en-US')} requests per second with p95 ${peak.p95Ms.toLocaleString('en-US')} ms.`);
  if (resilienceScore === POINTS.resilience) strengths.push('Kept working when instances and the cache failed.');
  for (const c of musts.filter((x) => x.passed).slice(0, 3)) strengths.push(c.label + '.');
  if (estimationScore >= POINTS.estimation * 0.75) strengths.push('Solid back-of-the-envelope numbers.');

  const improvements: string[] = [];
  for (const c of [...musts, ...outcomeChecks].filter((x) => !x.passed)) improvements.push(`${c.label}: ${c.fix}`);
  for (const n of perfNotes.slice(0, 2)) improvements.push(n);
  if (resilienceScore < POINTS.resilience && resilienceNotes[1]) improvements.push(resilienceNotes[1]);

  return {
    score,
    verdict: verdictFor(score),
    sections: {
      estimation: { score: estimationScore, max: POINTS.estimation, items: estimateItems },
      design: { score: designScore, max: POINTS.design, bonus, checks: [...checks, ...outcomeChecks] },
      performance: { score: perfScore, max: POINTS.performance, peak: { ...peak, monthlyUsd }, targets: t, notes: perfNotes },
      resilience: { score: resilienceScore, max: POINTS.resilience, errorRate: chaosError, broke, notes: resilienceNotes },
      cost: { score: costScore, max: POINTS.cost, monthlyUsd, referenceUsd, notes: costNotes },
    },
    strengths: strengths.slice(0, 5),
    improvements: improvements.slice(0, 6),
    conceptsShown,
    conceptsToReview,
    hints,
  };
}
