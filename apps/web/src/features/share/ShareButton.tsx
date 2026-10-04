'use client';

import { useRef, useState } from 'react';
import { SAFE_URL_LENGTH, shareUrl } from '@/lib/share';
import { snapshot } from '@/store/design-doc';
import { useSim } from '@/store/use-sim';
import { useUi } from '@/store/use-ui';

/** Builds a link that contains the whole design and copies it to the clipboard. */
export function ShareButton({ className }: { className: string }) {
  const [url, setUrl] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const toast = useUi((s) => s.toast);

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked; the link stays selected in the box for manual copy.
      input.current?.select();
    }
  };

  const open = () => {
    const { name, nodes, edges, journeys } = snapshot();
    if (nodes.length === 0) {
      toast('Add a few components before sharing.', 'error');
      return;
    }
    const link = shareUrl(window.location.origin, {
      name,
      nodes,
      edges,
      ...(journeys.length > 0 ? { journeys } : {}),
      traffic: useSim.getState().traffic,
    });
    setUrl(link);
    void copy(link);
  };

  return (
    <div className="relative">
      <button onClick={() => (url ? setUrl(undefined) : open())} className={className}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M10 14a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1" />
          <path d="M14 10a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1" />
        </svg>
        Share
      </button>
      {url && (
        <div className="absolute right-0 top-11 z-50 w-[380px] rounded-xl border border-line-strong bg-panel p-4 shadow-2xl">
          <div className="text-[14px] font-semibold">{copied ? 'Link copied' : 'Share this design'}</div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            Anyone with the link can open, edit and run their own copy. Your changes stay yours.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              ref={input}
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Share link"
              className="min-w-0 flex-1 rounded-md border border-line-strong bg-bg px-2 py-1.5 font-mono text-[11px] text-muted outline-none focus:border-accent"
            />
            <button
              onClick={() => void copy(url)}
              className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:brightness-110"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          {url.length > SAFE_URL_LENGTH && (
            <p className="mt-2 text-[11px] text-warn">This design is large, so the link is long. Some chat apps may cut it off.</p>
          )}
          <p className="mt-3 text-[11px] text-faint">Links include components, settings, libraries, connections and traffic.</p>
        </div>
      )}
    </div>
  );
}
