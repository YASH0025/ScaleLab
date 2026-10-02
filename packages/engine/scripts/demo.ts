/**
 * Headless demo: runs the ShopSphere launch-day ramp (500 → 5,000 rps over 60 s)
 * with and without Redis, and prints what happens second by second.
 *
 *   pnpm --filter @scalelab/engine demo
 */
import { getLibrary } from '@scalelab/catalog';
import { shopSphere } from '@scalelab/templates';
import { type EngineMetricsSample, simulate } from '../src';

const libraryEffect = (id: string) => getLibrary(id)?.effect;

const pct = (n: number | undefined) => `${Math.round((n ?? 0) * 100)}%`.padStart(5);
const num = (n: number, w = 7) => Math.round(n).toLocaleString('en-US').padStart(w);

function row(s: EngineMetricsSample): string {
  const node = (id: string) => s.nodes.find((n) => n.nodeId === id);
  const db = node('postgres');
  const flag = (db?.utilization ?? 0) > 0.9 ? '  ← PostgreSQL saturated' : '';
  return [
    String(s.simTimeSec).padStart(4),
    num(s.offeredRps),
    num(s.throughputRps),
    `${num(s.p95Ms, 6)} ms`,
    pct(s.errorRate),
    pct(node('api')?.utilization),
    pct(db?.utilization),
    num(db?.queueLength ?? 0, 5),
    node('redis') ? pct(node('redis')?.observedHitRatio) : '    -',
  ].join(' │') + flag;
}

for (const cache of [false, true]) {
  const design = shopSphere({ cache });
  const result = simulate(design, design.workloads[0]!, { libraryEffect });
  const t = result.totals;

  console.log(`\n${cache ? 'WITH' : 'WITHOUT'} Redis — ShopSphere, launch-day ramp 500 → 5,000 rps (modeled)\n`);
  console.log('   s │ offered │ served  │  p95      │ errs │ API  │  DB  │ DB q  │ hit');
  console.log('─────┼─────────┼─────────┼───────────┼──────┼──────┼──────┼───────┼─────');
  for (const s of result.timeline) {
    if (s.simTimeSec % 5 === 0 && s.simTimeSec <= 60) console.log(row(s));
  }
  console.log(
    `\n  ${t.arrivals.toLocaleString()} requests · ${t.completed.toLocaleString()} served · ` +
      `${(t.errorRate * 100).toFixed(1)}% failed · p95 ${t.p95Ms} ms · peak ${t.peakThroughputRps.toLocaleString()} rps`,
  );
}
