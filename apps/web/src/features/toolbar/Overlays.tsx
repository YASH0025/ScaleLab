'use client';

import { useUi } from '@/store/use-ui';

const COLORS = ['#5b6cff', '#20c4a8', '#f5a524', '#4ade80', '#ff7ab6', '#9aa6ff'];

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-[226px] left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`anim-toast pointer-events-auto max-w-md rounded-xl border px-4 py-2.5 text-left text-[13px] shadow-2xl ${
            t.tone === 'error'
              ? 'border-[#5a2a2e] bg-bad-bg text-bad-soft'
              : t.tone === 'success'
                ? 'border-[#24553a] bg-[#122019] text-ok'
                : 'border-line-strong bg-panel text-ink'
          }`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}

/** A short burst of confetti when a bottleneck gets fixed. */
export function Celebration() {
  const celebrating = useUi((s) => s.celebrating);
  if (!celebrating) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center pt-24" aria-live="polite">
      <div className="anim-toast rounded-2xl border border-[#24553a] bg-[#122019] px-6 py-3 text-[16px] font-semibold text-ok shadow-2xl">
        🎉 Bottleneck fixed! Same traffic, no errors.
      </div>
      {Array.from({ length: 36 }, (_, i) => (
        <span
          key={i}
          className="absolute top-20 h-2.5 w-1.5 rounded-sm"
          style={{
            left: `${20 + ((i * 37) % 60)}%`,
            background: COLORS[i % COLORS.length],
            animation: `confetti-fall ${1.4 + (i % 5) * 0.2}s ease-in ${(i % 7) * 0.08}s forwards`,
          }}
        />
      ))}
    </div>
  );
}
