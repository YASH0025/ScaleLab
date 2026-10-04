import type { PlanResult, PlanTarget } from '@scalelab/planner';
import { create } from 'zustand';
import type { FromPlanner } from '@/workers/planner.worker';
import { doc, snapshot, updateNode } from './design-doc';
import { useSim } from './use-sim';
import { useUi } from './use-ui';

interface PlanState {
  open: boolean;
  target: PlanTarget;
  running: boolean;
  progress: { evaluations: number; maxEvaluations: number; message: string } | undefined;
  result: PlanResult | undefined;
  /** The design the result was computed for; applying is refused if it changed since. */
  plannedFor: string | undefined;
  show: () => void;
  close: () => void;
  setTarget: (t: Partial<PlanTarget>) => void;
  start: () => void;
  apply: () => void;
}

let worker: Worker | undefined;

const fingerprint = () => {
  const { nodes, edges } = snapshot();
  return JSON.stringify({ nodes: nodes.map((n) => [n.id, n.technologyId, n.config]), edges: edges.map((e) => [e.source, e.target]) });
};

/** The peak of the current traffic setting is a sensible first target. */
function peakRps(): number {
  const t = useSim.getState().traffic;
  return t.kind === 'constant' ? t.rps : Math.max(t.fromRps, t.toRps);
}

export const usePlan = create<PlanState>((set, get) => ({
  open: false,
  target: { rps: 3000, p95Ms: 300, maxErrorRate: 0.001, maxLagMs: 5000, maxUtilization: 0.8 },
  running: false,
  progress: undefined,
  result: undefined,
  plannedFor: undefined,

  show: () => {
    const running = get().running;
    set({ open: true, ...(running ? {} : { target: { ...get().target, rps: peakRps() } }) });
  },
  close: () => set({ open: false }),
  setTarget: (t) => set({ target: { ...get().target, ...t }, result: undefined }),

  start: () => {
    if (get().running) return;
    useSim.getState().reset();
    const { nodes, edges } = snapshot();
    if (!worker) {
      worker = new Worker(new URL('../workers/planner.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<FromPlanner>) => {
        const msg = event.data;
        if (msg.type === 'progress') set({ progress: { evaluations: msg.evaluations, maxEvaluations: msg.maxEvaluations, message: msg.message } });
        else if (msg.type === 'done') set({ running: false, result: msg.result, progress: undefined });
        else {
          set({ running: false, progress: undefined });
          useUi.getState().toast(msg.message, 'error');
        }
      };
    }
    set({ running: true, result: undefined, progress: { evaluations: 0, maxEvaluations: 40, message: 'Starting' }, plannedFor: fingerprint() });
    worker.postMessage({ type: 'plan', nodes, edges, target: get().target });
  },

  apply: () => {
    const { result, plannedFor, target } = get();
    if (!result || result.changes.length === 0) return;
    if (plannedFor !== fingerprint()) {
      useUi.getState().toast('Your design changed since this plan was made. Run the planner again.', 'error');
      return;
    }
    doc.transact(() => {
      for (const change of result.changes) {
        updateNode(change.nodeId, (n) => ({ ...n, config: { ...n.config, [change.knob]: change.to } as typeof n.config }));
      }
    });
    useSim.getState().setTraffic({ kind: 'constant', rps: target.rps });
    set({ open: false, result: undefined });
    useUi
      .getState()
      .toast(`Applied ${result.changes.length} change${result.changes.length > 1 ? 's' : ''}. Traffic is set to ${target.rps.toLocaleString()} rps: press Run to see it.`, 'success');
  },
}));
