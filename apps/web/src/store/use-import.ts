import { type ImportResult, analyzeProject, toDesign } from '@scalelab/importer';
import { create } from 'zustand';
import { clearBackup, saveBackup } from '@/lib/backup';
import { type LoadedProject, loadFromFolder, loadFromGitHub } from '@/lib/repo-source';
import { loadDesign, snapshot } from './design-doc';
import { useSim } from './use-sim';
import { useUi } from './use-ui';

export type ImportStep = 'source' | 'reading' | 'review';

interface ImportState {
  open: boolean;
  step: ImportStep;
  url: string;
  progress: string;
  error: string | undefined;
  project: Omit<LoadedProject, 'files'> & { fileCount: number } | undefined;
  result: ImportResult | undefined;
  /** Components the user unticked. */
  excluded: Set<string>;

  show: () => void;
  close: () => void;
  back: () => void;
  setUrl: (url: string) => void;
  fromGitHub: () => Promise<void>;
  fromFolder: (files: FileList) => Promise<void>;
  toggle: (key: string) => void;
  load: () => void;
}

let controller: AbortController | undefined;

export const useImport = create<ImportState>((set, get) => {
  const run = async (read: (progress: (m: string) => void, signal: AbortSignal) => Promise<LoadedProject>) => {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    set({ step: 'reading', progress: 'Starting', error: undefined, result: undefined });
    try {
      const project = await read((progress) => !signal.aborted && set({ progress }), signal);
      if (signal.aborted) return;
      set({ progress: 'Working out your architecture' });
      const result = analyzeProject(project.files, project.name);
      const { files, ...rest } = project;
      set({ step: 'review', result, project: { ...rest, fileCount: files.length }, excluded: new Set() });
    } catch (err) {
      if (signal.aborted) return;
      set({ step: 'source', error: err instanceof Error ? err.message : String(err) });
    }
  };

  return {
    open: false,
    step: 'source',
    url: '',
    progress: '',
    error: undefined,
    project: undefined,
    result: undefined,
    excluded: new Set(),

    show: () => set({ open: true, ...(get().step === 'reading' ? {} : { step: get().result ? 'review' : 'source' }) }),
    close: () => {
      if (get().step === 'reading') {
        controller?.abort();
        set({ step: 'source' });
      }
      set({ open: false });
    },
    back: () => {
      controller?.abort();
      set({ step: 'source', error: undefined });
    },
    setUrl: (url) => set({ url, error: undefined }),
    fromGitHub: () => run((progress, signal) => loadFromGitHub(get().url, progress, signal)),
    fromFolder: (files) => run((progress) => loadFromFolder(files, progress)),
    toggle: (key) => {
      const excluded = new Set(get().excluded);
      if (excluded.has(key)) excluded.delete(key);
      else excluded.add(key);
      set({ excluded });
    },

    load: () => {
      const { result, excluded, project } = get();
      if (!result || !project) return;
      const design = toDesign(result, excluded);
      if (design.nodes.length === 0) {
        useUi.getState().toast('Pick at least one component to load.', 'error');
        return;
      }
      const own = snapshot();
      const canRestore = own.nodes.length > 0 && saveBackup(own);
      if (!canRestore) clearBackup();
      useSim.getState().reset();
      const ui = useUi.getState();
      ui.select(undefined);
      loadDesign({ nodes: design.nodes, edges: design.edges, journeys: [], meta: { name: result.name } });
      ui.setSharedBanner({ name: project.source, canRestore, kind: 'imported' });
      ui.requestFit();
      set({ open: false, step: 'source', result: undefined, project: undefined, excluded: new Set() });
      if (design.dropped.length > 0) {
        ui.toast(`Loaded ${design.nodes.length} components. ${design.dropped.length} connection${design.dropped.length > 1 ? 's were' : ' was'} left out because the canvas doesn't allow ${design.dropped.length > 1 ? 'them' : 'it'}.`, 'info');
      } else {
        ui.toast(`Loaded ${design.nodes.length} components and ${design.edges.length} connections. Press Run to try it.`, 'success');
      }
    },
  };
});
