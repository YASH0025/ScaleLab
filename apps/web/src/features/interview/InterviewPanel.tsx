'use client';

import { POINTS, problemById } from '@scalelab/interview';
import { useEffect, useState } from 'react';
import { type InterviewTab, useInterview } from '@/store/use-interview';

const DIFFICULTY_TONE = { Easy: 'text-ok', Medium: 'text-warn', Hard: 'text-bad-soft' } as const;

function useClock(startedAt: number | undefined): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!startedAt) return '00:00';
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const fmt = (n: number) => n.toLocaleString('en-US');

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="mt-3">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{title}</h3>
      <ul className="mt-1 space-y-1 text-[12.5px] leading-relaxed">
        {items.map((i) => (
          <li key={i} className="flex gap-2">
            <span className="text-faint" aria-hidden="true">
              •
            </span>
            {i}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Brief() {
  const problem = problemById.get(useInterview((s) => s.problemId)!)!;
  const t = problem.targets;
  return (
    <div>
      <p className="text-[13px] leading-relaxed">{problem.brief}</p>
      <List title="It must" items={problem.functional} />
      <List title="And be" items={problem.nonFunctional} />
      <List title="Scale" items={problem.scale} />
      <div className="mt-4 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2.5 text-[12px] leading-relaxed">
        <span className="font-semibold">How you’re tested:</span> your design gets {fmt(t.peakRps)} requests per second, must keep p95 under{' '}
        {fmt(t.p95Ms)} ms with at most {(t.maxErrorRate * 100).toFixed(t.maxErrorRate < 0.01 ? 1 : 0)}% errors, and then we break parts of it.
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
        Drag components from the left and connect them. Traffic is already set to the peak: press ▶ Run any time to watch your design under load.
      </p>
    </div>
  );
}

function Estimates() {
  const problem = problemById.get(useInterview((s) => s.problemId)!)!;
  const estimates = useInterview((s) => s.estimates);
  const setEstimate = useInterview((s) => s.setEstimate);
  return (
    <div>
      <p className="text-[12.5px] leading-relaxed text-muted">Rough numbers decide the design. Within 2× of the expected answer counts as right.</p>
      <ul className="mt-3 space-y-3">
        {problem.estimates.map((e) => (
          <li key={e.id}>
            <label className="block text-[12.5px] font-medium" htmlFor={`est-${e.id}`}>
              {e.question}
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id={`est-${e.id}`}
                inputMode="decimal"
                value={estimates[e.id] ?? ''}
                onChange={(ev) => setEstimate(e.id, ev.target.value)}
                placeholder="?"
                className="w-36 rounded-md border border-line-strong bg-bg px-2 py-1.5 text-right font-mono text-[13px] outline-none focus:border-accent"
              />
              <span className="text-[12px] text-muted">{e.unit}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11.5px] text-faint">The worked answers appear in your review.</p>
    </div>
  );
}

const SECTIONS: Array<[keyof typeof POINTS, string]> = [
  ['estimation', 'Your estimates'],
  ['design', 'What your design contains'],
  ['performance', 'Peak traffic, simulated'],
  ['resilience', 'Failure drill: servers and cache go down'],
  ['cost', 'Monthly cost vs the model answer'],
];

function Submit() {
  const { grading, report, ownDesign, submit, openReport, backToMyDesign, estimates } = useInterview();
  const problem = problemById.get(useInterview((s) => s.problemId)!)!;
  const filled = problem.estimates.filter((e) => estimates[e.id]?.trim()).length;
  return (
    <div>
      <p className="text-[12.5px] leading-relaxed text-muted">When you’re ready, ScaleLab reviews your answer like an interviewer would, but with evidence:</p>
      <ul className="mt-2 space-y-1.5 text-[12.5px]">
        {SECTIONS.map(([key, label]) => (
          <li key={key} className="flex items-center justify-between gap-3">
            <span>{label}</span>
            <span className="font-mono text-[11.5px] text-faint">{POINTS[key]} pts</span>
          </li>
        ))}
      </ul>
      {filled < problem.estimates.length && (
        <p className="mt-3 text-[11.5px] text-warn">
          {filled} of {problem.estimates.length} estimates filled in. Empty ones score zero.
        </p>
      )}
      {ownDesign ? (
        <button onClick={backToMyDesign} className="mt-4 w-full rounded-xl border border-line-strong py-2.5 text-[13px] font-semibold hover:bg-raised">
          ← Back to my design
        </button>
      ) : (
        <button onClick={submit} disabled={grading} className="mt-4 w-full rounded-xl bg-accent py-2.5 text-[14px] font-semibold text-white hover:brightness-110 disabled:opacity-50">
          {grading ? 'Reviewing…' : report ? 'Submit again' : 'Submit for review'}
        </button>
      )}
      {report && (
        <button onClick={openReport} className="mt-2 w-full text-[12.5px] text-accent-soft hover:underline">
          See last review: {report.score}/100 · {report.verdict}
        </button>
      )}
    </div>
  );
}

const TABS: Array<[InterviewTab, string]> = [
  ['brief', 'Brief'],
  ['estimates', 'Estimates'],
  ['submit', 'Submit'],
];

/** The interviewer's sheet, docked on the canvas: brief, estimates and submit. */
export function InterviewPanel() {
  const { problemId, startedAt, panelOpen, tab, setTab, togglePanel, exit, estimates } = useInterview();
  const clock = useClock(startedAt);
  if (!problemId) return null;
  const problem = problemById.get(problemId);
  if (!problem) return null;
  const filled = problem.estimates.filter((e) => estimates[e.id]?.trim()).length;

  if (!panelOpen) {
    return (
      <button
        onClick={togglePanel}
        className="anim-toast absolute left-3 top-3 z-10 flex items-center gap-2 rounded-xl border border-accent/50 bg-panel px-3 py-2 text-[13px] shadow-2xl hover:bg-raised"
      >
        <span aria-hidden="true">🎯</span>
        <span className="font-semibold">{problem.title}</span>
        <span className="font-mono text-[12px] text-muted">{clock}</span>
        <span className="text-accent-soft">Open brief</span>
      </button>
    );
  }

  return (
    <aside
      aria-label="Interview"
      className="anim-toast absolute bottom-3 left-3 top-3 z-10 flex w-[360px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl"
    >
      <header className="border-b border-line px-4 pb-3 pt-3.5">
        <div className="flex items-center gap-2 text-[11.5px]">
          <span className="font-medium uppercase tracking-[0.06em] text-faint">Interview</span>
          <span className={`font-semibold ${DIFFICULTY_TONE[problem.difficulty]}`}>{problem.difficulty}</span>
          <span className="ml-auto font-mono text-muted" title={`Suggested time: ${problem.minutes} minutes`}>
            {clock} / {problem.minutes}:00
          </span>
          <button onClick={togglePanel} aria-label="Collapse the brief" className="px-1 text-[15px] text-faint hover:text-ink">
            –
          </button>
        </div>
        <h2 className="mt-1 text-[17px] font-semibold leading-tight">{problem.title}</h2>
        <p className="text-[12.5px] text-muted">{problem.tagline}</p>
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-bg p-1" role="tablist">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`rounded-md py-1 text-[12px] ${tab === id ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}
            >
              {label}
              {id === 'estimates' && (
                <span className="ml-1 font-mono text-[10.5px] text-faint">
                  {filled}/{problem.estimates.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
        {tab === 'brief' && <Brief />}
        {tab === 'estimates' && <Estimates />}
        {tab === 'submit' && <Submit />}
      </div>
      <footer className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12px]">
        <a href="/interview" className="text-muted hover:text-ink">
          All problems
        </a>
        <button
          onClick={() => {
            if (window.confirm('End this interview? Your interview design will be replaced by the design you had before.')) exit();
          }}
          className="text-faint hover:text-bad-soft"
        >
          End interview
        </button>
      </footer>
    </aside>
  );
}
