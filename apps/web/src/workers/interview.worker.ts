/// <reference lib="webworker" />
import { type GradeReport, grade, problemById } from '@scalelab/interview';
import type { ArchEdge, ArchNode } from '@scalelab/model';

/** Messages to the interview grader. */
export type ToGrader = { type: 'grade'; problemId: string; nodes: ArchNode[]; edges: ArchEdge[]; estimates: Record<string, number | undefined> };

/** Messages from the interview grader. */
export type FromGrader = { type: 'progress'; message: string } | { type: 'done'; report: GradeReport } | { type: 'error'; message: string };

const post = (msg: FromGrader) => (self as unknown as Worker).postMessage(msg);

/**
 * Grades a design off the main thread: two full simulations (peak load and a
 * failure drill) take a second or two, and the canvas should stay responsive.
 */
self.onmessage = (event: MessageEvent<ToGrader>) => {
  const msg = event.data;
  if (msg.type !== 'grade') return;
  const problem = problemById.get(msg.problemId);
  if (!problem) return post({ type: 'error', message: 'That interview problem no longer exists.' });
  try {
    const report = grade({ problem, design: { nodes: msg.nodes, edges: msg.edges }, estimates: msg.estimates }, (message) => post({ type: 'progress', message }));
    post({ type: 'done', report });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
