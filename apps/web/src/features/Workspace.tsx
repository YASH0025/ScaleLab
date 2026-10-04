'use client';

import { checkoutShop, microShop, shopSphere } from '@scalelab/templates';
import { ReactFlowProvider } from '@xyflow/react';
import { useEffect } from 'react';
import { Canvas } from '@/features/canvas/Canvas';
import { Inspector } from '@/features/inspector/Inspector';
import { JourneysPanel } from '@/features/journeys/JourneysPanel';
import { LibraryPanel } from '@/features/library/LibraryPanel';
import { MetricsDrawer } from '@/features/metrics/MetricsDrawer';
import { PlanPanel } from '@/features/plan/PlanPanel';
import { SharedBanner } from '@/features/share/SharedBanner';
import { Celebration, Toasts } from '@/features/toolbar/Overlays';
import { Toolbar } from '@/features/toolbar/Toolbar';
import { clearBackup, saveBackup } from '@/lib/backup';
import { decodeDesign, readHash } from '@/lib/share';
import { clearDesign, isEmpty, loadDesign, snapshot, startPersistence } from '@/store/design-doc';
import { useDesign } from '@/store/use-design';
import { useJourneys } from '@/store/use-journeys';
import { useSim } from '@/store/use-sim';
import { useUi } from '@/store/use-ui';

/**
 * Opens a design from a share link in the URL hash, if there is one.
 * The visitor's own design is backed up first so they can restore it.
 * Returns true when a shared design was loaded.
 */
function openSharedLink(): boolean {
  const encoded = readHash(window.location.hash);
  if (!encoded) return false;
  window.history.replaceState(null, '', '/play');
  const result = decodeDesign(encoded);
  const ui = useUi.getState();
  if (!result.ok) {
    ui.toast(result.error, 'error');
    return false;
  }
  const own = snapshot();
  const canRestore = own.nodes.length > 0 && saveBackup(own);
  if (!canRestore) clearBackup();
  useSim.getState().reset();
  ui.select(undefined);
  loadDesign({
    nodes: result.design.nodes,
    edges: result.design.edges,
    ...(result.design.journeys ? { journeys: result.design.journeys } : {}),
    meta: { name: result.design.name },
  });
  if (result.design.traffic) useSim.getState().setTraffic(result.design.traffic);
  ui.setSharedBanner({ name: result.design.name, canRestore });
  return true;
}

export function Workspace({ template }: { template: string | undefined }) {
  const ready = useDesign((s) => s.ready);

  useEffect(() => {
    let cancelled = false;
    startPersistence().then(() => {
      if (cancelled) return;
      if (!openSharedLink()) {
        if (template === 'shopsphere' || (template === undefined && isEmpty())) loadDesign(shopSphere());
        else if (template === 'microservices') loadDesign(microShop());
        else if (template === 'checkout') {
          loadDesign(checkoutShop());
          useJourneys.getState().show('list');
        }
        else if (template === 'blank') clearDesign();
        if (template) window.history.replaceState(null, '', '/play');
      }
      useDesign.getState().setReady();
    });
    // A share link pasted into the address bar of an open tab only changes the hash.
    const onHashChange = () => openSharedLink();
    window.addEventListener('hashchange', onHashChange);
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [template]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <LibraryPanel />
        <main className="relative min-w-0 flex-1">
          {ready ? (
            <ReactFlowProvider>
              <Canvas />
            </ReactFlowProvider>
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-muted">Loading your design…</div>
          )}
          <SharedBanner />
        </main>
        <Inspector />
      </div>
      <MetricsDrawer />
      <PlanPanel />
      <JourneysPanel />
      <Toasts />
      <Celebration />
    </div>
  );
}
