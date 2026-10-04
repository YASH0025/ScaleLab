/// <reference lib="webworker" />
import { type PlanResult, type PlanTarget, planCapacity } from '@scalelab/planner';
import type { ArchEdge, ArchNode } from '@scalelab/model';

/** Messages to the planner worker. */
export type ToPlanner = { type: 'plan'; nodes: ArchNode[]; edges: ArchEdge[]; target: PlanTarget };

/** Messages from the planner worker. */
export type FromPlanner =
  | { type: 'progress'; evaluations: number; maxEvaluations: number; message: string }
  | { type: 'done'; result: PlanResult }
  | { type: 'error'; message: string };

const post = (msg: FromPlanner) => (self as unknown as Worker).postMessage(msg);

/**
 * Runs the capacity planner off the main thread. Each candidate is a full simulation,
 * so a search can take several seconds; progress is posted after every candidate.
 */
self.onmessage = (event: MessageEvent<ToPlanner>) => {
  const msg = event.data;
  if (msg.type !== 'plan') return;
  try {
    const result = planCapacity(msg.nodes, msg.edges, msg.target, {
      onProgress: (p) => post({ type: 'progress', ...p }),
    });
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
