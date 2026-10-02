import type { LiveChange, SimulationTotals, EngineMetricsSample, NodeSummary } from '@scalelab/engine';
import type { Design, Workload } from '@scalelab/model';

/** Messages from the page to the simulation worker. */
export type ToWorker =
  | { type: 'start'; design: Design; workload: Workload; speed: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'speed'; speed: number }
  | { type: 'inject'; change: LiveChange }
  | { type: 'stop' };

/** Messages from the worker back to the page. */
export type FromWorker =
  | { type: 'tick'; simTimeMs: number; samples: EngineMetricsSample[] }
  | { type: 'done'; totals: SimulationTotals; nodes: NodeSummary[]; warnings: string[] }
  | { type: 'error'; message: string };
