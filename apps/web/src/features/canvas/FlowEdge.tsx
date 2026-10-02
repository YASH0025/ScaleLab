'use client';

import { getTechnology } from '@scalelab/catalog';
import type { ArchEdge } from '@scalelab/model';
import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from '@xyflow/react';
import { memo } from 'react';
import { PROTOCOL_LABEL } from '@/lib/design-helpers';
import { useSim } from '@/store/use-sim';

export type FlowEdgeData = { arch: ArchEdge; sourceTechId: string; targetTechId: string };
export type FlowEdgeType = Edge<FlowEdgeData, 'flow'>;

const BLUE = '#5b9cff';
const GREEN = '#4ade80';
const ORANGE = '#f5a524';
const RED = '#ff5a5a';

/** How many packets to draw for a given rate: log-scaled so 50 and 5,000 rps both read well. */
function packetCount(rps: number): number {
  if (rps <= 0) return 0;
  return Math.max(1, Math.min(7, Math.round(Math.log10(rps + 1) * 1.8)));
}

function FlowEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<FlowEdgeType>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const arch = data?.arch;
  const sourceTechId = data?.sourceTechId;
  const targetTechId = data?.targetTechId;

  const rate = useSim((s) => {
    const latest = s.latest;
    if (!latest || !arch) return 0;
    if (getTechnology(sourceTechId ?? '')?.archetype === 'client') return latest.offeredRps;
    return latest.nodes.find((n) => n.nodeId === arch.target)?.servedPerSec ?? 0;
  });
  const targetHot = useSim((s) => {
    const n = s.latest?.nodes.find((x) => x.nodeId === arch?.target);
    return Boolean(n && n.utilization >= 0.95 && (s.latest?.errorRate ?? 0) > 0.02);
  });
  const targetDown = useSim((s) => s.latest?.nodes.find((x) => x.nodeId === arch?.target)?.up === false);
  const running = useSim((s) => s.status === 'running');

  const targetKind = getTechnology(targetTechId ?? '')?.archetype;
  const color = targetDown ? RED : targetKind === 'cache' ? GREEN : targetKind === 'relational-db' ? ORANGE : BLUE;
  const count = packetCount(rate);
  const width = rate > 0 ? Math.min(6, 1.5 + Math.log10(rate + 1)) : 1.5;
  const duration = 1.6;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: selected ? 'var(--color-accent)' : targetHot || targetDown ? '#6b3434' : '#3a4560',
          strokeWidth: width,
          transition: 'stroke-width 300ms, stroke 300ms',
        }}
      />
      {count > 0 && (
        <g style={{ filter: `drop-shadow(0 0 4px ${color})` }} opacity={running ? 1 : 0.5}>
          {Array.from({ length: count }, (_, i) => (
            <circle key={`${i}-${count}`} r={3.6} fill={i === 0 && (targetHot || targetDown) ? RED : color}>
              <animateMotion dur={`${duration}s`} begin={`${(i * duration) / count}s`} repeatCount="indefinite" path={path} />
            </circle>
          ))}
        </g>
      )}
      {arch && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded-full border border-line bg-raised px-2 py-0.5 font-mono text-[10px] text-muted"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {PROTOCOL_LABEL[arch.protocol]}
            {rate > 0 && <span className="ml-1 text-ink">{Math.round(rate).toLocaleString()}/s</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const FlowEdge = memo(FlowEdgeView);
