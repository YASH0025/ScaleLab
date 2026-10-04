'use client';

import { type Evaluation, type PlanResult, describeChange, formatUsd } from '@scalelab/planner';
import type { ReactNode } from 'react';
import { usePlan } from '@/store/use-plan';

const fmtMs = (v: number) => (Number.isFinite(v) ? `${Math.round(v).toLocaleString()} ms` : '—');
const fmtPct = (v: number) => `${(v * 100).toFixed(v < 0.01 ? 2 : 1)}%`;
const fmtLag = (v: number) => (v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`);

function Field({ label, value, onChange, suffix, step = 1, min = 0 }: { label: string; value: number; onChange: (v: number) => void; suffix: string; step?: number; min?: number }) {
  return (
    <label className="flex flex-col gap-1 text-[12px] text-muted">
      {label}
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= min) onChange(v);
          }}
          className="w-full rounded-md border border-line-strong bg-bg px-2 py-1.5 text-right font-mono text-[13px] text-ink outline-none focus:border-accent"
        />
        <span className="w-8 text-[11px] text-faint">{suffix}</span>
      </span>
    </label>
  );
}

const HEADLINE: Record<PlanResult['status'], { icon: string; tone: string; text: (r: PlanResult) => string }> = {
  met: { icon: '✓', tone: 'text-ok', text: () => 'Found a setup that meets your targets' },
  'right-sized': { icon: '✓', tone: 'text-ok', text: (r) => `You can save ${formatUsd((r.before?.cost.monthlyUsd ?? 0) - (r.after?.cost.monthlyUsd ?? 0))} a month` },
  'already-optimal': { icon: '✓', tone: 'text-ok', text: () => 'Your design already fits these targets' },
  unreachable: { icon: '⚠', tone: 'text-warn', text: () => 'Couldn’t reach these targets by adding capacity' },
  'no-traffic': { icon: '⚠', tone: 'text-warn', text: () => 'Nothing to plan yet' },
};

function Row({ label, before, after, better }: { label: string; before: ReactNode; after: ReactNode; better?: boolean }) {
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 text-muted">{label}</td>
      <td className="py-1.5 text-right font-mono">{before}</td>
      <td className={`py-1.5 text-right font-mono ${better === undefined ? '' : better ? 'text-ok' : 'text-warn'}`}>{after}</td>
    </tr>
  );
}

function Comparison({ before, after, hasQueues, maxUtilization }: { before: Evaluation; after: Evaluation; hasQueues: boolean; maxUtilization: number }) {
  return (
    <table className="mt-3 w-full text-[12.5px]">
      <thead>
        <tr className="text-[11px] uppercase tracking-[0.06em] text-faint">
          <th className="pb-1 text-left font-medium" />
          <th className="pb-1 text-right font-medium">Your design</th>
          <th className="pb-1 text-right font-medium">Recommended</th>
        </tr>
      </thead>
      <tbody>
        <Row label="p95 latency" before={fmtMs(before.p95Ms)} after={fmtMs(after.p95Ms)} better={after.p95Ms <= before.p95Ms + 1} />
        <Row label="Errors" before={fmtPct(before.errorRate)} after={fmtPct(after.errorRate)} better={after.errorRate <= before.errorRate} />
        {hasQueues && <Row label="Queue lag" before={fmtLag(before.lagMs)} after={fmtLag(after.lagMs)} better={after.lagMs <= before.lagMs + 50} />}
        <Row
          label="Busiest component"
          before={`${Math.round(before.peakUtilization * 100)}%`}
          after={`${Math.round(after.peakUtilization * 100)}%`}
          better={after.peakUtilization <= maxUtilization}
        />
        <Row
          label="Monthly cost"
          before={formatUsd(before.cost.monthlyUsd)}
          after={formatUsd(after.cost.monthlyUsd)}
          better={after.cost.monthlyUsd <= before.cost.monthlyUsd}
        />
      </tbody>
    </table>
  );
}

/**
 * "What's the cheapest setup that handles this load?" Users set targets; the planner
 * simulates candidate setups in a worker and recommends one they can apply in one click.
 */
export function PlanPanel() {
  const { open, target, running, progress, result, close, setTarget, start, apply } = usePlan();
  if (!open) return null;
  const hasQueues = Boolean(result?.after && Object.keys(result.after.pressure).some((id) => result.nodes.find((n) => n.id === id)?.config.type === 'queue'));

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && !running && close()}>
      <section role="dialog" aria-label="Plan capacity" className="anim-toast w-[560px] max-w-[94vw] rounded-2xl border border-line-strong bg-panel p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[17px] font-semibold">Plan capacity</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Set your targets. ScaleLab simulates different setups and recommends the cheapest one that meets them.
            </p>
          </div>
          <button onClick={close} disabled={running} aria-label="Close" className="px-1 text-[18px] text-faint hover:text-ink disabled:opacity-30">
            ×
          </button>
        </div>

        <div className="mt-4 grid grid-cols-5 gap-3">
          <Field label="Traffic" value={target.rps} min={1} step={100} suffix="rps" onChange={(v) => setTarget({ rps: Math.round(v) })} />
          <Field label="p95 under" value={target.p95Ms} min={1} step={10} suffix="ms" onChange={(v) => setTarget({ p95Ms: v })} />
          <Field label="Errors under" value={Math.round(target.maxErrorRate * 1000) / 10} step={0.1} suffix="%" onChange={(v) => setTarget({ maxErrorRate: v / 100 })} />
          <Field label="Lag under" value={target.maxLagMs / 1000} min={0.1} step={1} suffix="s" onChange={(v) => setTarget({ maxLagMs: v * 1000 })} />
          <Field
            label="Busy under"
            value={Math.round((target.maxUtilization ?? 0.8) * 100)}
            min={10}
            step={5}
            suffix="%"
            onChange={(v) => setTarget({ maxUtilization: Math.min(100, v) / 100 })}
          />
        </div>
        <p className="mt-2 text-[11.5px] text-faint">
          “Busy under” keeps headroom: no component may be busier than this at your traffic, so a spike doesn’t tip it over.
        </p>

        {!running && (
          <button onClick={start} className="mt-4 w-full rounded-xl bg-accent py-2.5 text-[14px] font-semibold text-white hover:brightness-110">
            {result ? 'Plan again' : 'Find the cheapest setup'}
          </button>
        )}

        {running && progress && (
          <div className="mt-4" aria-live="polite">
            <div className="h-1.5 overflow-hidden rounded-full bg-raised">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${Math.min(100, (progress.evaluations / progress.maxEvaluations) * 100)}%` }}
              />
            </div>
            <p className="mt-2 truncate text-[12.5px] text-muted">
              Simulation {progress.evaluations}: {progress.message}…
            </p>
          </div>
        )}

        {result && !running && (
          <div className="mt-5 border-t border-line pt-4">
            <div className={`flex items-center gap-2 text-[15px] font-semibold ${HEADLINE[result.status].tone}`}>
              <span aria-hidden="true">{HEADLINE[result.status].icon}</span>
              {HEADLINE[result.status].text(result)}
            </div>

            {result.before && result.after && (
              <Comparison before={result.before} after={result.after} hasQueues={hasQueues} maxUtilization={target.maxUtilization ?? 0.8} />
            )}

            {result.changes.length > 0 && (
              <div className="mt-4">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">Changes</h3>
                <ul className="mt-1.5 space-y-1 text-[13px]">
                  {result.changes.map((c) => (
                    <li key={`${c.nodeId}-${c.knob}`} className="flex gap-2">
                      <span className="text-accent-soft" aria-hidden="true">→</span>
                      {describeChange(c)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <ul className="mt-4 space-y-1.5 text-[11.5px] leading-relaxed text-faint">
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
              <li>
                Checked {result.evaluations} setups by simulation at a steady {target.rps.toLocaleString()} rps. Results are modeled estimates.
              </li>
            </ul>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={close} className="rounded-lg border border-line-strong px-3 py-1.5 text-[13px] hover:bg-raised">
                Close
              </button>
              {result.changes.length > 0 && (
                <button onClick={apply} className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white hover:brightness-110">
                  Apply to canvas
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
