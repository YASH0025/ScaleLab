import { check } from '../checks';
import { referenceDesign } from '../reference';
import type { Problem } from '../types';

export const instagram: Problem = {
  id: 'instagram',
  title: 'Photo sharing',
  tagline: 'Like Instagram',
  difficulty: 'Medium',
  minutes: 45,
  brief:
    'Design a photo-sharing app. People upload photos, follow others, and scroll a feed of photos from the people they follow. Photos are viewed far more often than they are posted.',
  functional: ['Upload a photo with a caption', 'Follow other users', 'See a feed of recent photos from people you follow', 'Open any photo quickly, in several sizes'],
  nonFunctional: ['Feed and photos load in under 300 ms (p95)', 'Uploads never lose a photo', 'Highly available; a slightly stale feed is fine'],
  scale: ['2 million daily active users', 'Each views about 50 photos a day', '1 in 5 users posts a photo each day, about 2 MB each', 'Peak traffic is 3× the average'],
  estimates: [
    { id: 'views', question: 'Photo views per second (average)', unit: 'per second', answer: 1160, working: '2 M × 50 = 100 M views a day ÷ 86,400 s ≈ 1,160 per second.' },
    { id: 'uploads', question: 'New photos per day', unit: 'per day', answer: 400000, working: '2 M × 1/5 = 400,000 photos a day.' },
    { id: 'storage', question: 'New storage per day', unit: 'GB', answer: 800, working: '400,000 × 2 MB = 800 GB a day (more with resized copies).' },
    { id: 'peak', question: 'Peak photo views per second', unit: 'per second', answer: 3500, working: '1,160 × 3 ≈ 3,500 per second.' },
  ],
  targets: { peakRps: 4000, writeShare: 0.02, p95Ms: 300, maxErrorRate: 0.001 },
  checks: [
    check.entry(),
    check.redundant(),
    check.media({ why: 'Photos are most of the traffic and bytes; serve them from S3 through a CDN, never through your API.' }),
    check.cache({ why: 'Feeds are read constantly; caching them keeps the database from carrying every scroll.' }),
    check.replicated({ why: 'Feeds read heavily from the metadata database; replicas share that load and stand by for failover.' }),
    check.async({ label: 'Resized copies are made in the background', why: 'Making thumbnails takes seconds; uploads should return immediately.' }),
    check.sharded({ kind: 'nice', why: 'Billions of photo records eventually outgrow one database.' }),
    check.dns(),
    check.monitoring(),
  ],
  followUps: [
    {
      question: 'How is the feed built?',
      answer:
        'Fan-out on write: when someone posts, a background job adds the photo ID to each follower’s feed list in Redis, so opening the feed is one cache read. For accounts with millions of followers, skip the fan-out and merge their recent posts in at read time.',
      concepts: ['fan-out', 'hot-keys'],
    },
    {
      question: 'How should uploads work?',
      answer:
        'The app asks the API for a pre-signed S3 URL, uploads straight to S3, then tells the API the upload finished. Large files never pass through your servers. A queue then triggers workers that make thumbnails and medium sizes.',
      concepts: ['object-storage', 'async', 'api-design'],
    },
    {
      question: 'Likes counts are updated thousands of times a second on a viral photo. How?',
      answer:
        'Don’t update one row per like. Count in Redis (or sharded counters) and write totals to the database periodically. The count can be eventually consistent; nobody needs it exact to the second.',
      concepts: ['consistency', 'hot-keys'],
    },
    {
      question: 'Do you call the login provider on every request?',
      answer:
        'No. Users log in once through the provider (Auth0, Cognito) and get a signed token (JWT). Each service checks the token’s signature locally in microseconds; it only calls the provider to log in or refresh. Calling it per request would add its latency and its failures to every request.',
      concepts: ['security', 'latency'],
    },
  ],
  concepts: ['requirements', 'estimation', 'object-storage', 'cdn', 'caching', 'replication', 'sharding', 'async', 'fan-out', 'hot-keys', 'consistency', 'api-design', 'load-balancing', 'redundancy', 'dns', 'observability', 'security', 'latency', 'failover', 'cost', 'horizontal-scaling'],
  reference: () =>
    referenceDesign(
      'Photo sharing',
      [
        { id: 'users', tech: 'mobile-app', label: 'App users' },
        { id: 'dns', tech: 'aws-route53', label: 'DNS' },
        { id: 'cdn', tech: 'aws-cloudfront', label: 'Photo CDN', config: { hitRatio: 0.92 } },
        { id: 'photos', tech: 'aws-s3', label: 'Photos' },
        { id: 'lb', tech: 'aws-alb', label: 'Load balancer' },
        { id: 'api', tech: 'spring-boot', label: 'Feed and post API', config: { instances: 3 } },
        { id: 'cache', tech: 'redis', label: 'Feed cache', config: { hitRatio: 0.9 } },
        { id: 'db', tech: 'postgresql', label: 'Metadata DB', config: { readReplicas: 2, shards: 2 } },
        { id: 'queue', tech: 'aws-sqs', label: 'Resize jobs' },
        { id: 'resizer', tech: 'background-worker', label: 'Image resizer', config: { instances: 3 } },
        { id: 'metrics', tech: 'datadog', label: 'Monitoring' },
      ],
      [
        ['users', 'dns'],
        ['dns', 'cdn'],
        ['cdn', 'photos'],
        ['dns', 'lb'],
        ['lb', 'api'],
        ['api', 'cache'],
        ['api', 'db'],
        ['api', 'queue'],
        ['queue', 'resizer'],
        ['resizer', 'photos'],
        ['resizer', 'db'],
        ['api', 'metrics'],
      ],
    ),
  referenceNotes: [
    'Photos are served from S3 through CloudFront; over 90% are edge hits.',
    'The API serves feeds from Redis and keeps metadata in PostgreSQL, split into 2 shards with 2 replicas each.',
    'Uploads queue a resize job; workers write the smaller sizes back to S3.',
  ],
  api: ['POST /photos/upload-url → { uploadUrl, photoId }', 'POST /photos/{id}/publish { caption }', 'GET /feed?cursor= → { photos[], nextCursor }', 'POST /users/{id}/follow'],
  dataModel: ['photos(id PK, user_id, s3_key, caption, created_at) sharded by user_id', 'follows(follower_id, followee_id)', 'Redis: feed:{userId} → recent photo IDs'],
};
