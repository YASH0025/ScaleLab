import { type CostEstimate, estimateCost } from '@scalelab/planner';
import { useMemo } from 'react';
import { useDesign } from '@/store/use-design';
import { useSim } from '@/store/use-sim';

/**
 * Monthly cost of the current design at the peak of the current traffic setting.
 * Usage-based prices (load balancer capacity, SQS) use the latest run's message rates when available.
 */
export function useCost(): { estimate: CostEstimate; rps: number } {
  const nodes = useDesign((s) => s.nodes);
  const traffic = useSim((s) => s.traffic);
  const latest = useSim((s) => s.latest);
  const rps = traffic.kind === 'constant' ? traffic.rps : Math.max(traffic.fromRps, traffic.toRps);
  const estimate = useMemo(() => {
    const messagesPerSec: Record<string, number> = {};
    for (const n of latest?.nodes ?? []) {
      if (n.consumedPerSec !== undefined) messagesPerSec[n.nodeId] = n.servedPerSec;
    }
    return estimateCost(nodes, { requestsPerSec: rps, messagesPerSec });
  }, [nodes, rps, latest]);
  return { estimate, rps };
}
