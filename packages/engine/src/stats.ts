/** Percentile (0..100) of an already sorted array, using nearest-rank. */
export function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

export function summarize(values: number[]): { p50: number; p95: number; p99: number; mean: number } {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, mean: 0 };
  const sorted = Float64Array.from(values).sort();
  const arr = Array.from(sorted);
  let sum = 0;
  for (const v of arr) sum += v;
  return {
    p50: percentileSorted(arr, 50),
    p95: percentileSorted(arr, 95),
    p99: percentileSorted(arr, 99),
    mean: sum / arr.length,
  };
}

export const round = (n: number, digits = 1): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
