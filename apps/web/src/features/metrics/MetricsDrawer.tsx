'use client';

import { useMemo } from 'react';
import type { JourneyStats } from '@scalelab/engine';
import { findBottleneck, findSustainedBottleneck } from '@/lib/findings';
import { completionRate, journeyFindings } from '@/lib/journey-findings';
import { useDesign } from '@/store/use-design';
import { useJourneys } from '@/store/use-journeys';
import { useSim } from '@/store/use-sim';
import { Sparkline } from './Sparkline';

const fmtMs = (v: number) => `${Math.round(v).toLocaleString()} ms`;
const fmtRps = (v: number) => `${Math.round(v).toLocaleString()} /s`;
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

function Tile({
  label,
  value,
  tone,
  points,
  format,
}: {
  label: string;
  value: string;
  tone?: 'bad' | 'warn';
  points: Array<[number, number]>;
  format: (v: number) => string;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-line bg-card px-3.5 pt-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[22px] font-semibold tabular-nums">
        {tone === 'bad' && <span className="text-[14px] text-bad-soft" aria-label="critical">▲</span>}
        {tone === 'warn' && <span className="text-[14px] text-warn" aria-label="warning">▲</span>}
        {value}
      </div>
      <div className="h-[86px] min-h-0 flex-1 pb-2">{points.length > 1 ? <Sparkline points={points} format={format} label={label} /> : null}</div>
    </div>
  );
}

/** After a journey run: how many users finished, and the worst thing that happened. */
function JourneyCard({ results, bottleneck }: { results: JourneyStats[]; bottleneck: string | undefined }) {
  const journeys = useDesign((s) => s.journeys);
  const show = useJourneys((s) => s.show);
  const settled = results.reduce((n, r) => n + r.started - r.unfinished, 0);
  const completed = results.reduce((n, r) => n + r.completed, 0);
  const rate = settled > 0 ? completed / settled : 0;
  const worst = results
    .flatMap((r) => {
      const j = journeys.find((x) => x.id === r.journeyId);
      return j ? journeyFindings(j, r) : [];
    })
    .find((f) => f.severity !== 'info');
  const tone = rate >= 0.99 && !worst ? 'text-ok' : rate >= 0.95 ? 'text-warn' : 'text-bad-soft';
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-line-strong bg-card px-4 py-3">
      <div className="flex items-baseline gap-2">
        <span className={`text-[22px] font-semibold tabular-nums ${tone}`}>{(rate * 100).toFixed(rate > 0.995 && rate < 1 ? 1 : 0)}%</span>
        <span className="truncate text-[12.5px] text-muted">
          of users finished {results.length === 1 ? `“${results[0]!.name}”` : `${results.length} journeys`}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-ink">
        {worst ? worst.title : `${completed.toLocaleString()} users finished with nothing repeated or left half-done.`}
      </p>
      {bottleneck && <p className="mt-0.5 truncate text-[11.5px] text-warn">Bottleneck: {bottleneck}</p>}
      <button onClick={() => show('results')} className="mt-auto self-start pt-2 text-[12.5px] font-medium text-accent-soft hover:underline">
        See details and fixes →
      </button>
    </div>
  );
}

export function MetricsDrawer() {
  const samples = useSim((s) => s.samples);
  const latest = useSim((s) => s.latest);
  const status = useSim((s) => s.status);
  const totals = useSim((s) => s.totals);
  const journeyResults = useSim((s) => s.journeyResults);
  const nodes = useDesign((s) => s.nodes);
  const edges = useDesign((s) => s.edges);

  const series = useMemo(
    () => ({
      p95: samples.map((s) => [s.simTimeSec, s.p95Ms] as [number, number]),
      tput: samples.map((s) => [s.simTimeSec, s.throughputRps] as [number, number]),
      err: samples.map((s) => [s.simTimeSec, s.errorRate] as [number, number]),
    }),
    [samples],
  );

  const bottleneck = findBottleneck(latest, nodes, edges);
  const sustained = useMemo(() => (status === 'done' ? findSustainedBottleneck(samples, nodes, edges) : undefined), [status, samples, nodes, edges]);
  // While running, show what's under pressure right now; once finished, only what lasted.
  const shown = status === 'done' ? sustained : bottleneck;

  if (status === 'idle') {
    return (
      <div className="flex h-[210px] shrink-0 items-center justify-center border-t border-line bg-panel">
        <p className="text-[13px] text-muted">
          Press <span className="rounded bg-accent px-1.5 py-0.5 text-[12px] font-semibold text-white">▶ Run</span> to send traffic and watch your architecture respond.
        </p>
      </div>
    );
  }

  const done = status === 'done' && totals;
  const errorRate = done ? totals.errorRate : (latest?.errorRate ?? 0);
  return (
    <div className="h-[210px] shrink-0 border-t border-line bg-panel px-4 py-3">
      <div className="grid h-full grid-cols-[1fr_1fr_1fr_1.4fr] gap-3">
        <Tile label={done ? 'p95 latency · whole run' : 'p95 latency'} value={fmtMs(done ? totals.p95Ms : (latest?.p95Ms ?? 0))} points={series.p95} format={fmtMs} />
        <Tile
          label={done ? 'Peak throughput' : 'Throughput'}
          value={fmtRps(done ? totals.peakThroughputRps : (latest?.throughputRps ?? 0))}
          points={series.tput}
          format={fmtRps}
        />
        <Tile
          label={done ? 'Error rate · whole run' : 'Error rate'}
          value={fmtPct(errorRate)}
          tone={errorRate > 0.05 ? 'bad' : errorRate > 0 ? 'warn' : undefined}
          points={series.err}
          format={fmtPct}
        />
        {status === 'done' && journeyResults ? (
          <JourneyCard results={journeyResults} bottleneck={sustained?.label} />
        ) : shown ? (
          <div className="flex min-w-0 flex-col rounded-xl border border-[#5a2a2e] bg-bad-bg px-4 py-3">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-bad-soft">
              <span aria-hidden="true">⚠</span> Bottleneck: {shown.label}
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#d9b4b4]">{shown.explanation}</p>
            {shown.suggestions.length > 0 && (
              <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                <span className="mr-1 self-center text-[11px] text-faint">Try next</span>
                {shown.suggestions.map((s) => (
                  <span key={s} className="rounded-full border border-line-strong bg-raised px-2.5 py-0.5 text-[11.5px]">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-w-0 flex-col rounded-xl border border-line bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-ok">
              <span aria-hidden="true">✓</span> {status === 'done' ? 'Run complete, no bottleneck' : 'Within modeled limits'}
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              {status === 'done' && totals
                ? `${totals.completed.toLocaleString()} of ${totals.arrivals.toLocaleString()} requests served · p95 ${fmtMs(totals.p95Ms)} · peak ${fmtRps(totals.peakThroughputRps)}.${
                    totals.messagesPublished > 0
                      ? ` ${totals.messagesPublished.toLocaleString()} messages published, ${totals.messagesConsumed.toLocaleString()} processed${totals.messagesDeadLettered > 0 ? `, ${totals.messagesDeadLettered.toLocaleString()} dead-lettered` : ''}.`
                      : ''
                  }`
                : 'Every component has headroom. Turn up the traffic or break something in the inspector.'}
            </p>
            <p className="mt-auto pt-2 text-[11px] text-faint">Modeled estimates from your settings, not measurements.</p>
          </div>
        )}
      </div>
    </div>
  );
}
