'use client';

import { getLibrary, getTechnology } from '@scalelab/catalog';
import { type ArchNode, archetypeName } from '@scalelab/model';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import { type Health, healthOf } from '@/lib/findings';
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

  const health: Health = live ? healthOf(live.utilization, live.up) : 'idle';
  const isClient = tech.archetype === 'client';
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
            <div className={`h-full rounded-full transition-[width] duration-300 ${BAR[health]}`} style={{ width: `${util ?? 0}%` }} />
          </div>
          <div className="mt-1.5 flex items-center gap-2 font-mono text-[11px] text-muted">
            {health === 'down' ? (
              <span className="text-bad-soft">down</span>
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
