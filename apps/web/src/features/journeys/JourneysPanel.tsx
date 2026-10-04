'use client';

import { resolveArchetype } from '@scalelab/catalog';
import type { JourneyStats } from '@scalelab/engine';
import { type ArchNode, type Journey, type JourneyStep, deriveFlows, readFlowId, writeFlowId } from '@scalelab/model';
import { useMemo, useState } from 'react';
import { newId } from '@/lib/design-helpers';
import { completionRate, journeyFindings } from '@/lib/journey-findings';
import { toK6 } from '@/lib/k6';
import { removeJourney, saveJourney } from '@/store/design-doc';
import { useDesign } from '@/store/use-design';
import { DEFAULT_USERS_PER_SEC, useJourneys } from '@/store/use-journeys';
import { useSim } from '@/store/use-sim';
import { useUi } from '@/store/use-ui';

const btn = 'rounded-lg border border-line-strong px-3 py-1.5 text-[13px] hover:bg-raised disabled:opacity-40';
const primary = 'rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-40';
const input =
  'rounded-md border border-line-strong bg-bg px-2 py-1 text-[13px] text-ink outline-none focus:border-accent';

/** Services a journey step can call, and which of them can take reads and writes. */
function useServices() {
  const nodes = useDesign((s) => s.nodes);
  const edges = useDesign((s) => s.edges);
  return useMemo(() => {
    const services = nodes.filter((n) => resolveArchetype(n.technologyId) === 'compute-service');
    const { flows } = deriveFlows(nodes, edges, resolveArchetype);
    const ids = new Set(flows.map((f) => f.id));
    const hasPath = (step: Pick<JourneyStep, 'serviceNodeId' | 'operation'>) =>
      ids.has(step.operation === 'read' ? readFlowId(step.serviceNodeId) : writeFlowId(step.serviceNodeId));
    return { services, hasPath, label: new Map(nodes.map((n) => [n.id, n.label])) };
  }, [nodes, edges]);
}

