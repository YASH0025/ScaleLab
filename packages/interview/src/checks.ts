import {
  type Graph,
  cacheBeforeStore,
  cdnInFront,
  hasEntryPoint,
  mediaThroughCdn,
  monitored,
  queueToWorkers,
  rateLimited,
  servicesRedundant,
  storeReplicated,
  storeSharded,
  streamToConsumers,
  usesObjectStorage,
  usesStore,
  usesTech,
  usersReach,
} from './graph';
import type { Check } from './types';

type Opts = Partial<Pick<Check, 'id' | 'label' | 'kind' | 'why' | 'fix' | 'concepts'>>;

const make =
  (base: Omit<Check, 'kind'> & { kind?: Check['kind'] }) =>
  (opts: Opts = {}): Check => ({ kind: 'must', ...base, ...opts });

/**
 * Checks shared across problems. Each problem picks the ones it needs and rewrites
 * the "why" for its own story.
 */
export const check = {
  entry: make({
    id: 'entry',
    label: 'Traffic comes in through a load balancer or gateway',
    concepts: ['load-balancing'],
    why: 'One entry point spreads load across instances and routes around failed ones.',
    fix: 'Put an AWS ALB, Nginx or API Gateway between users and your services.',
    test: hasEntryPoint,
  }),
  redundant: make({
    id: 'redundant',
    label: 'Every service runs on at least two instances',
    concepts: ['horizontal-scaling', 'redundancy'],
    why: 'A single instance is a single point of failure, and one machine has a ceiling.',
    fix: 'Select each service and set Instances to 2 or more.',
    test: servicesRedundant,
  }),
  cache: make({
    id: 'cache',
    label: 'Reads go through a cache before the database',
    concepts: ['caching'],
    why: 'Reads far outnumber writes here; a cache keeps the database from carrying them all.',
    fix: 'Connect the service to Redis as well as its database.',
    test: cacheBeforeStore,
  }),
  replicated: make({
    id: 'replicated',
    label: 'The main database is replicated',
    concepts: ['replication', 'redundancy'],
    why: 'Replicas serve reads and take over if the primary fails.',
    fix: 'Set Read replicas to 1 or more, or use a store that replicates by design (Cassandra, DynamoDB).',
    test: storeReplicated,
  }),
  sharded: make({
    id: 'sharded',
    label: 'Data is partitioned across machines',
    concepts: ['sharding', 'consistent-hashing'],
    why: 'The data and write volume outgrow one machine.',
    fix: 'Set Shards to 2 or more on the database, or use Cassandra or DynamoDB.',
    test: storeSharded,
  }),
  cdn: make({
    id: 'cdn',
    label: 'A CDN serves cacheable content near users',
    concepts: ['cdn'],
    why: 'Edge hits never reach your servers, which cuts latency and absorbs spikes.',
    fix: 'Put CloudFront or Cloudflare between users and your entry point.',
    test: cdnInFront,
  }),
  media: make({
    id: 'media',
    label: 'Files live in object storage, served through a CDN',
    concepts: ['object-storage', 'cdn'],
    why: 'Big files don’t belong in a database, and serving them from the edge saves bandwidth and latency.',
    fix: 'Add AWS S3, and connect a CDN to it so users download through the CDN.',
    test: (g: Graph) => mediaThroughCdn(g),
  }),
  objectStorage: make({
    id: 'object-storage',
    label: 'Files are kept in object storage',
    concepts: ['object-storage'],
    why: 'Object storage is cheap and durable for large blobs; the database keeps only metadata.',
    fix: 'Add AWS S3 and connect the service (or users, with pre-signed URLs) to it.',
    test: usesObjectStorage,
  }),
  async: make({
    id: 'async',
    label: 'Slow work runs in the background through a queue',
    concepts: ['async'],
    why: 'Users shouldn’t wait for slow work, and a queue absorbs spikes.',
    fix: 'Connect the service to SQS or RabbitMQ, and the queue to a worker.',
    test: queueToWorkers,
  }),
  stream: make({
    id: 'stream',
    label: 'Events go through a stream to consumers',
    concepts: ['pub-sub'],
    why: 'One event can drive several independent consumers without the producer waiting.',
    fix: 'Connect the service to Kafka, and Kafka to a consumer.',
    test: streamToConsumers,
  }),
  rateLimit: make({
    id: 'rate-limit',
    label: 'A rate limit protects the way in',
    concepts: ['rate-limiting'],
    why: 'Spikes and abusive clients should get 429s, not take the system down.',
    fix: 'Add a Rate limiter or API Gateway on the way in and set its rate limit.',
    test: rateLimited,
  }),
  monitoring: make({
    id: 'monitoring',
    label: 'Services report to monitoring',
    kind: 'nice',
    concepts: ['observability'],
    why: 'You need to see latency, errors and saturation to know when it’s breaking.',
    fix: 'Connect your services to Prometheus or Datadog.',
    test: monitored,
  }),
  dns: make({
    id: 'dns',
    label: 'DNS routes users to the entry point',
    kind: 'nice',
    concepts: ['dns'],
    why: 'Managed DNS can route users to the nearest healthy region.',
    fix: 'Put Amazon Route 53 between users and your CDN or load balancer.',
    test: (g: Graph) => g.has('dns'),
  }),
  store: (archetypes: Parameters<typeof usesStore>[0], o: Opts & Pick<Check, 'id' | 'label' | 'why' | 'fix' | 'concepts'>): Check => ({
    kind: 'must',
    ...o,
    test: usesStore(archetypes),
  }),
  tech: (techIds: string[], o: Opts & Pick<Check, 'id' | 'label' | 'why' | 'fix' | 'concepts'>): Check => ({
    kind: 'must',
    ...o,
    test: usesTech(...techIds),
  }),
  usersReach: (archetypes: Parameters<typeof usersReach>[0], o: Opts & Pick<Check, 'id' | 'label' | 'why' | 'fix' | 'concepts'>): Check => ({
    kind: 'must',
    ...o,
    test: usersReach(archetypes),
  }),
};
