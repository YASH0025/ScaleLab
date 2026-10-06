'use client';

import { type CheckResult, type GradeReport, type Problem, conceptById, problemById } from '@scalelab/interview';
import { formatUsd } from '@scalelab/planner';
import type { ReactNode } from 'react';
import { useInterview } from '@/store/use-interview';

const VERDICT_TONE: Record<GradeReport['verdict'], string> = {
  'Strong hire': 'text-ok',
  Hire: 'text-ok',
  'Lean no hire': 'text-warn',
  'No hire': 'text-bad-soft',
};

const pct = (v: number) => `${(v * 100).toFixed(v < 0.01 && v > 0 ? 2 : 1)}%`;
const num = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 });

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {aside}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Points({ score, max }: { score: number; max: number }) {
  const tone = score >= max * 0.85 ? 'text-ok' : score >= max * 0.5 ? 'text-warn' : 'text-bad-soft';
  return (
    <span className={`font-mono text-[12px] ${tone}`}>
      {num(score)} / {max}
    </span>
  );
}

function ScoreBars({ report }: { report: GradeReport }) {
  const rows: Array<[string, number, number]> = [
    ['Estimates', report.sections.estimation.score, report.sections.estimation.max],
    ['Design', report.sections.design.score + report.sections.design.bonus, report.sections.design.max],
    ['Peak load', report.sections.performance.score, report.sections.performance.max],
    ['Failure drill', report.sections.resilience.score, report.sections.resilience.max],
    ['Cost', report.sections.cost.score, report.sections.cost.max],
  ];
  return (
    <div className="grid grid-cols-5 gap-3">
      {rows.map(([label, score, max]) => {
        const share = Math.min(1, score / max);
        const color = share >= 0.85 ? 'bg-ok' : share >= 0.5 ? 'bg-warn' : 'bg-bad';
        return (
          <div key={label}>
            <div className="flex items-baseline justify-between text-[11.5px]">
              <span className="text-muted">{label}</span>
              <span className="font-mono text-faint">
                {num(score)}/{max}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised">
              <div className={`h-full rounded-full ${color} transition-[width] duration-700`} style={{ width: `${share * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CheckRow({ c }: { c: CheckResult }) {
  return (
    <li className="flex gap-2.5 py-1.5">
      <span aria-hidden="true" className={`mt-0.5 ${c.passed ? 'text-ok' : c.kind === 'nice' ? 'text-faint' : 'text-bad-soft'}`}>
        {c.passed ? '✓' : c.kind === 'nice' ? '○' : '✗'}
      </span>
      <div className="min-w-0">
        <div className="text-[13px]">
          {c.label}
          {c.kind === 'nice' && <span className="ml-2 rounded bg-raised px-1.5 py-0.5 text-[10.5px] text-faint">bonus</span>}
          {c.kind === 'outcome' && <span className="ml-2 rounded bg-raised px-1.5 py-0.5 text-[10.5px] text-faint">from the simulation</span>}
        </div>
        {!c.passed && (
          <div className="mt-0.5 text-[12px] leading-relaxed text-muted">
            {c.why} <span className="text-accent-soft">{c.fix}</span>
          </div>
        )}
      </div>
    </li>
  );
}

function Concepts({ ids, tone }: { ids: string[]; tone: 'good' | 'review' }) {
  if (ids.length === 0) return <span className="text-[12px] text-faint">None yet.</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {ids.map((id) => (
        <span
          key={id}
          title={conceptById.get(id)?.summary}
          className={`rounded-full border px-2.5 py-0.5 text-[11.5px] ${tone === 'good' ? 'border-ok/40 text-ok' : 'border-warn/40 text-warn'}`}
        >
          {conceptById.get(id)?.name ?? id}
        </span>
      ))}
    </div>
  );
}

function ModelAnswer({ problem }: { problem: Problem }) {
  const { ownDesign, showModelAnswer, backToMyDesign } = useInterview();
  return (
    <Section
      title="Model answer"
      aside={
        ownDesign ? (
          <button onClick={backToMyDesign} className="text-[12.5px] text-accent-soft hover:underline">
            ← Back to my design
          </button>
        ) : (
          <button onClick={showModelAnswer} className="text-[12.5px] text-accent-soft hover:underline">
            Load it on the canvas →
          </button>
        )
      }
    >
      <ul className="space-y-1 text-[12.5px] leading-relaxed">
        {problem.referenceNotes.map((n) => (
          <li key={n} className="flex gap-2">
            <span className="text-faint">•</span>
            {n}
          </li>
        ))}
      </ul>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-bg p-3">
          <h4 className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">API</h4>
          <ul className="mt-1 space-y-1 font-mono text-[11.5px] leading-relaxed">
            {problem.api.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg bg-bg p-3">
          <h4 className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">Data model</h4>
          <ul className="mt-1 space-y-1 font-mono text-[11.5px] leading-relaxed">
            {problem.dataModel.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

function Report({ report, problem }: { report: GradeReport; problem: Problem }) {
  const s = report.sections;
  const perf = s.performance;
  return (
    <div className="space-y-4">
      <ScoreBars report={report} />

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-bg p-3.5">
          <h3 className="text-[12px] font-semibold text-ok">What went well</h3>
          <ul className="mt-1.5 space-y-1 text-[12.5px] leading-relaxed">
            {(report.strengths.length ? report.strengths : ['Keep going: every fix below adds points.']).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl bg-bg p-3.5">
          <h3 className="text-[12px] font-semibold text-warn">Improve next</h3>
          <ul className="mt-1.5 space-y-1 text-[12.5px] leading-relaxed">
            {(report.improvements.length ? report.improvements : ['Nothing big. Try the follow-up questions below.']).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>

      <Section title="Design review" aside={<Points score={s.design.score + s.design.bonus} max={s.design.max} />}>
        <ul>
          {s.design.checks.map((c) => (
            <CheckRow key={c.id} c={c} />
          ))}
        </ul>
      </Section>

      <Section title="Peak traffic, simulated" aside={<Points score={perf.score} max={perf.max} />}>
        {perf.peak.ran ? (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.06em] text-faint">
                <th className="pb-1 text-left font-medium" />
                <th className="pb-1 text-right font-medium">Your design</th>
                <th className="pb-1 text-right font-medium">Target</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <td className="py-1.5 text-muted">Traffic</td>
                <td className="py-1.5 text-right font-mono">{num(perf.peak.rps)} /s</td>
                <td className="py-1.5 text-right font-mono text-faint">{num(perf.targets.peakRps)} /s</td>
              </tr>
              <tr className="border-t border-line">
                <td className="py-1.5 text-muted">p95 latency</td>
                <td className={`py-1.5 text-right font-mono ${perf.peak.p95Ms <= perf.targets.p95Ms ? 'text-ok' : 'text-bad-soft'}`}>{num(perf.peak.p95Ms)} ms</td>
                <td className="py-1.5 text-right font-mono text-faint">≤ {num(perf.targets.p95Ms)} ms</td>
              </tr>
              <tr className="border-t border-line">
                <td className="py-1.5 text-muted">Failed requests</td>
                <td className={`py-1.5 text-right font-mono ${perf.peak.errorRate <= perf.targets.maxErrorRate ? 'text-ok' : 'text-bad-soft'}`}>{pct(perf.peak.errorRate)}</td>
                <td className="py-1.5 text-right font-mono text-faint">≤ {pct(perf.targets.maxErrorRate)}</td>
              </tr>
            </tbody>
          </table>
        ) : null}
        {perf.notes.length > 0 && (
          <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-muted">
            {perf.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Failure drill" aside={<Points score={s.resilience.score} max={s.resilience.max} />}>
        <ul className="space-y-1 text-[12.5px] leading-relaxed text-muted">
          {s.resilience.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Section>

      <Section title="Cost" aside={<Points score={s.cost.score} max={s.cost.max} />}>
        <ul className="space-y-1 text-[12.5px] leading-relaxed text-muted">
          {s.cost.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Section>

      <Section title="Your estimates" aside={<Points score={s.estimation.score} max={s.estimation.max} />}>
        <ul className="space-y-2.5">
          {s.estimation.items.map((e) => (
            <li key={e.id} className="text-[12.5px]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{e.question}</span>
                <span className="font-mono text-[12px]">
                  <span className={e.closeness === 'close' ? 'text-ok' : e.closeness === 'near' ? 'text-warn' : 'text-bad-soft'}>
                    {e.answer === undefined ? 'no answer' : num(e.answer)}
                  </span>
                  <span className="text-faint"> vs {num(e.expected)} {e.unit}</span>
                </span>
              </div>
              <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{e.working}</div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Concepts">
        <div className="space-y-2">
          <div>
            <div className="mb-1 text-[11.5px] text-faint">You showed</div>
            <Concepts ids={report.conceptsShown} tone="good" />
          </div>
          <div>
            <div className="mb-1 text-[11.5px] text-faint">To review</div>
            <Concepts ids={report.conceptsToReview} tone="review" />
          </div>
        </div>
      </Section>

      <Section title="Follow-up questions an interviewer would ask">
        <div className="space-y-1.5">
          {problem.followUps.map((f) => (
            <details key={f.question} className="group rounded-lg bg-bg px-3 py-2">
              <summary className="cursor-pointer list-none text-[13px] font-medium">
                <span className="mr-2 inline-block text-faint transition-transform group-open:rotate-90">▸</span>
                {f.question}
              </summary>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{f.answer}</p>
            </details>
          ))}
        </div>
      </Section>

      <ModelAnswer problem={problem} />
    </div>
  );
}

/** The interviewer's verdict, with the evidence behind every point. */
export function InterviewReport() {
  const { problemId, report, reportOpen, grading, progress, closeReport } = useInterview();
  if (!reportOpen || !problemId) return null;
  const problem = problemById.get(problemId);
  if (!problem) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/55 pt-[5vh]" onMouseDown={(e) => e.target === e.currentTarget && !grading && closeReport()}>
      <section role="dialog" aria-label="Interview review" className="anim-toast flex max-h-[90vh] w-[860px] max-w-[96vw] flex-col rounded-2xl border border-line-strong bg-panel shadow-2xl">
        <header className="flex items-start gap-5 border-b border-line px-6 py-5">
          {report && !grading ? (
            <div className="flex h-[76px] w-[76px] shrink-0 flex-col items-center justify-center rounded-full border-4 border-accent/60">
              <span className="text-[26px] font-bold leading-none tabular-nums">{report.score}</span>
              <span className="text-[10px] text-faint">/ 100</span>
            </div>
          ) : (
            <div className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-full border-4 border-line-strong">
              <span className="anim-indeterminate-dot h-3 w-3 rounded-full bg-accent" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-muted">Interview review · {problem.title}</div>
            {report && !grading ? (
              <>
                <h2 className={`mt-0.5 text-[24px] font-bold ${VERDICT_TONE[report.verdict]}`}>{report.verdict}</h2>
                <p className="text-[12.5px] text-muted">
                  Tested at {num(problem.targets.peakRps)} requests per second, then with servers and caches failing. Results are modeled estimates.
                </p>
              </>
            ) : (
              <>
                <h2 className="mt-0.5 text-[20px] font-semibold">Reviewing your design…</h2>
                <p className="text-[12.5px] text-muted" aria-live="polite">
                  {progress ?? 'Starting'}…
                </p>
              </>
            )}
          </div>
          <button onClick={closeReport} disabled={grading} aria-label="Close" className="px-1 text-[20px] text-faint hover:text-ink disabled:opacity-30">
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {grading || !report ? (
            <div className="h-1.5 overflow-hidden rounded-full bg-raised">
              <div className="anim-indeterminate h-full w-1/3 rounded-full bg-accent" />
            </div>
          ) : (
            <Report report={report} problem={problem} />
          )}
        </div>
        {report && !grading && (
          <footer className="flex items-center justify-between gap-2 border-t border-line px-6 py-3.5">
            <a href="/interview" className="text-[12.5px] text-muted hover:text-ink">
              All problems
            </a>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (window.confirm('Start this problem again from a blank canvas?')) useInterview.getState().start(problem.id);
                }}
                className="rounded-lg border border-line-strong px-3 py-1.5 text-[13px] hover:bg-raised"
              >
                Start over
              </button>
              <button onClick={closeReport} className="rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-white hover:brightness-110">
                Keep improving
              </button>
            </div>
          </footer>
        )}
      </section>
    </div>
  );
}
