'use client';

import { shopSphere } from '@scalelab/templates';
import { ReactFlowProvider } from '@xyflow/react';
import { useEffect } from 'react';
import { Canvas } from '@/features/canvas/Canvas';
import { Inspector } from '@/features/inspector/Inspector';
import { LibraryPanel } from '@/features/library/LibraryPanel';
import { MetricsDrawer } from '@/features/metrics/MetricsDrawer';
import { Celebration, Toasts } from '@/features/toolbar/Overlays';
import { Toolbar } from '@/features/toolbar/Toolbar';
import { clearDesign, isEmpty, loadDesign, startPersistence } from '@/store/design-doc';
import { useDesign } from '@/store/use-design';

export function Workspace({ template }: { template: string | undefined }) {
  const ready = useDesign((s) => s.ready);

  useEffect(() => {
    let cancelled = false;
    startPersistence().then(() => {
      if (cancelled) return;
      if (template === 'shopsphere' || (template === undefined && isEmpty())) loadDesign(shopSphere());
      else if (template === 'blank') clearDesign();
      useDesign.getState().setReady();
      if (template) window.history.replaceState(null, '', '/play');
    });
    return () => {
      cancelled = true;
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
        </main>
        <Inspector />
      </div>
      <MetricsDrawer />
      <Toasts />
      <Celebration />
    </div>
  );
}
