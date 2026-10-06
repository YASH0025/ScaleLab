import { check } from '../checks';
import { QUEUES } from '../graph';
import { referenceDesign } from '../reference';
import type { Problem } from '../types';

export const newsFeed: Problem = {
  id: 'news-feed',
  title: 'News feed',
  tagline: 'Like Twitter / X',
  difficulty: 'Hard',
  minutes: 45,
  brief:
    'Design the home timeline of a Twitter-like app. People post short updates and follow others; opening the app shows the latest posts from everyone they follow, newest first.',
  functional: ['Post a short update (up to 280 characters)', 'Follow and unfollow people', 'Home timeline: recent posts from people you follow', 'Search posts (nice to have)'],
  nonFunctional: ['Timeline loads in under 300 ms (p95)', 'A new post shows up in followers’ timelines within a few seconds', 'Highly available; timelines may be slightly stale'],
  scale: ['5 million daily active users', 'Each opens the timeline 10 times a day', '1 post per user per day on average', 'Each user has 200 followers on average', 'Posts are about 300 bytes'],
  estimates: [
    { id: 'reads', question: 'Timeline reads per second (average)', unit: 'per second', answer: 580, working: '5 M × 10 = 50 M a day ÷ 86,400 ≈ 580 per second.' },
    { id: 'posts', question: 'New posts per second (average)', unit: 'per second', answer: 58, working: '5 M posts a day ÷ 86,400 ≈ 58 per second.' },
    { id: 'fanout', question: 'Timeline inserts per second with fan-out on write', unit: 'per second', answer: 11600, working: '58 posts × 200 followers ≈ 11,600 inserts per second.' },
    { id: 'storage', question: 'Post storage per year', unit: 'GB', answer: 550, working: '5 M × 365 × 300 bytes ≈ 550 GB.' },
  ],
  targets: { peakRps: 2000, writeShare: 0.05, p95Ms: 300, maxErrorRate: 0.001 },
  checks: [
    check.entry(),
    check.redundant(),
    check.cache({ label: 'Timelines are read from a cache', why: 'Building a timeline from scratch means querying 200 people’s posts; reading a precomputed list from Redis is one lookup.' }),
    check.stream({ label: 'New posts fan out through an event stream', why: 'Pushing a post into 200 timelines must not make the poster wait; a stream lets workers do it in the background.' }),
    {
      id: 'fanout-to-cache',
      label: 'Fan-out workers write timelines into the cache',
      kind: 'must',
      concepts: ['fan-out', 'caching'],
      why: 'That’s what makes reading a timeline a single cache lookup.',
      fix: 'Connect the consumer of the stream to Redis.',
      test: (g) => g.of(...QUEUES).some((q) => g.targets(q.id).some((c) => g.targets(c.id).some((t) => t.archetype === 'cache'))),
    },
    check.sharded({ why: 'Hundreds of gigabytes of posts a year and constant writes outgrow one machine.' }),
    check.replicated({ why: 'Posts must survive losing a machine.' }),
    check.store(['search-engine'], {
      id: 'search',
      kind: 'nice',
      label: 'Posts are indexed for search',
      concepts: ['search'],
      why: 'Searching posts needs an inverted index, not a database scan.',
      fix: 'Add Elasticsearch, fed by a consumer of the post stream.',
    }),
    check.monitoring(),
  ],
  followUps: [
    {
      question: 'A celebrity with 50 million followers posts. What happens to fan-out on write?',
      answer:
        'That one post means 50 million timeline inserts, which floods the workers and delays everyone. Use a hybrid: fan out on write for normal users, but for celebrities store the post once and merge their recent posts into a timeline when it’s read.',
      concepts: ['fan-out', 'hot-keys'],
    },
    {
      question: 'How do you keep timelines in order across many servers?',
      answer:
        'Give posts time-sortable IDs (Snowflake: timestamp + machine + sequence) so sorting by ID is sorting by time, without a central counter.',
      concepts: ['id-generation'],
    },
    {
      question: 'How does paging through a timeline work?',
      answer:
        'Use a cursor (the last post ID seen) rather than page numbers; new posts arriving at the top don’t shift what the next page returns.',
      concepts: ['api-design'],
    },
    {
      question: 'Is it a problem if a follower sees a post 3 seconds late?',
      answer:
        'No; timelines are a classic place for eventual consistency. The poster should see their own post immediately (read-your-writes), which you can do by adding it to their own timeline synchronously.',
      concepts: ['consistency'],
    },
  ],
  concepts: ['requirements', 'estimation', 'caching', 'pub-sub', 'fan-out', 'sharding', 'nosql', 'replication', 'search', 'hot-keys', 'id-generation', 'api-design', 'consistency', 'load-balancing', 'redundancy', 'observability', 'latency', 'failover', 'cost', 'horizontal-scaling'],
  reference: () =>
    referenceDesign(
      'News feed',
      [
        { id: 'users', tech: 'mobile-app', label: 'App users' },
        { id: 'lb', tech: 'aws-alb', label: 'Load balancer' },
        { id: 'api', tech: 'spring-boot', label: 'Timeline and post API', config: { instances: 3 } },
        { id: 'timelines', tech: 'redis', label: 'Timeline cache', config: { hitRatio: 0.95 } },
        { id: 'posts', tech: 'cassandra', label: 'Posts' },
        { id: 'stream', tech: 'kafka', label: 'Post events', config: { partitions: 12 } },
        { id: 'fanout', tech: 'kafka-consumer', label: 'Fan-out workers', config: { instances: 3, workersPerInstance: 4 } },
        { id: 'indexer', tech: 'kafka-consumer', label: 'Search indexer', config: { instances: 2, workersPerInstance: 4 } },
        { id: 'search', tech: 'elasticsearch', label: 'Post search' },
        { id: 'metrics', tech: 'prometheus', label: 'Monitoring' },
      ],
      [
        ['users', 'lb'],
        ['lb', 'api'],
        ['api', 'timelines'],
        ['api', 'posts'],
        ['api', 'stream'],
        ['stream', 'fanout'],
        ['fanout', 'timelines'],
        ['stream', 'indexer'],
        ['indexer', 'search'],
        ['api', 'metrics'],
      ],
    ),
  referenceNotes: [
    'Reading a timeline is one Redis lookup; Cassandra holds the posts, partitioned and replicated.',
    'Posting writes once and publishes an event; fan-out workers push it into followers’ timelines in the background.',
    'A second consumer group indexes posts for search from the same stream.',
  ],
  api: ['POST /posts { text } → { id }', 'GET /timeline?cursor= → { posts[], nextCursor }', 'POST /users/{id}/follow', 'GET /search?q='],
  dataModel: ['posts(user_id, post_id, text, created_at) partitioned by user_id', 'follows(user_id, follower_id)', 'Redis: timeline:{userId} → latest 800 post IDs'],
};
