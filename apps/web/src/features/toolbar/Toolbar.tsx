'use client';

import { checkoutShop, microShop, shopSphere } from '@scalelab/templates';
import { useState } from 'react';
import { ShareButton } from '@/features/share/ShareButton';
import { useImport } from '@/store/use-import';
import { useJourneys } from '@/store/use-journeys';
import { usePlan } from '@/store/use-plan';
import { clearDesign, loadDesign, renameDesign } from '@/store/design-doc';
import { useDesign } from '@/store/use-design';
import { SPEEDS, type TrafficSettings, useSim } from '@/store/use-sim';
import { useUi } from '@/store/use-ui';

const base = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] transition-colors disabled:opacity-40';
const btn = `${base} border-line-strong bg-card text-ink hover:bg-raised`;
const primary = `${base} border-accent bg-accent font-semibold text-white hover:brightness-110`;

function TrafficPopover({ onClose }: { onClose: () => void }) {
  const traffic = useSim((s) => s.traffic);
  const setTraffic = useSim((s) => s.setTraffic);
  const field = (label: string, key: keyof TrafficSettings, max = 50_000) => (
    <label className="flex items-center justify-between gap-3 py-1 text-[13px]">
      <span className="text-muted">{label}</span>
      <input
        type="number"
        min={1}
        max={max}
        value={traffic[key] as number}
        onChange={(e) => setTraffic({ [key]: Math.max(1, Math.min(max, Number(e.target.value) || 1)) })}
        className="w-24 rounded-md border border-line-strong bg-bg px-2 py-1 text-right font-mono text-[12px] outline-none focus:border-accent"
      />
    </label>
  );
  return (
    <div className="absolute right-0 top-11 z-50 w-72 rounded-xl border border-line-strong bg-panel p-4 shadow-2xl">
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-bg p-1">
        {(['ramp', 'constant', 'spike'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTraffic({ kind: k })}
            className={`rounded-md py-1 text-[12px] capitalize ${traffic.kind === k ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}
          >
            {k}
          </button>
        ))}
      </div>
      {traffic.kind === 'constant' && field('Requests / sec', 'rps')}
      {traffic.kind === 'ramp' && (
        <>
          {field('Start at (rps)', 'fromRps')}
          {field('End at (rps)', 'toRps')}
        </>
      )}
      {traffic.kind === 'spike' && (
        <>
          {field('Normal (rps)', 'fromRps')}
          {field('Spike (rps)', 'toRps')}
        </>
      )}
      {field('Duration (s)', 'durationSec', 600)}
      <p className="mt-2 text-[11px] leading-relaxed text-faint">Requests are 90% reads and 10% writes. Applies on the next run.</p>
      <button onClick={onClose} className="mt-3 w-full rounded-lg bg-raised py-1.5 text-[12px] hover:bg-line">
        Done
      </button>
    </div>
  );
}

function trafficLabel(t: TrafficSettings): string {
  const n = (v: number) => v.toLocaleString();
  if (t.kind === 'constant') return `${n(t.rps)} rps`;
  if (t.kind === 'ramp') return `Ramp ${n(t.fromRps)}→${n(t.toRps)} rps`;
  return `Spike ${n(t.fromRps)}→${n(t.toRps)} rps`;
}

export function Toolbar() {
  const name = useDesign((s) => s.name);
  const status = useSim((s) => s.status);
  const simTimeMs = useSim((s) => s.simTimeMs);
  const traffic = useSim((s) => s.traffic);
  const speed = useSim((s) => s.speed);
  const { run, pause, resume, reset, setSpeed } = useSim.getState();
  const select = useUi((s) => s.select);
  const [trafficOpen, setTrafficOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const seconds = Math.floor(simTimeMs / 1000);
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-2.5 border-b border-line bg-panel px-4">
      <a href="/" className="flex items-center gap-2" aria-label="ScaleLab home">
        <span className="h-7 w-7 rounded-lg" style={{ background: 'linear-gradient(135deg,#6d5efc,#20c4a8)' }} />
        <span className="text-[15px] font-bold tracking-tight">ScaleLab</span>
      </a>
      <span className="text-faint">/</span>
      <div className="relative">
        <input
          value={name}
          onChange={(e) => renameDesign(e.target.value)}
          aria-label="Design name"
          className="w-40 rounded bg-transparent px-1 text-[14px] outline-none focus:bg-bg"
        />
      </div>
      <div className="relative">
        <button onClick={() => setMenuOpen((o) => !o)} className="px-1 text-faint hover:text-ink" aria-label="Design menu">
          ▾
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-8 z-50 w-56 rounded-xl border border-line-strong bg-panel p-1 shadow-2xl">
            <button
              className="w-full rounded-md px-3 py-2 text-left text-[13px] hover:bg-raised"
              onClick={() => {
                setMenuOpen(false);
                useImport.getState().show();
              }}
            >
              Import your project…
            </button>
            <a href="/interview" className="block w-full rounded-md px-3 py-2 text-left text-[13px] hover:bg-raised">
              Practice interviews…
            </a>
            <div className="my-1 h-px bg-line" />
            <button
              className="w-full rounded-md px-3 py-2 text-left text-[13px] hover:bg-raised"
              onClick={() => {
                reset();
                select(undefined);
                loadDesign(shopSphere());
                useUi.getState().requestFit();
                setMenuOpen(false);
              }}
            >
              Load ShopSphere example
            </button>
            <button
              className="w-full rounded-md px-3 py-2 text-left text-[13px] hover:bg-raised"
              onClick={() => {
                reset();
                select(undefined);
                loadDesign(microShop());
                useUi.getState().requestFit();
                setMenuOpen(false);
              }}
            >
              Load microservices example
            </button>
            <button
              className="w-full rounded-md px-3 py-2 text-left text-[13px] hover:bg-raised"
              onClick={() => {
                reset();
                select(undefined);
                loadDesign(checkoutShop());
                useUi.getState().requestFit();
                setMenuOpen(false);
                useJourneys.getState().show('list');
              }}
            >
              Load checkout example
            </button>
            <button
              className="w-full rounded-md px-3 py-2 text-left text-[13px] hover:bg-raised"
              onClick={() => {
                reset();
                select(undefined);
                clearDesign();
                setMenuOpen(false);
              }}
            >
              Start from scratch
            </button>
          </div>
        )}
      </div>
      {status !== 'idle' && (
        <span
          className={`rounded-md px-2 py-0.5 font-mono text-[11px] ${
            status === 'running' ? 'bg-[#1d2a22] text-ok' : status === 'paused' ? 'bg-raised text-warn' : 'bg-raised text-muted'
          }`}
        >
          ● {status === 'running' ? 'Simulating' : status === 'paused' ? 'Paused' : 'Finished'} · {clock}
        </span>
      )}

      <div className="flex-1" />

      {status === 'running' ? (
        <button onClick={pause} className={btn}>
          ❚❚ Pause
        </button>
      ) : status === 'paused' ? (
        <button onClick={resume} className={primary}>
          ▶ Resume
        </button>
      ) : (
        <button onClick={() => run()} className={primary}>
          ▶ Run
        </button>
      )}
      <button onClick={reset} disabled={status === 'idle'} className={btn} aria-label="Reset simulation" title="Reset">
        ↺
      </button>
      <label className={`${btn} pr-1`}>
        <span className="text-muted">Speed</span>
        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="bg-transparent text-ink outline-none"
          aria-label="Simulation speed"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s} className="bg-panel">
              {s}x
            </option>
          ))}
        </select>
      </label>
      <div className="relative">
        <button onClick={() => setTrafficOpen((o) => !o)} className={btn}>
          <span className="text-muted">Traffic</span> {trafficLabel(traffic)} ▾
        </button>
        {trafficOpen && <TrafficPopover onClose={() => setTrafficOpen(false)} />}
      </div>
      <div className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
      <button onClick={() => useImport.getState().show()} className={btn} title="Draw your architecture from a GitHub repo or a folder">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
        Import
      </button>
      <button onClick={() => useJourneys.getState().show('list')} className={btn} title="Send users through your system step by step">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="5" cy="6" r="2" />
          <circle cx="19" cy="18" r="2" />
          <path d="M7 6h8a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h8" />
        </svg>
        Journeys
      </button>
      <button onClick={() => usePlan.getState().show()} className={btn} title="Find the cheapest setup that meets your targets">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 3v18h18" />
          <path d="m7 15 4-4 3 3 5-6" />
        </svg>
        Plan capacity
      </button>
      <ShareButton className={btn} />
    </header>
  );
}
