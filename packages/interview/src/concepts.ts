/**
 * The system design topics interviews cover. Every concept is practiced by at least one
 * problem (a test checks this), and each says how ScaleLab checks it:
 * - design: looked for on your canvas
 * - simulation: proven by running your design under load or failure
 * - estimation: your back-of-the-envelope numbers
 * - discussion: a follow-up question with a model answer
 */

export type ConceptArea = 'Foundations' | 'Scaling' | 'Data' | 'Async and real-time' | 'Reliability' | 'Operations';
export type CheckedBy = 'design' | 'simulation' | 'estimation' | 'discussion';

export interface Concept {
  id: string;
  name: string;
  area: ConceptArea;
  /** One line. */
  summary: string;
  /** A few sentences in plain words. */
  explain: string;
  /** How to show it on the ScaleLab canvas, when it can be drawn. */
  onCanvas?: string;
  checkedBy: CheckedBy[];
}

export const CONCEPTS: Concept[] = [
  // ── Foundations ──
  {
    id: 'requirements',
    name: 'Requirements',
    area: 'Foundations',
    summary: 'Pin down what the system must do and how well, before drawing anything.',
    explain:
      'Functional requirements are the features (shorten a link, send a message). Non-functional requirements are the qualities: scale, latency, availability, consistency, cost. Interviewers expect you to ask about both first; they decide every later choice.',
    checkedBy: ['discussion'],
  },
  {
    id: 'estimation',
    name: 'Back-of-the-envelope estimation',
    area: 'Foundations',
    summary: 'Turn users into requests per second, storage and bandwidth with quick math.',
    explain:
      'Daily requests ÷ 86,400 seconds ≈ average requests per second; peak is often 2–5× the average. Storage = items per day × size × days kept. Round freely: being within 2× is what matters, because it tells you whether you need one server or a hundred.',
    checkedBy: ['estimation'],
  },
  {
    id: 'api-design',
    name: 'API design',
    area: 'Foundations',
    summary: 'Clear endpoints, pagination, and idempotent writes.',
    explain:
      'Sketch the main endpoints with their inputs and outputs. Use cursors for paging long lists, version the API, and make writes safe to retry with an idempotency key. REST is the default; gRPC suits service-to-service calls; WebSockets suit live updates.',
    checkedBy: ['discussion'],
  },
  {
    id: 'data-model',
    name: 'Data modeling and SQL vs NoSQL',
    area: 'Data',
    summary: 'Choose the store that fits the access pattern, not the trend.',
    explain:
      'Relational databases give joins, transactions and strong consistency. NoSQL stores trade some of that for simple key-based access at huge scale: documents (MongoDB), wide-column (Cassandra, DynamoDB), key-value (Redis). Start from the queries you must answer and pick the store that answers them cheaply.',
    onCanvas: 'Pick PostgreSQL, MongoDB, DynamoDB or Cassandra to match the data.',
    checkedBy: ['design', 'discussion'],
  },

  // ── Scaling ──
  {
    id: 'horizontal-scaling',
    name: 'Horizontal scaling and stateless services',
    area: 'Scaling',
    summary: 'Add more machines instead of bigger ones; keep servers stateless so any one can answer.',
    explain:
      'A stateless service keeps sessions and data elsewhere (a cache or database), so you can add or remove instances freely behind a load balancer. Vertical scaling (a bigger machine) is simpler but has a ceiling and a single point of failure.',
    onCanvas: 'Raise "Instances" on a service.',
    checkedBy: ['design', 'simulation'],
  },
  {
    id: 'load-balancing',
    name: 'Load balancing',
    area: 'Scaling',
    summary: 'Spread requests across instances and route around failed ones.',
    explain:
      'A load balancer sends each request to a healthy instance using round robin, least connections or a hash. It is also where TLS ends and health checks run. Layer 7 balancers can route by path (/api to one service, /images to another).',
    onCanvas: 'Put an AWS ALB, Nginx or HAProxy in front of your services.',
    checkedBy: ['design', 'simulation'],
  },
  {
    id: 'caching',
    name: 'Caching',
    area: 'Scaling',
    summary: 'Keep hot data in memory so most reads never reach the database.',
    explain:
      'Cache-aside is the common pattern: read the cache, on a miss read the database and fill the cache. Set a TTL, plan invalidation on writes, and watch the hit ratio: at 90% hits the database sees a tenth of the reads. A cache that goes down must not take the system with it.',
    onCanvas: 'Connect a service to Redis and its database; set the hit ratio.',
    checkedBy: ['design', 'simulation'],
  },
  {
    id: 'cdn',
    name: 'CDN and edge caching',
    area: 'Scaling',
    summary: 'Serve images, video and cacheable pages from servers near users.',
    explain:
      'A CDN keeps copies at edge locations worldwide. Hits are answered in milliseconds without touching your servers; only misses travel to the origin. It is the main tool for media-heavy apps and for absorbing traffic spikes.',
    onCanvas: 'Put CloudFront or Cloudflare between users and your entry point, or in front of S3.',
    checkedBy: ['design', 'simulation'],
  },
  {
    id: 'replication',
    name: 'Database replication and read replicas',
    area: 'Data',
    summary: 'Copy data to more machines to scale reads and survive failures.',
    explain:
      'A primary takes writes and streams them to replicas, which serve reads. Replicas add read capacity and a standby for failover, but they lag slightly behind: a read right after a write may see old data (replication lag).',
    onCanvas: 'Raise "Read replicas" on a database.',
    checkedBy: ['design', 'simulation'],
  },
  {
    id: 'sharding',
    name: 'Sharding and partitioning',
    area: 'Data',
    summary: 'Split data across machines by a key when one machine is not enough.',
    explain:
      'Each shard holds part of the data (users A–M on one, N–Z on another, or by hash). Writes and storage scale with shards. Choose the key so load spreads evenly and most queries hit one shard; consistent hashing lets you add shards without moving everything.',
    onCanvas: 'Raise "Shards" on a database, or use Cassandra or DynamoDB, which partition by design.',
    checkedBy: ['design', 'simulation'],
  },
  {
    id: 'consistent-hashing',
    name: 'Consistent hashing',
    area: 'Data',
    summary: 'Place keys on a ring so adding a node moves only a small share of them.',
    explain:
      'With plain hash(key) mod N, changing N moves almost every key. On a hash ring each node owns a range, and adding one only takes keys from its neighbours. Virtual nodes even out the load. Caches, Cassandra and DynamoDB use it.',
    checkedBy: ['discussion'],
  },
  {
    id: 'nosql',
    name: 'NoSQL stores',
    area: 'Data',
    summary: 'Document, wide-column and key-value stores for simple access at scale.',
    explain:
      'Wide-column stores like Cassandra take huge write volumes spread over many nodes; DynamoDB does the same as a managed service. Document stores like MongoDB keep flexible JSON records. They give up joins and multi-row transactions in exchange for scale.',
    onCanvas: 'Use MongoDB, DynamoDB or Cassandra.',
    checkedBy: ['design'],
  },
  {
    id: 'object-storage',
    name: 'Object storage',
    area: 'Data',
    summary: 'Keep files, images and video in S3, not in your database.',
    explain:
      'Object storage holds large blobs cheaply and durably. Store the file there and only its key and metadata in the database. Clients can upload and download directly with pre-signed URLs, so big files never pass through your servers.',
    onCanvas: 'Add AWS S3; connect users to it directly or through a CDN.',
    checkedBy: ['design', 'simulation'],
  },
  {
    id: 'search',
    name: 'Search indexes',
    area: 'Data',
    summary: 'Use an inverted index for full-text search and autocomplete.',
    explain:
      'A database LIKE query scans everything. A search engine like Elasticsearch keeps an inverted index (word → documents) and ranks results. Keep the database as the source of truth and feed changes into the index asynchronously.',
    onCanvas: 'Connect a service to Elasticsearch.',
    checkedBy: ['design', 'simulation'],
  },
  {
    id: 'vector-search',
    name: 'Vector search and RAG',
    area: 'Data',
    summary: 'Find similar items by meaning using embeddings.',
    explain:
      'Text, images or products become vectors (embeddings); a vector database returns the nearest ones. Retrieval-augmented generation (RAG) fetches relevant documents this way and gives them to an LLM, so answers are grounded in your data.',
    onCanvas: 'Connect a service to Pinecone.',
    checkedBy: ['design'],
  },
  {
    id: 'geo',
    name: 'Geospatial indexing',
    area: 'Data',
    summary: 'Find things near a location quickly with geohashes or quadtrees.',
    explain:
      'A geohash turns a location into a string where nearby places share a prefix; a quadtree splits the map into cells. Both turn "drivers within 2 km" into a fast lookup. Redis GEO and PostGIS provide this out of the box.',
    onCanvas: 'Keep live locations in Redis connected to the matching service.',
    checkedBy: ['design', 'discussion'],
  },
  {
    id: 'id-generation',
    name: 'Unique ID generation',
    area: 'Data',
    summary: 'Create unique, sortable IDs without one central counter.',
    explain:
      'Options: database sequences (simple, central), UUIDs (no coordination, not sortable), Snowflake-style IDs (time + machine + counter, sortable), or pre-allocated ranges per server. Short codes can be base62 of a number or a hash with collision checks.',
    checkedBy: ['discussion'],
  },
  {
    id: 'hot-keys',
    name: 'Hot keys and the celebrity problem',
    area: 'Data',
    summary: 'Plan for one key getting far more traffic than the rest.',
    explain:
      'A celebrity post or viral link can overload the one shard or cache node that holds it. Fixes: cache it widely, replicate hot keys, add a random suffix to spread writes, or treat celebrities differently (pull their posts at read time instead of pushing to millions of feeds).',
    checkedBy: ['discussion'],
  },

  // ── Async and real-time ──
  {
    id: 'async',
    name: 'Message queues and async processing',
    area: 'Async and real-time',
    summary: 'Accept the request fast and do slow work in the background.',
    explain:
      'The service puts a job on a queue (SQS, RabbitMQ) and answers right away; workers process jobs at their own pace. Queues absorb spikes, isolate slow dependencies and let you retry. The cost: the work finishes later, so the design must tolerate that delay.',
    onCanvas: 'Service → queue → worker.',
    checkedBy: ['design', 'simulation'],
  },
  {
    id: 'pub-sub',
    name: 'Event streaming and pub/sub',
    area: 'Async and real-time',
    summary: 'Publish an event once and let many consumers react to it.',
    explain:
      'With Kafka, every consumer group gets every event, so one "tweet posted" event can update feeds, search and analytics independently. Partitions give ordering per key and set the limit on parallel consumers.',
    onCanvas: 'Service → Kafka → several consumers; set partitions.',
    checkedBy: ['design', 'simulation'],
  },
  {
    id: 'fan-out',
    name: 'Fan-out on write vs fan-out on read',
    area: 'Async and real-time',
    summary: 'Precompute feeds when posting, or assemble them when reading.',
    explain:
      'Fan-out on write pushes each post into every follower’s feed cache: reads are instant, writes are heavy. Fan-out on read builds the feed when it is opened: cheap writes, slow reads. Large systems mix them: push for most users, pull for celebrities.',
    checkedBy: ['design', 'discussion'],
  },
  {
    id: 'realtime',
    name: 'Real-time delivery',
    area: 'Async and real-time',
    summary: 'Push updates instantly over WebSockets instead of polling.',
    explain:
      'A WebSocket keeps one connection open per user so the server can push messages the moment they arrive. Long polling and server-sent events are simpler alternatives. Connection servers are stateful, so you need a way to find which server holds a user (a presence store).',
    onCanvas: 'Connect users to a WebSocket server.',
    checkedBy: ['design', 'simulation'],
  },
  {
    id: 'notifications',
    name: 'Push notifications',
    area: 'Async and real-time',
    summary: 'Reach offline users through Apple and Google push services.',
    explain:
      'When a user is not connected, send a push through APNs (iOS) or FCM (Android), usually from a background worker so the provider’s latency and failures never slow the main request.',
    onCanvas: 'Worker → Push notifications (FCM / APNs).',
    checkedBy: ['design'],
  },

  // ── Reliability ──
  {
    id: 'redundancy',
    name: 'Redundancy and no single point of failure',
    area: 'Reliability',
    summary: 'Every critical part has a spare, so one failure doesn’t stop the system.',
    explain:
      'Run at least two instances of every service, replicate databases, and spread them across availability zones. Then losing one machine is a non-event. Look at your diagram and ask of each box: what happens if this dies?',
    onCanvas: 'Two or more instances per service; a replica per database.',
    checkedBy: ['design', 'simulation'],
  },
  {
    id: 'failover',
    name: 'Failover and graceful degradation',
    area: 'Reliability',
    summary: 'When a part fails, keep serving, maybe with less.',
    explain:
      'If the cache dies, fall back to the database (and make sure it can take the load). If recommendations are down, show popular items. Health checks and automatic failover switch to standbys without a human.',
    checkedBy: ['simulation'],
  },
  {
    id: 'rate-limiting',
    name: 'Rate limiting and throttling',
    area: 'Reliability',
    summary: 'Cap how many requests get through, so spikes and abusers can’t take you down.',
    explain:
      'Token bucket and sliding window are the common algorithms. Limits live in an API gateway or a limiter service, with counters shared in Redis so every instance sees the same count. Excess requests get 429 Too Many Requests.',
    onCanvas: 'Add a Rate limiter or API Gateway and set its rate limit.',
    checkedBy: ['design', 'simulation'],
  },
  {
    id: 'idempotency',
    name: 'Idempotency',
    area: 'Reliability',
    summary: 'Make retries safe, so a repeated request doesn’t charge twice.',
    explain:
      'Clients send an idempotency key with each write; the server stores the result under that key and returns it again for repeats. Essential for payments and anything retried after a timeout.',
    checkedBy: ['discussion'],
  },
  {
    id: 'retries',
    name: 'Timeouts, retries and circuit breakers',
    area: 'Reliability',
    summary: 'Never wait forever, retry with backoff, and stop calling what is down.',
    explain:
      'Every remote call needs a timeout. Retry with exponential backoff and jitter so retries don’t pile up into a storm. A circuit breaker stops calling a failing dependency for a while and fails fast instead.',
    checkedBy: ['discussion'],
  },
  {
    id: 'dead-letter',
    name: 'Dead-letter queues',
    area: 'Reliability',
    summary: 'Park messages that keep failing instead of retrying them forever.',
    explain:
      'After a few failed attempts a message moves to a dead-letter queue, so one bad message can’t block the rest. Someone (or a tool) inspects and replays them later.',
    checkedBy: ['discussion'],
  },
  {
    id: 'consistency',
    name: 'Consistency and the CAP theorem',
    area: 'Reliability',
    summary: 'Decide where you need strong consistency and where eventual is fine.',
    explain:
      'During a network partition a system must choose: stay available and maybe return old data, or stay consistent and refuse some requests. Bank balances and seat bookings need strong consistency; likes, feeds and view counts can be eventually consistent.',
    checkedBy: ['discussion'],
  },
  {
    id: 'transactions',
    name: 'Transactions and locking',
    area: 'Reliability',
    summary: 'Prevent two people from buying the last seat.',
    explain:
      'Use a database transaction with a row lock, or optimistic locking (a version number that must match), or a short-lived hold with expiry. For work across services, a saga runs local transactions with compensating steps (refund, release) if a later step fails.',
    checkedBy: ['discussion'],
  },

  // ── Operations ──
  {
    id: 'latency',
    name: 'Latency budgets and percentiles',
    area: 'Operations',
    summary: 'Measure p95 and p99, not averages, and give each hop a budget.',
    explain:
      'Users feel the slow requests, so targets are written as "95% of requests under 200 ms". Every hop (network, service, cache, database) spends part of that budget; adding a call adds its latency to everyone.',
    checkedBy: ['simulation'],
  },
  {
    id: 'availability',
    name: 'Availability and SLAs',
    area: 'Operations',
    summary: 'Know what 99.9% means and how chained parts multiply.',
    explain:
      '99.9% allows about 43 minutes of downtime a month; 99.99% about 4. Parts in a chain multiply: three services at 99.9% each give about 99.7% together. Redundancy is how you raise it.',
    checkedBy: ['simulation', 'discussion'],
  },
  {
    id: 'cost',
    name: 'Cost awareness',
    area: 'Operations',
    summary: 'Meet the targets without paying for capacity you don’t need.',
    explain:
      'Senior designs balance performance and cost: cache before buying bigger databases, use managed services where they save people time, and size for peak with some headroom, not ten times over.',
    checkedBy: ['simulation'],
  },
  {
    id: 'observability',
    name: 'Monitoring and observability',
    area: 'Operations',
    summary: 'Metrics, logs and traces so you know it’s broken before users tell you.',
    explain:
      'Track the four golden signals (latency, traffic, errors, saturation), alert on them, and trace requests across services to find which hop is slow.',
    onCanvas: 'Connect services to Prometheus or Datadog.',
    checkedBy: ['design'],
  },
  {
    id: 'security',
    name: 'Authentication and security',
    area: 'Operations',
    summary: 'Know who is calling and what they may do.',
    explain:
      'Authenticate users (often through a provider like Auth0), pass tokens to services, check permissions on every request, encrypt data in transit and at rest, and keep secrets out of code.',
    onCanvas: 'Connect a service to Auth0 or Clerk.',
    checkedBy: ['design', 'discussion'],
  },
  {
    id: 'dns',
    name: 'DNS and global routing',
    area: 'Operations',
    summary: 'Point users to the nearest healthy region.',
    explain:
      'DNS turns a name into an address. Managed DNS can route by latency or geography and fail over to another region when health checks fail, which is the first step to a multi-region design.',
    onCanvas: 'Users → Route 53 → your CDN or load balancer.',
    checkedBy: ['design'],
  },
  {
    id: 'serverless',
    name: 'Serverless and autoscaling',
    area: 'Operations',
    summary: 'Functions that scale per request, with cold starts and concurrency limits.',
    explain:
      'Serverless functions (AWS Lambda) scale automatically and cost nothing when idle, which suits spiky or event-driven work. Watch cold starts, the account concurrency limit and per-request pricing at steady high volume.',
    onCanvas: 'Use AWS Lambda behind a gateway or as a queue consumer.',
    checkedBy: ['design', 'simulation'],
  },
];

export const conceptById = new Map(CONCEPTS.map((c) => [c.id, c]));
