'use client';

import { CONCEPTS, type ConceptArea, PROBLEMS } from '@scalelab/interview';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { bestScores } from '@/store/use-interview';

const AREAS: ConceptArea[] = ['Foundations', 'Scaling', 'Data', 'Async and real-time', 'Reliability', 'Operations'];
const DIFFICULTY_TONE = { Easy: 'border-ok/40 text-ok', Medium: 'border-warn/40 text-warn', Hard: 'border-bad/40 text-bad-soft' } as const;
const CHECKED_LABEL = { design: 'on your canvas', simulation: 'by simulation', estimation: 'in your estimates', discussion: 'in follow-ups' } as const;

function scoreTone(score: number) {
  return score >= 85 ? 'bg-ok/15 text-ok' : score >= 50 ? 'bg-warn/15 text-warn' : 'bg-bad/15 text-bad-soft';
}

/** Practice problems and the concept library behind them. */
export function InterviewHome() {
  const [tab, setTab] = useState<'problems' | 'concepts'>('problems');
  const [best, setBest] = useState<Record<string, number>>({});
  const [openConcept, setOpenConcept] = useState<string | undefined>();
  useEffect(() => setBest(bestScores()), []);

  const practicedBy = useMemo(() => {
    const map = new Map<string, Array<{ id: string; title: string }>>();
    for (const p of PROBLEMS) for (const c of p.concepts) map.set(c, [...(map.get(c) ?? []), { id: p.id, title: p.title }]);
    return map;
  }, []);
  const solved = PROBLEMS.filter((p) => (best[p.id] ?? 0) >= 85).length;

  return (
    <main className="relative min-h-screen">
      <div aria-hidden="true" className="absolute inset-0 opacity-50" style={{ backgroundImage: 'radial-gradient(#1d2331 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
      <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-8">
        <nav className="flex items-center gap-2">
          <Link href="/" className="flex items-center gap-2">
            <span className="h-8 w-8 rounded-lg" style={{ background: 'linear-gradient(135deg,#6d5efc,#20c4a8)' }} />
            <span className="text-[17px] font-bold tracking-tight">ScaleLab</span>
          </Link>
          <span className="text-faint">/</span>
          <span className="text-[15px] text-muted">Interview practice</span>
          <Link href="/play" className="ml-auto rounded-full border border-line-strong px-3 py-1 text-[12px] text-muted hover:text-ink">
            Open the playground
          </Link>
        </nav>

        <header className="mt-14 max-w-3xl">
          <h1 className="text-[40px] font-bold leading-[1.1] tracking-tight">
            Practice system design interviews <span className="text-accent-soft">against a real simulation.</span>
          </h1>
          <p className="mt-4 text-[16px] leading-relaxed text-muted">
            Pick a classic problem, estimate the scale, design it on the canvas, and submit. ScaleLab sends the problem’s peak traffic through your
            design, breaks servers and caches, prices it, and reviews it the way an interviewer would, with the evidence.
          </p>
          <p className="mt-3 text-[13px] text-faint">
            {PROBLEMS.length} problems · {CONCEPTS.length} concepts · {solved > 0 ? `${solved} solved with a strong hire` : 'free, no login'}
          </p>
        </header>

        <div className="mt-10 inline-grid grid-cols-2 gap-1 rounded-xl bg-panel p-1" role="tablist">
          {(['problems', 'concepts'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-5 py-1.5 text-[13px] capitalize ${tab === t ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'problems' ? (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PROBLEMS.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/play?interview=${p.id}`}
                  className="group flex h-full flex-col rounded-2xl border border-line bg-panel/90 p-5 transition-colors hover:border-accent/60"
                >
                  <div className="flex items-center gap-2 text-[11.5px]">
                    <span className={`rounded-full border px-2 py-0.5 font-medium ${DIFFICULTY_TONE[p.difficulty]}`}>{p.difficulty}</span>
                    <span className="text-faint">{p.minutes} min</span>
                    {best[p.id] !== undefined && (
                      <span className={`ml-auto rounded-full px-2 py-0.5 font-mono font-semibold ${scoreTone(best[p.id]!)}`} title="Your best score">
                        {best[p.id]}
                      </span>
                    )}
                  </div>
                  <h2 className="mt-3 text-[17px] font-semibold group-hover:text-accent-soft">{p.title}</h2>
                  <p className="text-[13px] text-muted">{p.tagline}</p>
                  <p className="mt-2 line-clamp-3 text-[12.5px] leading-relaxed text-faint">{p.brief}</p>
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
                    {p.concepts
                      .filter((c) => !['requirements', 'estimation', 'latency', 'failover', 'cost', 'observability', 'load-balancing', 'redundancy', 'horizontal-scaling'].includes(c))
                      .slice(0, 5)
                      .map((c) => (
                        <span key={c} className="rounded-full bg-raised px-2 py-0.5 text-[11px] text-muted">
                          {CONCEPTS.find((x) => x.id === c)?.name.split(' and ')[0] ?? c}
                        </span>
                      ))}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-6 space-y-8">
            {AREAS.map((area) => (
              <section key={area}>
                <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-faint">{area}</h2>
                <ul className="mt-3 grid gap-3 md:grid-cols-2">
                  {CONCEPTS.filter((c) => c.area === area).map((c) => {
                    const open = openConcept === c.id;
                    const problems = practicedBy.get(c.id) ?? [];
                    return (
                      <li key={c.id} className="rounded-xl border border-line bg-panel/90">
                        <button onClick={() => setOpenConcept(open ? undefined : c.id)} aria-expanded={open} className="w-full px-4 py-3 text-left">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-[14px] font-semibold">{c.name}</span>
                            <span className="shrink-0 text-[11px] text-faint">{problems.length} problems</span>
                          </div>
                          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{c.summary}</p>
                        </button>
                        {open && (
                          <div className="border-t border-line px-4 py-3 text-[12.5px] leading-relaxed">
                            <p>{c.explain}</p>
                            {c.onCanvas && (
                              <p className="mt-2 text-muted">
                                <span className="font-medium text-ink">On the canvas: </span>
                                {c.onCanvas}
                              </p>
                            )}
                            <p className="mt-2 text-faint">Checked {c.checkedBy.map((k) => CHECKED_LABEL[k]).join(', ')}.</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {problems.map((p) => (
                                <Link key={p.id} href={`/play?interview=${p.id}`} className="rounded-full border border-line-strong px-2.5 py-0.5 text-[11.5px] hover:border-accent/60 hover:text-accent-soft">
                                  {p.title}
                                </Link>
                              ))}
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
