'use client';

import { clearBackup, loadBackup } from '@/lib/backup';
import { loadDesign } from '@/store/design-doc';
import { useSim } from '@/store/use-sim';
import { useUi } from '@/store/use-ui';

/** Shown after opening a share link: what you're looking at, and a way back to your own work. */
export function SharedBanner() {
  const banner = useUi((s) => s.sharedBanner);
  const setBanner = useUi((s) => s.setSharedBanner);
  if (!banner) return null;

  const restore = () => {
    const backup = loadBackup();
    if (!backup) {
      useUi.getState().toast('Your previous design could not be found.', 'error');
      setBanner(undefined);
      return;
    }
    useSim.getState().reset();
    useUi.getState().select(undefined);
    loadDesign({ nodes: backup.nodes, edges: backup.edges, meta: { name: backup.name } });
    clearBackup();
    setBanner(undefined);
    useUi.getState().toast('Your previous design is back.', 'success');
  };

  return (
    <div className="anim-toast absolute left-1/2 top-3 z-10 flex max-w-[92%] -translate-x-1/2 items-center gap-3 rounded-xl border border-accent/50 bg-panel px-4 py-2.5 text-[13px] shadow-2xl">
      <span aria-hidden="true">🔗</span>
      <span className="min-w-0">
        <span className="text-muted">Opened a shared design: </span>
        <span className="font-semibold">{banner.name}</span>
        <span className="text-muted">. It’s yours to edit and run.</span>
      </span>
      {banner.canRestore && (
        <button onClick={restore} className="shrink-0 rounded-lg border border-line-strong px-2.5 py-1 text-[12px] hover:bg-raised">
          Restore my previous design
        </button>
      )}
      <button onClick={() => setBanner(undefined)} aria-label="Dismiss" className="shrink-0 px-1 text-faint hover:text-ink">
        ×
      </button>
    </div>
  );
}
