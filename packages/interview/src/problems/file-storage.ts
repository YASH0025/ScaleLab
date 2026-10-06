import { check } from '../checks';
import { referenceDesign } from '../reference';
import type { Problem } from '../types';

export const fileStorage: Problem = {
  id: 'file-storage',
  title: 'File storage and sync',
  tagline: 'Like Dropbox or Google Drive',
  difficulty: 'Hard',
  minutes: 45,
  brief:
    'Design a service that stores people’s files and keeps them in sync across their devices. Edit a file on your laptop and it updates on your phone moments later.',
  functional: ['Upload and download files of any size', 'Sync changes to every device of the user', 'Folders, sharing and version history', 'Works with flaky connections'],
  nonFunctional: ['File metadata operations under 400 ms (p95)', 'Never lose a file (11 nines of durability)', 'Other devices learn about a change within seconds'],
  scale: ['50 million users, 10 million daily active', '2 files changed per active user per day', 'Users store 2 GB on average', 'Peak is 3× the average'],
  estimates: [
    { id: 'changes', question: 'File changes per second (average)', unit: 'per second', answer: 230, working: '10 M × 2 = 20 M a day ÷ 86,400 ≈ 230 per second.' },
    { id: 'storage', question: 'Total storage', unit: 'TB', answer: 100000, working: '50 M users × 2 GB = 100 PB = 100,000 TB (before dedupe).' },
    { id: 'notifications', question: 'Sync notifications per second (3 devices each)', unit: 'per second', answer: 700, working: '230 changes × 3 devices ≈ 700 per second.' },
  ],
  targets: { peakRps: 2500, writeShare: 0.3, p95Ms: 400, maxErrorRate: 0.001 },
  checks: [
    check.usersReach(['object-storage'], {
      id: 'direct-upload',
      label: 'Files go straight to object storage',
      concepts: ['object-storage'],
      why: 'Gigabytes per file must not flow through your servers; clients upload and download S3 directly with pre-signed URLs.',
      fix: 'Connect users directly to AWS S3.',
    }),
    check.entry(),
    check.redundant(),
    check.sharded({ why: 'Metadata for billions of files is too much for one database; shard by user.' }),
    check.replicated({ why: 'Losing file metadata means losing the files, even if the bytes are still in S3.' }),
    check.usersReach(['realtime-server'], {
      id: 'sync-push',
      label: 'Devices hear about changes over a live connection',
      concepts: ['realtime'],
      why: 'Polling every few seconds from 10 million devices is wasteful; a WebSocket lets the server push “file changed”.',
      fix: 'Connect users to a WebSocket server for sync notifications.',
    }),
    check.async({ label: 'Changes are published to background consumers', concepts: ['async', 'pub-sub'], why: 'Sync, thumbnails, search indexing and virus scanning react to changes without slowing the upload.' }),
    check.cache({ kind: 'nice', why: 'Folder listings are read far more than they change.' }),
    check.monitoring(),
  ],
  followUps: [
    {
      question: 'A user edits one paragraph of a 1 GB file. What gets uploaded?',
      answer:
        'Split files into chunks (say 4 MB) identified by their content hash. Only chunks whose hash changed are uploaded; the file’s metadata is a list of chunk hashes. Identical chunks across users are stored once (deduplication).',
      concepts: ['object-storage', 'data-model'],
    },
    {
      question: 'Two devices edit the same file offline. What happens?',
      answer:
        'Each change carries the version it was based on. The first to sync wins; the second is a conflict, saved as a “conflicted copy” for the user to resolve, rather than silently overwritten.',
      concepts: ['consistency'],
    },
    {
      question: 'Which data needs strong consistency?',
      answer:
        'Metadata (which chunks make up which version of which file) must be strongly consistent and transactional; the chunk bytes are immutable once written, so they can live in eventually consistent storage safely.',
      concepts: ['consistency', 'transactions'],
    },
  ],
  concepts: ['requirements', 'estimation', 'object-storage', 'sharding', 'replication', 'realtime', 'async', 'pub-sub', 'caching', 'data-model', 'consistency', 'transactions', 'load-balancing', 'redundancy', 'observability', 'latency', 'failover', 'cost', 'horizontal-scaling'],
  reference: () =>
    referenceDesign(
      'File storage and sync',
      [
        { id: 'devices', tech: 'web-browser', label: 'Devices' },
        { id: 'files', tech: 'aws-s3', label: 'File chunks' },
        { id: 'lb', tech: 'aws-alb', label: 'Load balancer' },
        { id: 'meta', tech: 'spring-boot', label: 'Metadata service', config: { instances: 3 } },
        { id: 'cache', tech: 'redis', label: 'Folder cache', config: { hitRatio: 0.8 } },
        { id: 'db', tech: 'postgresql', label: 'File metadata', config: { readReplicas: 1, shards: 4 } },
        { id: 'changes', tech: 'kafka', label: 'File changes' },
        { id: 'notifier', tech: 'kafka-consumer', label: 'Sync notifier', config: { instances: 3 } },
        { id: 'sync', tech: 'websocket-server', label: 'Sync servers', config: { instances: 3 } },
        { id: 'presence', tech: 'redis', label: 'Device sessions', config: { hitRatio: 0.95 } },
        { id: 'metrics', tech: 'prometheus', label: 'Monitoring' },
      ],
      [
        ['devices', 'files'],
        ['devices', 'lb'],
        ['lb', 'meta'],
        ['lb', 'sync'],
        ['meta', 'cache'],
        ['meta', 'db'],
        ['meta', 'changes'],
        ['changes', 'notifier'],
        ['notifier', 'presence'],
        ['sync', 'presence'],
        ['meta', 'metrics'],
      ],
    ),
  referenceNotes: [
    'Devices upload and download chunks straight from S3; only metadata goes through the service.',
    'Metadata lives in PostgreSQL, sharded by user, with a replica per shard.',
    'Each change is published to Kafka; a notifier marks it for the user’s devices, and sync servers push it over WebSockets.',
  ],
  api: ['POST /files/{id}/upload-urls { chunkHashes[] } → { missingChunks: url[] }', 'POST /files/{id}/commit { version, chunkHashes[] }', 'GET /changes?since={cursor}', 'WebSocket: { type: "changed", fileId }'],
  dataModel: ['files(id PK, owner_id, path, latest_version) sharded by owner_id', 'versions(file_id, version, chunk_hashes[])', 'S3: chunks/{sha256}'],
};
