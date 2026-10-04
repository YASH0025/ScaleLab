import type { ArchNode, Journey } from '@scalelab/model';

/**
 * Exports journeys as a k6 load test, so the same journey that ran in ScaleLab
 * can run against the real system. Paths are placeholders built from service
 * names; the header comment tells people to replace them.
 */
export interface K6Options {
  journeys: Array<{ journey: Journey; usersPerSec: number }>;
  nodes: ArchNode[];
  durationSec: number;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'service';

/** A valid JavaScript identifier for the scenario function. */
export function functionName(name: string, used: Set<string>): string {
  const words = name.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  let base = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join('') || 'journey';
  if (/^[0-9]/.test(base)) base = `j${base}`;
  let fn = base;
  for (let i = 2; used.has(fn); i++) fn = `${base}${i}`;
  used.add(fn);
  return fn;
}

const str = (s: string) => JSON.stringify(s);

export function toK6(opts: K6Options): string {
  const label = new Map(opts.nodes.map((n) => [n.id, n.label]));
  const used = new Set<string>(['attempt', 'options']);
  const named = opts.journeys.map((j) => ({ ...j, fn: functionName(j.journey.name, used) }));

  const scenarios = named
    .map(
      ({ fn, usersPerSec }) => `    ${fn}: {
      executor: 'constant-arrival-rate',
      exec: ${str(fn)},
      rate: ${Math.max(1, Math.round(usersPerSec))},
      timeUnit: '1s',
      duration: '${opts.durationSec}s',
      preAllocatedVUs: ${Math.max(10, Math.round(usersPerSec * 5))},
      maxVUs: ${Math.max(100, Math.round(usersPerSec * 50))},
    },`,
    )
    .join('\n');

  const functions = named
    .map(({ journey, fn }) => {
      const body = journey.steps
        .map((step, i) => {
          const service = label.get(step.serviceNodeId) ?? step.serviceNodeId;
          const url = `\`\${BASE_URL}/${slug(service)}\``;
          const tags = `tags: { journey: ${str(journey.name)}, step: ${str(step.name)} }`;
          const lines = [`  // ${i + 1}. ${step.name}: ${step.operation} on ${service}`];
          let request: string;
          if (step.operation === 'read') {
            request = `http.get(${url}, { ${tags} })`;
          } else {
            const headers = step.idempotent
              ? `{ 'Content-Type': 'application/json', 'Idempotency-Key': key }`
              : `{ 'Content-Type': 'application/json' }`;
            if (step.idempotent) lines.push(`  // The same key on every retry, so the service can ignore repeats.`, `  const key = \`\${__VU}-\${__ITER}-${slug(step.id)}\`;`);
            request = `http.post(${url}, JSON.stringify({}), { headers: ${headers}, ${tags} })`;
          }
          if (step.idempotent && step.operation === 'write') {
            // Wrap in a block so each step's `key` stays local.
            return [`  {`, ...lines.map((l) => `  ${l}`), `    if (!attempt(${str(step.name)}, ${step.retries}, () => ${request})) return;`, `  }`, `  sleep(THINK_TIME);`].join('\n');
          }
          return [...lines, `  if (!attempt(${str(step.name)}, ${step.retries}, () => ${request})) return;`, `  sleep(THINK_TIME);`].join('\n');
        })
        .join('\n');
      return `export function ${fn}() {\n${body}\n}`;
    })
    .join('\n\n');

  return `// Exported from ScaleLab: ${named.map((n) => n.journey.name).join(', ')}
// Run with:  k6 run -e BASE_URL=https://staging.example.com journeys.js
//
// The URLs below are placeholders made from your service names.
// Replace them with your real endpoints (and request bodies) before running.

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const THINK_TIME = 1; // seconds between steps, like ScaleLab
const RETRY_BACKOFF = 0.5; // seconds between retries

export const options = {
  scenarios: {
${scenarios}
  },
  thresholds: {
    checks: ['rate>0.99'],
    http_req_duration: ['p(95)<1000'],
  },
};

/** Runs one step with retries. Returns false when the user gives up. */
function attempt(name, retries, send) {
  for (let i = 0; i <= retries; i++) {
    const res = send();
    if (check(res, { [\`\${name} succeeded\`]: (r) => r.status >= 200 && r.status < 300 })) return true;
    if (i < retries) sleep(RETRY_BACKOFF);
  }
  return false;
}

${functions}
`;
}
