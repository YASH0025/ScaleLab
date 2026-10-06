'use client';

import { getLibrary, getTechnology } from '@scalelab/catalog';
import { type ArchNode, archetypeName } from '@scalelab/model';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import { type Health, LAG_HOT_MS, healthOfSample } from '@/lib/findings';
import { TechIcon } from '@/lib/tech-icon';
import { useSim } from '@/store/use-sim';

export type TechNodeData = { arch: ArchNode };
export type TechFlowNode = Node<TechNodeData, 'tech'>;

const BORDER: Record<Health, string> = {
  idle: 'border-line-strong',
  ok: 'border-ok',
  warm: 'border-warn',
  hot: 'border-bad',
  down: 'border-line-strong',
};
const lag = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);
const compact = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString());

const BAR: Record<Health, string> = {
  idle: 'bg-line-strong',
  ok: 'bg-ok',
  warm: 'bg-warn',
  hot: 'bg-bad',
  down: 'bg-line',
};

function TechNodeView({ data }: NodeProps<TechFlowNode>) {
  const { arch } = data;
  const tech = getTechnology(arch.technologyId);
  const live = useSim((s) => s.latest?.nodes.find((n) => n.nodeId === arch.id));
  const running = useSim((s) => s.status !== 'idle');
  if (!tech) return null;

  const health: Health = healthOfSample(live, tech.archetype);
  const isClient = tech.archetype === 'client';
  const isQueue = arch.config.type === 'queue';
  const isExternal = arch.config.type === 'external';
  const isLimiter = arch.config.type === 'load-balancer' && (arch.config.rateLimitRps ?? 0) > 0;
  /** Queues fill their bar by consumer lag (full at the "falling behind" mark); everything else by utilization. */
  /** Outside services fill their bar by failure share (full at 10%) or rate-limit use, whichever is worse. */
  const failShare = live && live.servedPerSec > 0 ? (live.failedPerSec ?? 0) / live.servedPerSec : 0;
  const barPct = isExternal || isLimiter
    ? Math.min(100, Math.max(failShare * 1000, (live?.utilization ?? 0) * 100))
    : isQueue
      ? Math.min(100, ((live?.lagMs ?? 0) / LAG_HOT_MS) * 100)
      : (live?.utilization ?? 0) * 100;
  const instances = arch.config.type === 'compute' ? arch.config.instances : undefined;
  const util = live ? Math.round(live.utilization * 100) : undefined;

  return (
    <div
      className={`anim-drop relative w-[228px] rounded-2xl border-2 bg-card px-3.5 pb-3 pt-3 transition-colors duration-300 ${BORDER[health]} ${
        health === 'hot' ? 'anim-hot bg-bad-bg' : ''
      } ${health === 'down' ? 'opacity-60 grayscale' : ''}`}
    >
      {!isClient && <Handle type="target" position={Position.Top} />}

      <div className="flex items-center gap-3">
        <TechIcon icon={tech.icon} name={tech.name} brandColor={tech.brandColor} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold leading-tight">{arch.label}</div>
          <div className="truncate text-[12px] text-muted">
            {arch.label === tech.name ? archetypeName(tech.archetype) : tech.name}
            {instances !== undefined && instances > 1 ? ` · ×${instances}` : ''}
          </div>
        </div>
        {!tech.simulationSupported && (
          <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-faint" title="Placeable now; simulation coming soon">
            soon
          </span>
        )}
      </div>

      {running && live && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-raised">
            <div className={`h-full rounded-full transition-[width] duration-300 ${BAR[health]}`} style={{ width: `${barPct}%` }} />
          </div>
          <div className="mt-1.5 flex items-center gap-2 font-mono text-[11px] text-muted">
            {health === 'down' ? (
              <span className="text-bad-soft">down</span>
            ) : isQueue ? (
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={`whitespace-nowrap ${health === 'hot' ? 'text-bad-soft' : ''}`}>
                  <span title="Messages waiting">{compact(live.queueLength)} waiting</span>
                  <span title="Age of the oldest waiting message"> · lag {lag(live.lagMs ?? 0)}</span>
                </span>
                <span className="whitespace-nowrap text-faint" title="Messages published and processed per second">
                  in {compact(live.servedPerSec)}/s · out {compact(live.consumedPerSec ?? 0)}/s
                </span>
              </span>
            ) : isLimiter ? (
              <span className="whitespace-nowrap">
                <span title="Requests let through per second">{compact(live.servedPerSec)}/s</span>
                <span className={(live.failedPerSec ?? 0) > 0 ? 'text-bad-soft' : ''} title="Requests answered 429 per second">
                  {' '}
                  · {compact(live.failedPerSec ?? 0)} limited
                </span>
              </span>
            ) : arch.config.type === 'load-balancer' ? (
              <span className="whitespace-nowrap">{compact(live.servedPerSec)}/s</span>
            ) : isExternal ? (
              <span className="whitespace-nowrap">
                <span title="Calls per second">{compact(live.servedPerSec)} calls/s</span>
                <span className={(live.failedPerSec ?? 0) > 0 ? 'text-bad-soft' : ''} title="Calls that failed or timed out per second">
                  {' '}
                  · {compact(live.failedPerSec ?? 0)} failed
                </span>
                {arch.config.type === 'external' && arch.config.rateLimitRps > 0 && <span className="text-faint"> · limit {util ?? 0}%</span>}
              </span>
            ) : (
              <>
                <span className={health === 'hot' ? 'text-bad-soft' : ''}>{util ?? 0}%</span>
                <span>· q {live?.queueLength ?? 0}</span>
                {live?.observedHitRatio !== undefined && <span>· hit {Math.round(live.observedHitRatio * 100)}%</span>}
              </>
            )}
            {live?.instances && (
              <span className="ml-auto flex gap-1" aria-label="Instance health">
                {live.instances.map((i, idx) => (
                  <span
                    key={idx}
                    title={`Instance ${idx + 1}: ${i.up ? `${Math.round(i.utilization * 100)}%` : 'down'}`}
                    className={`h-2 w-2 rounded-full ${!i.up ? 'bg-line-strong' : i.utilization >= 0.9 ? 'bg-bad' : i.utilization >= 0.7 ? 'bg-warn' : 'bg-ok'}`}
                  />
                ))}
              </span>
            )}
          </div>
        </div>
      )}

      {arch.libraries.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {arch.libraries.map((l) => {
            const lib = getLibrary(l.libraryId);
            if (!lib) return null;
            return (
              <span key={l.libraryId} className="anim-chip" title={lib.name}>
                <TechIcon icon={lib.icon} name={lib.name} brandColor={lib.brandColor} size={20} />
              </span>
            );
          })}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const TechNode = memo(TechNodeView);