/** Why a journey can't run right now, if it can't. */
function problemWith(journey: Journey, hasPath: ReturnType<typeof useServices>['hasPath'], label: Map<string, string>): string | undefined {
  for (const step of journey.steps) {
    const service = label.get(step.serviceNodeId);
    if (!service) return `“${step.name}” uses a service that was removed.`;
    if (!hasPath(step)) {
      return step.operation === 'read'
        ? `“${step.name}”: nothing reaches ${service} from a client, so it can't be called.`
        : `“${step.name}”: ${service} has nothing to write to. Connect a database, queue or outside service, or make the step a read.`;
    }
  }
  return undefined;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── List ────────────────────────────────────────────────────────────────────

function ListView() {
  const journeys = useDesign((s) => s.journeys);
  const nodes = useDesign((s) => s.nodes);
  const { services, hasPath, label } = useServices();
  const { usersPerSec, skipped, withTraffic, setUsersPerSec, toggleSkipped, setWithTraffic, show, close } = useJourneys();
  const status = useSim((s) => s.status);
  const results = useSim((s) => s.journeyResults);
  const durationSec = useSim((s) => s.traffic.durationSec);

  const chosen = journeys.filter((j) => !skipped[j.id]);
  const problems = chosen.map((j) => problemWith(j, hasPath, label)).filter(Boolean) as string[];

  const run = () => {
    if (problems.length > 0) return;
    useUi.getState().select(undefined);
    useSim.getState().run({
      journeys: chosen.map((j) => ({ journeyId: j.id, usersPerSec: usersPerSec[j.id] ?? DEFAULT_USERS_PER_SEC })),
      withTraffic,
    });
    close();
  };

  const exportK6 = () => {
    download(
      'journeys.js',
      toK6({ journeys: chosen.map((journey) => ({ journey, usersPerSec: usersPerSec[journey.id] ?? DEFAULT_USERS_PER_SEC })), nodes, durationSec }),
    );
  };

  if (services.length === 0) {
    return (
      <p className="mt-4 rounded-xl bg-bg p-4 text-[13px] leading-relaxed text-muted">
        Journeys walk users through your services step by step. Add a backend service (like NestJS or Express) to the canvas first, or load the
        checkout example from the ▾ menu.
      </p>
    );
  }

  return (
    <>
      {journeys.length === 0 ? (
        <p className="mt-4 rounded-xl bg-bg p-4 text-[13px] leading-relaxed text-muted">
          No journeys yet. A journey is what a real user does, in order: log in, browse, add to cart, pay. Each step calls one of your services. ScaleLab
          shows how many users finish, where they drop off, and what went wrong along the way, like a customer charged twice.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {journeys.map((j) => {
            const problem = problemWith(j, hasPath, label);
            return (
              <li key={j.id} className={`rounded-xl border p-3 ${skipped[j.id] ? 'border-line opacity-60' : 'border-line-strong bg-card'}`}>
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={!skipped[j.id]} onChange={() => toggleSkipped(j.id)} aria-label={`Include ${j.name} in the run`} className="accent-[var(--color-accent)]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">{j.name}</div>
                    <div className="truncate text-[12px] text-muted">{j.steps.map((s) => s.name).join(' → ')}</div>
                  </div>
                  <label className="flex items-center gap-1.5 text-[12px] text-muted">
                    <input
                      type="number"
                      min={1}
                      max={2000}
                      value={usersPerSec[j.id] ?? DEFAULT_USERS_PER_SEC}
                      onChange={(e) => setUsersPerSec(j.id, Math.max(1, Math.min(2000, Math.round(Number(e.target.value)) || 1)))}
                      aria-label={`Users per second for ${j.name}`}
                      className={`${input} w-16 text-right font-mono text-[12px]`}
                    />
                    users/s
                  </label>
                  <button onClick={() => show('edit', j.id)} className="text-[12px] text-accent-soft hover:underline">
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      removeJourney(j.id);
                      useUi.getState().toast(`Deleted “${j.name}”.`, 'info');
                    }}
                    aria-label={`Delete ${j.name}`}
                    className="text-[15px] text-faint hover:text-bad"
                  >
                    ×
                  </button>
                </div>
                {problem && <p className="mt-2 text-[12px] text-warn">⚠ {problem}</p>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-between">
        <button onClick={() => show('edit')} className="text-[13px] text-accent-soft hover:underline" disabled={journeys.length >= 20}>
          + New journey
        </button>
        {results && (
          <button onClick={() => show('results')} className="text-[13px] text-muted hover:text-ink">
            See last results →
          </button>
        )}
      </div>

      {journeys.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={withTraffic} onChange={(e) => setWithTraffic(e.target.checked)} className="accent-[var(--color-accent)]" />
            Also send normal traffic <span className="text-faint">(from the Traffic setting)</span>
          </label>
          <p className="mt-1.5 text-[11.5px] text-faint">
            New users start for {durationSec} s. Users wait 1 s between steps and 0.5 s before a retry.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={exportK6} disabled={chosen.length === 0} className={btn} title="Download a k6 load test of these journeys">
              Export as k6 test
            </button>
            <button onClick={run} disabled={chosen.length === 0 || problems.length > 0 || status === 'running'} className={primary}>
              ▶ Run {chosen.length === 1 ? 'journey' : `${chosen.length} journeys`}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

function blankStep(services: ArchNode[]): JourneyStep {
  return { id: newId('step'), name: 'New step', serviceNodeId: services[0]?.id ?? '', operation: 'read', retries: 0, idempotent: false };
}

function EditView() {
  const editingId = useJourneys((s) => s.editingId);
  const show = useJourneys((s) => s.show);
  const existing = useDesign((s) => s.journeys.find((j) => j.id === editingId));
  const { services, hasPath } = useServices();
  const [draft, setDraft] = useState<Journey>(
    () => existing ?? { id: newId('journey'), name: 'New journey', steps: [blankStep(services)] },
  );

  const setStep = (i: number, patch: Partial<JourneyStep>) =>
    setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, by: number) =>
    setDraft((d) => {
      const steps = [...d.steps];
      const [s] = steps.splice(i, 1);
      steps.splice(i + by, 0, s!);
      return { ...d, steps };
    });

  const valid = draft.name.trim().length > 0 && draft.steps.length > 0 && draft.steps.every((s) => s.name.trim() && s.serviceNodeId);

  const save = () => {
    if (!valid) return;
    saveJourney({ ...draft, name: draft.name.trim(), steps: draft.steps.map((s) => ({ ...s, name: s.name.trim(), idempotent: s.operation === 'write' && s.idempotent })) });
    show('list');
  };

  return (
    <div className="mt-4">
      <label className="flex flex-col gap-1 text-[12px] text-muted">
        Journey name
        <input value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={`${input} text-[14px]`} />
      </label>

      <div className="mt-4 grid grid-cols-[20px_1fr_150px_92px_64px_70px_64px] items-center gap-x-2 text-[11px] uppercase tracking-[0.06em] text-faint">
        <span />
        <span>Step</span>
        <span>Service</span>
        <span>Does</span>
        <span>Retries</span>
        <span title="Sends the same key on every retry so repeats are ignored">Idem. key</span>
        <span />
      </div>
      <ol className="mt-1 max-h-[44vh] space-y-1.5 overflow-y-auto">
        {draft.steps.map((step, i) => (
          <li key={step.id}>
            <div className="grid grid-cols-[20px_1fr_150px_92px_64px_70px_64px] items-center gap-x-2">
              <span className="text-center font-mono text-[12px] text-faint">{i + 1}</span>
              <input value={step.name} maxLength={40} onChange={(e) => setStep(i, { name: e.target.value })} aria-label={`Step ${i + 1} name`} className={`${input} w-full min-w-0`} />
              <select
                value={step.serviceNodeId}
                onChange={(e) => setStep(i, { serviceNodeId: e.target.value })}
                aria-label={`Step ${i + 1} service`}
                className={`${input} min-w-0`}
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id} className="bg-panel">
                    {s.label}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 rounded-md bg-bg p-0.5">
                {(['read', 'write'] as const).map((op) => (
                  <button
                    key={op}
                    onClick={() => setStep(i, { operation: op })}
                    className={`rounded py-0.5 text-[12px] capitalize ${step.operation === op ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}
                  >
                    {op}
                  </button>
                ))}
              </div>
              <select value={step.retries} onChange={(e) => setStep(i, { retries: Number(e.target.value) })} aria-label={`Step ${i + 1} retries`} className={input}>
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n} className="bg-panel">
                    {n}
                  </option>
                ))}
              </select>
              <label className="flex justify-center">
                <input
                  type="checkbox"
                  checked={step.idempotent}
                  disabled={step.operation === 'read'}
                  onChange={(e) => setStep(i, { idempotent: e.target.checked })}
                  aria-label={`Step ${i + 1} sends an idempotency key`}
                  className="accent-[var(--color-accent)] disabled:opacity-30"
                />
              </label>
              <span className="flex justify-end gap-2 text-[14px] text-faint">
                <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="hover:text-ink disabled:opacity-20">
                  ↑
                </button>
                <button onClick={() => move(i, 1)} disabled={i === draft.steps.length - 1} aria-label="Move down" className="hover:text-ink disabled:opacity-20">
                  ↓
                </button>
                <button
                  onClick={() => setDraft((d) => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }))}
                  disabled={draft.steps.length === 1}
                  aria-label="Remove step"
                  className="hover:text-bad disabled:opacity-20"
                >
                  ×
                </button>
              </span>
            </div>
            {step.serviceNodeId && !hasPath(step) && (
              <p className="ml-7 mt-1 text-[11.5px] text-warn">
                {step.operation === 'write' ? 'This service has nothing to write to yet.' : 'Nothing reaches this service from a client yet.'}
              </p>
            )}
          </li>
        ))}
      </ol>
      <button
        onClick={() => setDraft((d) => ({ ...d, steps: [...d.steps, blankStep(services)] }))}
        disabled={draft.steps.length >= 20}
        className="mt-2 text-[13px] text-accent-soft hover:underline disabled:opacity-40"
      >
        + Add step
      </button>
      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
        A read fetches data. A write changes things: it saves to databases, calls outside services like Stripe and sends events. If a write fails
        halfway or is retried, ScaleLab shows what was left behind.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={() => show('list')} className={btn}>
          Cancel
        </button>
        <button onClick={save} disabled={!valid} className={primary}>
          Save journey
        </button>
      </div>
    </div>
  );
}

// ─── Results ─────────────────────────────────────────────────────────────────

const pct = (v: number) => `${(v * 100).toFixed(v > 0.995 && v < 1 ? 1 : 0)}%`;
const ms = (v: number) => (v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v).toLocaleString()} ms`);

function Funnel({ stats }: { stats: JourneyStats }) {
  const top = Math.max(1, stats.started - stats.unfinished);
  return (
    <ol className="mt-3 space-y-1.5">
      {stats.steps.map((s) => {
        const reached = s.reached / top;
        const ok = s.succeeded / top;
        return (
          <li key={s.stepId} className="grid grid-cols-[130px_1fr_110px] items-center gap-3 text-[12.5px]">
            <span className="truncate">{s.name}</span>
            <span className="relative h-4 overflow-hidden rounded bg-raised" title={`${s.reached.toLocaleString()} reached, ${s.succeeded.toLocaleString()} got through`}>
              <span className="absolute inset-y-0 left-0 rounded bg-bad/60" style={{ width: `${reached * 100}%` }} />
              <span className="absolute inset-y-0 left-0 rounded bg-ok/70 transition-[width] duration-700" style={{ width: `${ok * 100}%` }} />
            </span>
            <span className="text-right font-mono text-[11.5px] text-muted">
              {s.failed > 0 ? <span className="text-bad-soft">−{s.failed.toLocaleString()}</span> : '✓'}
              {s.retries > 0 && <span className="text-faint"> · {s.retries}↻</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function JourneyResult({ journey, stats }: { journey: Journey; stats: JourneyStats }) {
  const findings = journeyFindings(journey, stats);
  const rate = completionRate(stats);
  const tone = rate >= 0.99 ? 'text-ok' : rate >= 0.95 ? 'text-warn' : 'text-bad';
  return (
    <section className="rounded-xl border border-line-strong bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold">{stats.name}</h3>
        <span className={`font-mono text-[20px] font-bold ${tone}`}>{pct(rate)}</span>
      </div>
      <p className="text-[12px] text-muted">
        {stats.completed.toLocaleString()} of {(stats.started - stats.unfinished).toLocaleString()} users finished
        {stats.completed > 0 && (
          <>
            {' '}
            · typical {ms(stats.p50Ms)}, slowest 5% over {ms(stats.p95Ms)}
          </>
        )}
        {stats.unfinished > 0 && <> · {stats.unfinished.toLocaleString()} still going when the run ended</>}
      </p>
      <Funnel stats={stats} />
      <ul className="mt-4 space-y-2.5">
        {findings.map((f, i) => (
          <li key={i} className="flex gap-2.5 text-[13px]">
            <span aria-hidden="true" className={f.severity === 'bad' ? 'text-bad' : f.severity === 'warn' ? 'text-warn' : 'text-ok'}>
              {f.severity === 'bad' ? '●' : f.severity === 'warn' ? '▲' : '✓'}
            </span>
            <div className="min-w-0">
              <div className="font-medium leading-snug">{f.title}</div>
              <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{f.fix}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResultsView() {
  const results = useSim((s) => s.journeyResults);
  const journeys = useDesign((s) => s.journeys);
  const show = useJourneys((s) => s.show);
  const usersPerSec = useJourneys((s) => s.usersPerSec);
  const nodes = useDesign((s) => s.nodes);
  const durationSec = useSim((s) => s.traffic.durationSec);

  if (!results) {
    return <p className="mt-4 text-[13px] text-muted">No results yet. Run a journey first.</p>;
  }
  const pairs = results.map((stats) => ({ stats, journey: journeys.find((j) => j.id === stats.journeyId) })).filter((p) => p.journey) as Array<{
    stats: JourneyStats;
    journey: Journey;
  }>;

  return (
    <div className="mt-4">
      <div className="max-h-[62vh] space-y-3 overflow-y-auto pr-1">
        {pairs.map(({ stats, journey }) => (
          <JourneyResult key={stats.journeyId} journey={journey} stats={stats} />
        ))}
        {pairs.length === 0 && <p className="text-[13px] text-muted">These journeys were changed or deleted since the run.</p>}
      </div>
      <p className="mt-3 text-[11.5px] text-faint">Green: users who got through each step. Red: users who reached it but gave up there. ↻ retries.</p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={() => download('journeys.js', toK6({ journeys: pairs.map(({ journey }) => ({ journey, usersPerSec: usersPerSec[journey.id] ?? DEFAULT_USERS_PER_SEC })), nodes, durationSec }))}
          disabled={pairs.length === 0}
          className={btn}
        >
          Export as k6 test
        </button>
        <button onClick={() => show('list')} className={primary}>
          Edit and run again
        </button>
      </div>
    </div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

const TITLES = { list: 'Journeys', edit: 'Edit journey', results: 'Journey results' } as const;

/** Business journeys: users walk through steps in order; see who finishes and what breaks halfway. */
export function JourneysPanel() {
  const { open, view, editingId, close, show } = useJourneys();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[6vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section role="dialog" aria-label={TITLES[view]} className="anim-toast w-[720px] max-w-[96vw] rounded-2xl border border-line-strong bg-panel p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-[17px] font-semibold">
              {view !== 'list' && (
                <button onClick={() => show('list')} aria-label="Back to journeys" className="text-faint hover:text-ink">
                  ←
                </button>
              )}
              {TITLES[view]}
            </h2>
            {view === 'list' && (
              <p className="mt-1 text-[13px] leading-relaxed text-muted">Send users through your system step by step and see where they drop off.</p>
            )}
          </div>
          <button onClick={close} aria-label="Close" className="px-1 text-[18px] text-faint hover:text-ink">
            ×
          </button>
        </div>
        {view === 'list' && <ListView />}
        {view === 'edit' && <EditView key={editingId ?? 'new'} />}
        {view === 'results' && <ResultsView />}
      </section>
    </div>
  );
}
