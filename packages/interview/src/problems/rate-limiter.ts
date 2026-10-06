import { check } from '../checks';
import { SERVICES } from '../graph';
import { referenceDesign } from '../reference';
import type { Problem } from '../types';

export const rateLimiter: Problem = {
  id: 'rate-limiter',
  title: 'API rate limiter',
  tagline: 'Keep a public API up during a scraping attack',
  difficulty: 'Medium',
  minutes: 35,
  brief:
    'Your public API normally serves about 4,000 requests per second, which is what the backend is sized for. A scraper is now pushing traffic to 7,000 per second. Design rate limiting so normal users stay fast, the excess is turned away politely, and the backend never overloads.',
  functional: ['Limit each client (by API key or IP) to a number of requests per minute', 'Turn excess requests away with 429 Too Many Requests and a Retry-After header', 'Limits apply across every server, not per server'],
  nonFunctional: ['Requests that get through stay under 150 ms (p95)', 'The limiter adds only a few milliseconds', 'The backend never runs out of capacity'],
  scale: ['7,000 requests per second during the attack', 'Backend sized for about 4,500 per second', '10 million API keys', 'Each limit counter takes about 50 bytes'],
  estimates: [
    { id: 'excess', question: 'Requests per second to turn away at peak', unit: 'per second', answer: 2500, working: '7,000 arriving − 4,500 the backend can take ≈ 2,500 per second.' },
    { id: 'redis-ops', question: 'Counter updates per second in Redis', unit: 'per second', answer: 7000, working: 'One increment per arriving request: about 7,000 per second (Redis handles 100,000+).' },
    { id: 'memory', question: 'Memory for all counters', unit: 'MB', answer: 500, working: '10,000,000 keys × 50 bytes = 500 MB.' },
  ],
  targets: { peakRps: 7000, writeShare: 0, p95Ms: 150, maxErrorRate: 0.45 },
  checks: [
    check.rateLimit({ why: 'Without a limit, 7,000 requests a second hit a backend built for 4,500, and everyone gets slow.' }),
    check.entry(),
    check.redundant(),
    {
      id: 'shared-counters',
      label: 'Limit counters are shared in Redis',
      kind: 'must',
      concepts: ['caching', 'consistency'],
      why: 'With several servers, each one counting alone lets a client through several times its limit.',
      fix: 'Connect your API service to Redis, where counters live.',
      test: (g) => g.linked(SERVICES, ['cache']),
    },
    check.monitoring({ why: 'You need to see who is being limited and whether limits are set right.' }),
  ],
  simChecks: [
    {
      id: 'limited',
      label: 'Excess traffic was turned away with 429s',
      concepts: ['rate-limiting'],
      why: 'Turning the excess away is what keeps the backend healthy for everyone else.',
      fix: 'Set the rate limit near what the backend can carry (about 4,500 per second here).',
      test: (r) => r.totals.rejected / Math.max(1, r.totals.arrivals) >= 0.2,
    },
  ],
  followUps: [
    {
      question: 'Token bucket, fixed window or sliding window?',
      answer:
        'Fixed windows are simplest but let a burst of 2× through at the window edge. A sliding window log is exact but stores every timestamp. A sliding window counter approximates it cheaply. Token bucket allows short bursts up to the bucket size while holding the average rate, which is why most APIs use it.',
      concepts: ['rate-limiting'],
    },
    {
      question: 'Two servers increment the same counter at once. What goes wrong?',
      answer:
        'A read-then-write race lets extra requests through. Use an atomic Redis INCR with EXPIRE, or a small Lua script that checks and updates in one step.',
      concepts: ['consistency'],
    },
    {
      question: 'Redis goes down. Do you block everyone or let everyone through?',
      answer:
        'Usually fail open (let traffic through, with a local in-memory limit as a fallback) so a limiter outage doesn’t become a full outage; fail closed only for abuse-sensitive endpoints like login.',
      concepts: ['failover'],
    },
    {
      question: 'What should the client see?',
      answer:
        'HTTP 429 with Retry-After, plus X-RateLimit-Limit and X-RateLimit-Remaining headers so well-behaved clients slow down on their own.',
      concepts: ['api-design'],
    },
  ],
  concepts: ['requirements', 'estimation', 'rate-limiting', 'caching', 'consistency', 'failover', 'api-design', 'load-balancing', 'horizontal-scaling', 'redundancy', 'latency', 'observability', 'cost'],
  reference: () =>
    referenceDesign(
      'API rate limiter',
      [
        { id: 'clients', tech: 'web-browser', label: 'API clients' },
        { id: 'gw', tech: 'aws-api-gateway', label: 'API gateway', config: { rateLimitRps: 4500 } },
        { id: 'lb', tech: 'aws-alb', label: 'Load balancer' },
        { id: 'api', tech: 'express', label: 'API service', config: { instances: 3 } },
        { id: 'redis', tech: 'redis', label: 'Limit counters', config: { hitRatio: 0.95 } },
        { id: 'db', tech: 'postgresql', label: 'API data', config: { readReplicas: 1, connectionPool: 150 } },
        { id: 'metrics', tech: 'prometheus', label: 'Monitoring' },
      ],
      [
        ['clients', 'gw'],
        ['gw', 'lb'],
        ['lb', 'api'],
        ['api', 'redis'],
        ['api', 'db'],
        ['api', 'metrics'],
      ],
    ),
  referenceNotes: [
    'The gateway lets 4,500 requests per second through and answers the rest with 429.',
    'Counters live in Redis so every API instance enforces the same per-client limit.',
    'The backend runs well below capacity at the limit, so legitimate users stay fast.',
  ],
  api: ['Every response: X-RateLimit-Limit, X-RateLimit-Remaining', 'Over the limit: 429 Too Many Requests, Retry-After: 30'],
  dataModel: ['Redis: ratelimit:{apiKey}:{window} → count, with EXPIRE', 'limits(api_key PK, requests_per_minute, tier)'],
};
