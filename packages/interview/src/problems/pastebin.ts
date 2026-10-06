import { check } from '../checks';
import { cacheBeforeStore, cdnInFront } from '../graph';
import { referenceDesign } from '../reference';
import type { Problem } from '../types';

export const pastebin: Problem = {
  id: 'pastebin',
  title: 'Pastebin',
  tagline: 'Share text snippets by link',
  difficulty: 'Easy',
  minutes: 30,
  brief:
    'Design a service where people paste text (code, logs, notes), get a link, and share it. Pastes can expire. Each paste is written once and read many times.',
  functional: ['Create a paste (up to 1 MB) and get a link', 'Read a paste by its link', 'Pastes expire after a chosen time and are deleted'],
  nonFunctional: ['Reads in under 300 ms (p95)', 'Durable: a paste must not be lost before it expires', 'Expired pastes are cleaned up without slowing anything down'],
  scale: ['5 million new pastes a day, 10 KB on average', '10 reads for every paste', 'Pastes kept for a year at most', 'Peak traffic is 3× the average'],
  estimates: [
    { id: 'writes', question: 'New pastes per second (average)', unit: 'per second', answer: 58, working: '5,000,000 ÷ 86,400 s ≈ 58 per second.' },
    { id: 'reads', question: 'Reads per second (average)', unit: 'per second', answer: 580, working: '58 × 10 ≈ 580 per second.' },
    { id: 'storage', question: 'Storage for one year', unit: 'GB', answer: 18000, working: '5 M × 10 KB = 50 GB a day; × 365 ≈ 18 TB, about 18,000 GB.' },
  ],
  targets: { peakRps: 2000, writeShare: 0.09, p95Ms: 300, maxErrorRate: 0.001 },
  checks: [
    check.entry(),
    check.redundant(),
    check.objectStorage({ why: 'Paste bodies are blobs up to 1 MB; S3 stores them cheaply while the database keeps only metadata.' }),
    {
      id: 'reads-cached',
      label: 'Popular pastes are served from a cache or CDN',
      kind: 'must',
      concepts: ['caching', 'cdn'],
      why: 'Pastes never change once written, which makes them perfect to cache.',
      fix: 'Connect the service to Redis, or put a CDN in front.',
      test: (g) => cacheBeforeStore(g) || cdnInFront(g),
    },
    check.replicated({ why: 'Losing the metadata database would make every paste unreachable.' }),
    check.async({ kind: 'nice', label: 'Expired pastes are cleaned up in the background', why: 'Deleting millions of expired pastes shouldn’t compete with reads.' }),
    check.rateLimit({ kind: 'nice', why: 'Pastebins attract spam and abuse; limit how fast anyone can create pastes.' }),
    check.monitoring(),
  ],
  followUps: [
    {
      question: 'Why not store paste text in the database?',
      answer:
        'At 18 TB a year, rows full of large text bloat the database, slow backups and make replicas expensive. Object storage is far cheaper per GB and built for durability; the database keeps a small row (key, owner, size, expiry) pointing at the object.',
      concepts: ['object-storage', 'data-model'],
    },
    {
      question: 'How do expired pastes get deleted?',
      answer:
        'Three layers: treat a paste past its expiry as gone when read (lazy deletion), let S3 lifecycle rules delete old objects, and run a background job that finds expired rows in batches and removes them, off the request path.',
      concepts: ['async'],
    },
    {
      question: 'How do you create the paste keys?',
      answer:
        'A key-generation service can pre-create random unique keys and hand them out in batches, so creating a paste never waits on a uniqueness check. Base62 of a counter also works.',
      concepts: ['id-generation'],
    },
  ],
  concepts: ['requirements', 'estimation', 'object-storage', 'caching', 'cdn', 'replication', 'async', 'rate-limiting', 'id-generation', 'data-model', 'load-balancing', 'redundancy', 'latency', 'failover', 'cost', 'observability'],
  reference: () =>
    referenceDesign(
      'Pastebin',
      [
        { id: 'users', tech: 'web-browser', label: 'Users' },
        { id: 'cdn', tech: 'cloudflare-cdn', label: 'CDN', config: { hitRatio: 0.7 } },
        { id: 'lb', tech: 'aws-alb', label: 'Load balancer' },
        { id: 'api', tech: 'express', label: 'Paste service', config: { instances: 3 } },
        { id: 'cache', tech: 'redis', label: 'Paste cache', config: { hitRatio: 0.85 } },
        { id: 'db', tech: 'postgresql', label: 'Metadata DB', config: { readReplicas: 1 } },
        { id: 's3', tech: 'aws-s3', label: 'Paste store' },
        { id: 'queue', tech: 'aws-sqs', label: 'Expiry jobs' },
        { id: 'cleaner', tech: 'background-worker', label: 'Cleanup worker' },
        { id: 'metrics', tech: 'prometheus', label: 'Monitoring' },
      ],
      [
        ['users', 'cdn'],
        ['cdn', 'lb'],
        ['lb', 'api'],
        ['api', 'cache'],
        ['api', 'db'],
        ['api', 's3'],
        ['api', 'queue'],
        ['queue', 'cleaner'],
        ['cleaner', 'db'],
        ['api', 'metrics'],
      ],
    ),
  referenceNotes: [
    'A CDN and Redis serve most reads; pastes never change, so caching is safe.',
    'Paste bodies live in S3; PostgreSQL (with a replica) keeps only metadata.',
    'Each new paste schedules an expiry job; a worker deletes expired pastes off the request path.',
  ],
  api: ['POST /pastes { text, expiresIn } → { key, url }', 'GET /pastes/{key} → { text, createdAt, expiresAt }'],
  dataModel: ['pastes(key PK, s3_key, owner_id, size, created_at, expires_at)', 'S3 object: pastes/{key}'],
};
