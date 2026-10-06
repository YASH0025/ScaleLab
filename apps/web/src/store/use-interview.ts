import type { GradeReport } from '@scalelab/interview';
import { problemById } from '@scalelab/interview';
import type { ArchNode } from '@scalelab/model';
import { create } from 'zustand';
import { clearBackup, loadBackup, saveBackup } from '@/lib/backup';
import { createNode } from '@/lib/design-helpers';
import type { FromGrader, ToGrader } from '@/workers/interview.worker';
import { type DesignSnapshot, loadDesign, snapshot } from './design-doc';
import { useSim } from './use-sim';
import { useUi } from './use-ui';

export type InterviewTab = 'brief' | 'estimates' | 'submit';

interface InterviewState {
  problemId: string | undefined;
  startedAt: number | undefined;
  /** Typed estimate answers, by estimate id. Kept as text so half-typed numbers survive. */
  estimates: Record<string, string>;
  panelOpen: boolean;
  tab: InterviewTab;
  grading: boolean;
  progress: string | undefined;
  report: GradeReport | undefined;
  reportOpen: boolean;
  /** The user's own design, kept while the model answer is on the canvas. */
  ownDesign: DesignSnapshot | undefined;

  start: (problemId: string) => void;
  resume: () => boolean;
  exit: () => void;
  setTab: (tab: InterviewTab) => void;
  togglePanel: () => void;
  setEstimate: (id: string, value: string) => void;
  submit: () => void;
  openReport: () => void;
  closeReport: () => void;
  showModelAnswer: () => void;
  backToMyDesign: () => void;
}

const SESSION_KEY = 'scalelab-interview';
const BEST_KEY = 'scalelab-interview-best';

interface Session {
  problemId: string;
  startedAt: number;
  estimates: Record<string, string>;
}

function readJson<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the session just won't survive a reload */
  }
}

/** Best score per problem, kept in this browser. */
export function bestScores(): Record<string, number> {
  return readJson<Record<string, number>>(BEST_KEY) ?? {};
}

function saveSession(s: InterviewState): void {
  writeJson(SESSION_KEY, s.problemId ? ({ problemId: s.problemId, startedAt: s.startedAt!, estimates: s.estimates } satisfies Session) : undefined);
}

/** A blank canvas with users ready to connect. */
function startingDesign(): ArchNode[] {
  const users = createNode('web-browser', { x: 0, y: 0 }, []);
  return [{ ...users, label: 'Users' }];
}

let worker: Worker | undefined;

export const useInterview = create<InterviewState>((set, get) => ({
  problemId: undefined,
  startedAt: undefined,
  estimates: {},
  panelOpen: true,
  tab: 'brief',
  grading: false,
  progress: undefined,
  report: undefined,
  reportOpen: false,
  ownDesign: undefined,

  start: (problemId) => {
    const problem = problemById.get(problemId);
    if (!problem) return;
    const own = snapshot();
    const canRestore = own.nodes.length > 0 && !get().problemId && saveBackup(own);
    if (!canRestore && !get().problemId) clearBackup();
    useSim.getState().reset();
    const ui = useUi.getState();
    ui.select(undefined);
    loadDesign({ nodes: startingDesign(), edges: [], journeys: [], meta: { name: `Interview: ${problem.title}` } });
    useSim.getState().setTraffic({ kind: 'constant', rps: problem.targets.peakRps, durationSec: 30 });
    ui.requestFit();
    set({ problemId, startedAt: Date.now(), estimates: {}, panelOpen: true, tab: 'brief', report: undefined, reportOpen: false, ownDesign: undefined, grading: false });
    saveSession(get());
  },

  resume: () => {
    const session = readJson<Session>(SESSION_KEY);
    if (!session || !problemById.has(session.problemId)) return false;
    set({ problemId: session.problemId, startedAt: session.startedAt, estimates: session.estimates, panelOpen: false, tab: 'brief' });
    return true;
  },

  exit: () => {
    worker?.terminate();
    worker = undefined;
    set({ problemId: undefined, startedAt: undefined, estimates: {}, report: undefined, reportOpen: false, ownDesign: undefined, grading: false, progress: undefined });
    saveSession(get());
    const backup = loadBackup();
    if (backup) {
      useSim.getState().reset();
      loadDesign({ nodes: backup.nodes, edges: backup.edges, journeys: backup.journeys ?? [], meta: { name: backup.name } });
      clearBackup();
      useUi.getState().requestFit();
      useUi.getState().toast('Interview closed. Your previous design is back.', 'success');
    }
  },

  setTab: (tab) => set({ tab, panelOpen: true }),
  togglePanel: () => set({ panelOpen: !get().panelOpen }),
  setEstimate: (id, value) => {
    set({ estimates: { ...get().estimates, [id]: value } });
    saveSession(get());
  },

  submit: () => {
    const { problemId, estimates, grading, ownDesign } = get();
    if (!problemId || grading) return;
    if (ownDesign) {
      useUi.getState().toast('The model answer is on the canvas. Go back to your design first.', 'error');
      return;
    }
    const { nodes, edges } = snapshot();
    const parsed: Record<string, number | undefined> = {};
    for (const [id, v] of Object.entries(estimates)) {
      const n = Number(v.replace(/[, _]/g, ''));
      parsed[id] = v.trim() && Number.isFinite(n) ? n : undefined;
    }
    useSim.getState().reset();
    set({ grading: true, progress: 'Starting', reportOpen: true, report: undefined });
    if (!worker) {
      worker = new Worker(new URL('../workers/interview.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<FromGrader>) => {
        const msg = event.data;
        if (msg.type === 'progress') set({ progress: msg.message });
        else if (msg.type === 'done') {
          set({ grading: false, progress: undefined, report: msg.report });
          const id = get().problemId;
          if (id) {
            const best = bestScores();
            if ((best[id] ?? -1) < msg.report.score) writeJson(BEST_KEY, { ...best, [id]: msg.report.score });
          }
          if (msg.report.score >= 85) useUi.getState().celebrate();
        } else {
          set({ grading: false, progress: undefined, reportOpen: false });
          useUi.getState().toast(msg.message, 'error');
        }
      };
    }
    worker.postMessage({ type: 'grade', problemId, nodes, edges, estimates: parsed } satisfies ToGrader);
  },

  openReport: () => set({ reportOpen: true }),
  closeReport: () => set({ reportOpen: false }),

  showModelAnswer: () => {
    const problem = get().problemId ? problemById.get(get().problemId!) : undefined;
    if (!problem) return;
    const own = get().ownDesign ?? snapshot();
    const model = problem.reference();
    useSim.getState().reset();
    loadDesign({ nodes: model.nodes, edges: model.edges, journeys: [], meta: { name: `Model answer: ${problem.title}` } });
    useUi.getState().requestFit();
    // Fold the brief so the whole model answer is visible.
    set({ ownDesign: own, reportOpen: false, panelOpen: false });
  },

  backToMyDesign: () => {
    const own = get().ownDesign;
    if (!own) return;
    useSim.getState().reset();
    loadDesign({ nodes: own.nodes, edges: own.edges, journeys: own.journeys, meta: { name: own.name } });
    useUi.getState().requestFit();
    set({ ownDesign: undefined });
  },
}));
