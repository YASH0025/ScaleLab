import { resolveArchetype } from '@scalelab/catalog';
import type { EngineMetricsSample, LiveChange, NodeSummary, SimulationTotals } from '@scalelab/engine';
import { type Design, type TrafficPattern, type Workload, deriveFlows, derivedMix } from '@scalelab/model';
import { create } from 'zustand';
import { findBottleneck } from '@/lib/findings';
import type { FromWorker, ToWorker } from '@/workers/protocol';
import { snapshot } from './design-doc';
import { useUi } from './use-ui';

export type SimStatus = 'idle' | 'running' | 'paused' | 'done';

export interface TrafficSettings {
  kind: 'constant' | 'ramp' | 'spike';
  rps: number;
  fromRps: number;
  toRps: number;
  durationSec: number;
}

export const SPEEDS = [1, 2, 5, 10, 20] as const;

interface SimState {
  status: SimStatus;
  speed: number;
  traffic: TrafficSettings;
  samples: EngineMetricsSample[];
  latest: EngineMetricsSample | undefined;
  simTimeMs: number;
  /** Traffic duration of the current run; samples after it are the drain tail. */
  runDurationSec: number;
  totals: SimulationTotals | undefined;
  nodeSummaries: NodeSummary[];
  hints: string[];
  /** Nodes or instances taken down during this run, for the inspector buttons. */
  injected: Record<string, { down: boolean; downInstances: number[]; extraLatencyMs: number }>;
  /** Did the previous run end with a bottleneck? Used to celebrate a fix. */
  previousRunHadBottleneck: boolean;

  run: () => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  setSpeed: (speed: number) => void;
  setTraffic: (traffic: Partial<TrafficSettings>) => void;
  inject: (change: LiveChange) => void;
}

let worker: Worker | undefined;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<FromWorker>) => handle(event.data);
  }
  return worker;
}

const send = (msg: ToWorker) => getWorker().postMessage(msg);

function patternOf(t: TrafficSettings): TrafficPattern {
  switch (t.kind) {
    case 'constant':
      return { kind: 'constant', rps: t.rps };
    case 'ramp':
      return { kind: 'ramp', fromRps: t.fromRps, toRps: t.toRps };
    case 'spike':
      return {
        kind: 'spike',
        baseRps: t.fromRps,
        spikeRps: t.toRps,
        spikeAtSec: Math.round(t.durationSec * 0.4),
        spikeDurationSec: Math.max(1, Math.round(t.durationSec * 0.2)),
      };
  }
}

function handle(msg: FromWorker) {
  const state = useSim.getState();
  switch (msg.type) {
    case 'tick': {
      const fresh = msg.samples.filter((x) => x.simTimeSec <= state.runDurationSec);
      if (fresh.length === 0) {
        useSim.setState({ simTimeMs: Math.min(msg.simTimeMs, state.runDurationSec * 1000) });
        return;
      }
      const samples = [...state.samples, ...fresh].slice(-600);
      useSim.setState({ samples, latest: samples[samples.length - 1], simTimeMs: msg.simTimeMs });
      return;
    }
    case 'done': {
      const { nodes, edges } = snapshot();
      const hadBottleneck = state.samples.some((s) => findBottleneck(s, nodes, edges));
      useSim.setState({ status: 'done', totals: msg.totals, nodeSummaries: msg.nodes, previousRunHadBottleneck: hadBottleneck });
      if (state.previousRunHadBottleneck && !hadBottleneck && msg.totals.errorRate < 0.01) {
        useUi.getState().celebrate();
      }
      return;
    }
    case 'error':
      useSim.setState({ status: 'idle' });
      useUi.getState().toast(msg.message, 'error');
      return;
  }
}

export const useSim = create<SimState>((set, get) => ({
  status: 'idle',
  speed: 5,
  traffic: { kind: 'ramp', rps: 1000, fromRps: 500, toRps: 5000, durationSec: 60 },
  samples: [],
  latest: undefined,
  simTimeMs: 0,
  runDurationSec: 60,
  totals: undefined,
  nodeSummaries: [],
  hints: [],
  injected: {},
  previousRunHadBottleneck: false,

  run: () => {
    const { name, nodes, edges } = snapshot();
    const { flows, handlers, hints } = deriveFlows(nodes, edges, resolveArchetype);
    set({ hints });
    if (flows.length === 0) {
      useUi.getState().toast(hints[0] ?? 'Nothing to simulate yet.', 'error');
      return;
    }
    const { traffic, speed } = get();
    const design: Design = {
      schemaVersion: 1,
      meta: { name, description: '', createdAt: new Date().toISOString() },
      nodes,
      edges,
      flows,
      handlers,
      workloads: [],
    };
    const workload: Workload = {
      id: 'live',
      name: 'Live run',
      durationSec: traffic.durationSec,
      pattern: patternOf(traffic),
      mix: derivedMix(flows),
      seed: 42,
    };
    set({
      status: 'running',
      samples: [],
      latest: undefined,
      simTimeMs: 0,
      runDurationSec: traffic.durationSec,
      totals: undefined,
      nodeSummaries: [],
      injected: {},
    });
    send({ type: 'start', design, workload, speed });
  },
  pause: () => {
    send({ type: 'pause' });
    set({ status: 'paused' });
  },
  resume: () => {
    send({ type: 'resume' });
    set({ status: 'running' });
  },
  reset: () => {
    if (worker) send({ type: 'stop' });
    set({ status: 'idle', samples: [], latest: undefined, simTimeMs: 0, totals: undefined, nodeSummaries: [], injected: {} });
  },
  setSpeed: (speed) => {
    set({ speed });
    if (worker) send({ type: 'speed', speed });
  },
  setTraffic: (traffic) => set({ traffic: { ...get().traffic, ...traffic } }),
  inject: (change) => {
    const status = get().status;
    if (status !== 'running' && status !== 'paused') return;
    send({ type: 'inject', change });
    const prev = get().injected[change.nodeId] ?? { down: false, downInstances: [], extraLatencyMs: 0 };
    let next = prev;
    if (change.action === 'latency') next = { ...prev, extraLatencyMs: change.extraLatencyMs };
    else if (change.instance !== undefined) {
      const down = new Set(prev.downInstances);
      if (change.action === 'down') down.add(change.instance);
      else down.delete(change.instance);
      next = { ...prev, downInstances: [...down] };
    } else next = { ...prev, down: change.action === 'down', downInstances: change.action === 'up' ? [] : prev.downInstances };
    set({ injected: { ...get().injected, [change.nodeId]: next } });
  },
}));
