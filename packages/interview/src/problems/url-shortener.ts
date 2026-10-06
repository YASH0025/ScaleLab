import { check } from '../checks';
import { referenceDesign } from '../reference';
import type { Problem } from '../types';

export const urlShortener: Problem = {
  id: 'url-shortener',
  title: 'URL shortener',
  tagline: 'Like bit.ly or TinyURL',
  difficulty: 'Easy',
  minutes: 30,
  brief:
    'Design a service that turns a long URL into a short link like sl.ink/x7Kp2a, and sends anyone who opens the short link to the original page. Links are created rarely and opened constantly.',
  functional: ['Create a short link for a long URL', 'Redirect a short link to its URL', 'Optional custom alias and expiry date'],
  nonFunctional: ['Redirects in under 200 ms (p95) at peak', 'Highly available: a broken link breaks someone else’s product', 'Short codes never collide'],
  scale: ['100 million redirects a day', '1 million new links a day (100 reads for every write)', 'Links kept for 5 years, about 500 bytes each', 'Peak traffic is 3× the average'],
  estimates: [
    { id: 'avg-reads', question: 'Average redirects per second', unit: 'per second', answer: 1160, working: '100,000,000 ÷ 86,400 s ≈ 1,160 per second.' },
    { id: 'peak-reads', question: 'Peak redirects per second', unit: 'per second', answer: 3500, working: '1,160 × 3 ≈ 3,500 per second.' },
    { id: 'writes', question: 'New links per second (average)', unit: 'per second', answer: 12, working: '1,000,000 ÷ 86,400 s ≈ 12 per second.' },
    { id: 'storage', question: 'Storage for 5 years', unit: 'GB', answer: 900, working: '1 M links/day × 365 × 5 × 500 bytes ≈ 0.9 TB, about 900 GB.' },
  ],
  targets: { peakRps: 3500, writeShare: 0.01, p95Ms: 200, maxErrorRate: 0.001 },
  checks: [
    check.entry(),
    check.redundant(),
    check.cache({ why: 'With 100 reads per write, a cache answers most redirects; popular links are opened over and over.' }),
    check.replicated({ why: 'If the only database dies, every short link on the internet that points at you breaks.' }),
    check.cdn({ kind: 'nice', why: 'Redirects for popular links can be cached at the edge and answered without touching your servers.' }),
    check.rateLimit({ kind: 'nice', why: 'Link creation is a favourite target for spammers; limit how fast anyone can create links.' }),
    check.monitoring(),
  ],
  followUps: [
    {
      question: 'How do you generate short codes that never collide?',
      answer:
        'Give each link a unique number and encode it in base62 (a–z, A–Z, 0–9): 7 characters cover 3.5 trillion links. The number can come from a database sequence, from ranges handed to each server in advance (so servers don’t coordinate per request), or a Snowflake-style ID. Hashing the URL and taking a prefix also works but needs a collision check and retry.',
      concepts: ['id-generation'],
    },
    {
      question: '301 or 302 redirect?',
      answer:
        'A 301 (permanent) lets browsers and CDNs cache the redirect, cutting load, but you stop seeing clicks. A 302 (temporary) sends every click through you, which you need for analytics and for links that can change or expire.',
      concepts: ['api-design', 'caching'],
    },
    {
      question: 'One link goes viral and gets 50,000 clicks a second. What happens?',
      answer:
        'It’s a hot key: one cache entry and one database row take the whole load. The cache absorbs it if every instance can read it; a CDN or a small in-process cache on each server takes it off the network entirely.',
      concepts: ['hot-keys', 'cdn'],
    },
    {
      question: 'SQL or NoSQL for the links table?',
      answer:
        'The access pattern is a single lookup by code, with no joins, so a key-value or wide-column store (DynamoDB, Cassandra) scales easily. PostgreSQL with replicas is also fine at this size and gives you a unique constraint on custom aliases for free.',
      concepts: ['data-model', 'nosql'],
    },
    {
      question: 'You promise 99.99% availability. What does that allow, and how do you get there?',
      answer:
        '99.99% allows about 4.3 minutes of downtime a month. Parts in a chain multiply (a load balancer, service and database at 99.99% each give about 99.97%), so every part needs redundancy: several instances, a database replica ready to take over, and ideally a second region behind DNS failover.',
      concepts: ['availability', 'redundancy', 'dns'],
    },
  ],
  concepts: ['requirements', 'estimation', 'load-balancing', 'horizontal-scaling', 'redundancy', 'caching', 'replication', 'cdn', 'rate-limiting', 'observability', 'id-generation', 'api-design', 'hot-keys', 'data-model', 'nosql', 'latency', 'failover', 'cost', 'availability', 'dns'],
  reference: () =>
    referenceDesign(
      'URL shortener',
      [
        { id: 'users', tech: 'web-browser', label: 'Users' },
        { id: 'cdn', tech: 'aws-cloudfront', label: 'CDN', config: { hitRatio: 0.5 } },
        { id: 'lb', tech: 'aws-alb', label: 'Load balancer' },
        { id: 'api', tech: 'go-gin', label: 'Shortener service', config: { instances: 3 } },
        { id: 'cache', tech: 'redis', label: 'Link cache', config: { hitRatio: 0.9 } },
        { id: 'db', tech: 'postgresql', label: 'Links DB', config: { readReplicas: 1 } },
        { id: 'metrics', tech: 'prometheus', label: 'Monitoring' },
      ],
      [
        ['users', 'cdn'],
        ['cdn', 'lb'],
        ['lb', 'api'],
        ['api', 'cache'],
        ['api', 'db'],
        ['api', 'metrics'],
      ],
    ),
  referenceNotes: [
    'A CDN answers redirects for popular links at the edge; the rest reach the service.',
    'Three stateless Go instances behind a load balancer; losing one barely matters.',
    'Redis holds hot links (about 90% of lookups hit), so PostgreSQL sees a small share of reads.',
    'One read replica gives a standby for failover and extra read capacity.',
  ],
  api: ['POST /links { url, alias?, expiresAt? } → { code, shortUrl }', 'GET /{code} → 302 Location: url', 'DELETE /links/{code}'],
  dataModel: ['links(code PK, url, owner_id, created_at, expires_at)', 'Cache: code → url, with a TTL'],
};
