import type { TechnologyDefinition } from '@scalelab/model';
import { cacheConfig, computeConfig, exp, externalConfig, genericConfig, loadBalancerConfig, logn, relationalDbConfig } from '../defaults';
import { tech } from './clients';

/**
 * The rest of the building blocks used in system design: DNS, CDNs, API gateways and
 * rate limiters, serverless functions, WebSocket servers, NoSQL, wide-column, search and
 * vector stores, object storage, push notifications and monitoring.
 *
 * Each runs on one of the engine's behaviors: DNS and gateways route like load balancers,
 * a CDN is a cache at the edge, every store is a database with a connection pool, and
 * object storage is a managed remote service. Numbers are modeled starting points.
 */
export const platformTechnologies: TechnologyDefinition[] = [
  // ── DNS and edge ──
  tech({
    id: 'aws-route53',
    name: 'Amazon Route 53',
    category: 'dns-edge',
    archetype: 'dns',
    icon: 'amazonroute53',
    brandColor: '#8C4FFF',
    description: 'Managed DNS. Turns your domain into the address of your CDN or load balancer; answers are cached by resolvers.',
    tags: ['dns', 'aws', 'routing', 'geo'],
    defaults: loadBalancerConfig({ strategy: 'random', overhead: exp(1) }),
  }),
  tech({
    id: 'cloudflare-cdn',
    name: 'Cloudflare CDN',
    category: 'dns-edge',
    archetype: 'cdn',
    icon: 'cloudflare',
    brandColor: '#F38020',
    description: 'Global CDN. Serves cached responses from the edge near users; only misses reach your servers.',
    tags: ['cdn', 'edge', 'cache'],
    defaults: cacheConfig({ hitRatio: 0.85, readLatency: logn(6, 25), writeLatency: exp(2), maxConnections: 1_000_000 }),
  }),
  tech({
    id: 'aws-cloudfront',
    name: 'Amazon CloudFront',
    category: 'dns-edge',
    archetype: 'cdn',
    icon: 'amazoncloudfront',
    brandColor: '#8C4FFF',
    description: 'AWS CDN. Caches images, video and API responses at edge locations.',
    tags: ['cdn', 'edge', 'aws', 'cache'],
    defaults: cacheConfig({ hitRatio: 0.85, readLatency: logn(8, 30), writeLatency: exp(2), maxConnections: 1_000_000 }),
  }),

  // ── API gateways and rate limiting ──
  tech({
    id: 'aws-api-gateway',
    name: 'Amazon API Gateway',
    category: 'gateway',
    archetype: 'gateway',
    icon: 'amazonapigateway',
    brandColor: '#8C4FFF',
    description: 'Managed API front door: routing, auth and throttling. Accounts start at 10,000 requests per second.',
    tags: ['api-gateway', 'aws', 'rate-limit', 'throttling'],
    defaults: { ...loadBalancerConfig({ strategy: 'round-robin', overhead: logn(6, 25) }), rateLimitRps: 10_000 },
  }),
  tech({
    id: 'kong',
    name: 'Kong',
    category: 'gateway',
    archetype: 'gateway',
    icon: 'kong',
    brandColor: '#003459',
    description: 'Open-source API gateway for routing, auth and rate limiting.',
    tags: ['api-gateway', 'self-hosted', 'rate-limit'],
    defaults: loadBalancerConfig({ strategy: 'round-robin', overhead: exp(2) }),
  }),
  tech({
    id: 'rate-limiter',
    name: 'Rate limiter',
    category: 'gateway',
    archetype: 'gateway',
    icon: 'ratelimiter',
    brandColor: '#B45309',
    description: 'Lets a fixed number of requests through each second and answers the rest with 429, protecting what sits behind it.',
    tags: ['rate-limit', 'throttling', 'token-bucket', 'protection'],
    defaults: { ...loadBalancerConfig({ strategy: 'round-robin', overhead: exp(1) }), rateLimitRps: 1000 },
  }),

  // ── Serverless and real-time ──
  tech({
    id: 'aws-lambda',
    name: 'AWS Lambda',
    category: 'serverless',
    archetype: 'serverless-function',
    icon: 'awslambda',
    brandColor: '#FF9900',
    description: 'Functions that scale per request. Accounts start at 1,000 concurrent executions; cold starts add latency.',
    tags: ['serverless', 'aws', 'functions', 'autoscaling'],
    defaults: computeConfig({ instances: 1, workersPerInstance: 1000, serviceTime: logn(40, 400), queueLimit: 0, timeoutMs: 10_000 }),
  }),
  tech({
    id: 'websocket-server',
    name: 'WebSocket server',
    category: 'realtime',
    archetype: 'realtime-server',
    icon: 'socketdotio',
    brandColor: '#010101',
    description: 'Keeps a live connection to each user and pushes messages instantly (Socket.IO, ws).',
    tags: ['realtime', 'websocket', 'chat', 'push', 'socket.io'],
    defaults: computeConfig({ instances: 2, workersPerInstance: 2000, serviceTime: logn(4, 20), queueLimit: 2000, timeoutMs: 5000 }),
  }),

  // ── NoSQL, wide-column, search and vector stores ──
  tech({
    id: 'mongodb',
    name: 'MongoDB',
    category: 'document-db',
    archetype: 'document-db',
    icon: 'mongodb',
    brandColor: '#47A248',
    description: 'Document database storing JSON-like records. Scales out with sharding.',
    tags: ['nosql', 'document', 'sharding'],
    defaults: relationalDbConfig({ connectionPool: 100, readQuery: logn(5, 25), writeQuery: logn(10, 50) }),
  }),
  tech({
    id: 'dynamodb',
    name: 'Amazon DynamoDB',
    category: 'wide-column-db',
    archetype: 'wide-column-db',
    icon: 'amazondynamodb',
    brandColor: '#4053D6',
    description: 'Managed key-value and wide-column store with single-digit millisecond reads at any scale.',
    tags: ['nosql', 'key-value', 'aws', 'serverless', 'partitions'],
    defaults: { ...relationalDbConfig({ connectionPool: 1000, readQuery: logn(5, 20), writeQuery: logn(8, 30), queueLimit: 5000 }), shards: 4 },
  }),
  tech({
    id: 'cassandra',
    name: 'Apache Cassandra',
    category: 'wide-column-db',
    archetype: 'wide-column-db',
    icon: 'apachecassandra',
    brandColor: '#1287B1',
    description: 'Wide-column store built for heavy writes across many nodes, with tunable consistency.',
    tags: ['nosql', 'wide-column', 'write-heavy', 'partitions'],
    defaults: { ...relationalDbConfig({ connectionPool: 200, readQuery: logn(6, 30), writeQuery: logn(3, 15), queueLimit: 2000 }), shards: 3 },
  }),
  tech({
    id: 'elasticsearch',
    name: 'Elasticsearch',
    category: 'search',
    archetype: 'search-engine',
    icon: 'elasticsearch',
    brandColor: '#005571',
    description: 'Full-text search engine with an inverted index. Powers search boxes and autocomplete.',
    tags: ['search', 'full-text', 'inverted-index', 'opensearch'],
    defaults: relationalDbConfig({ connectionPool: 50, readQuery: logn(25, 120), writeQuery: logn(30, 150) }),
  }),
  tech({
    id: 'pinecone',
    name: 'Pinecone',
    category: 'vector-db',
    archetype: 'vector-db',
    icon: 'pinecone',
    brandColor: '#1C17FF',
    description: 'Vector database for similarity search over embeddings (RAG, recommendations).',
    tags: ['vector', 'embeddings', 'ai', 'rag', 'similarity'],
    defaults: relationalDbConfig({ connectionPool: 100, readQuery: logn(40, 150), writeQuery: logn(30, 120) }),
  }),

  // ── Object storage ──
  tech({
    id: 'aws-s3',
    name: 'AWS S3',
    category: 'object-storage',
    archetype: 'object-storage',
    icon: 'amazons3',
    brandColor: '#569A31',
    description: 'Object storage for images, video, files and backups. About 5,500 reads per second per key prefix.',
    tags: ['aws', 'storage', 'blob', 'files', 'media'],
    defaults: externalConfig({ latency: logn(30, 120), errorRate: 0.0001, timeoutRate: 0, timeoutMs: 10_000, rateLimitRps: 5500 }),
  }),

  // ── Notifications ──
  tech({
    id: 'firebase-cloud-messaging',
    name: 'Push notifications (FCM / APNs)',
    category: 'external',
    archetype: 'external-api',
    icon: 'firebase',
    brandColor: '#DD2C00',
    description: 'Sends push notifications to Android and iOS devices through Google and Apple.',
    tags: ['push', 'notifications', 'mobile', 'fcm', 'apns'],
    defaults: externalConfig({ latency: logn(150, 600), errorRate: 0.002, timeoutRate: 0.001, timeoutMs: 5000 }),
  }),

  // ── Observability ──
  tech({
    id: 'prometheus',
    name: 'Prometheus',
    category: 'observability',
    archetype: 'observability',
    icon: 'prometheus',
    brandColor: '#E6522C',
    description: 'Collects metrics from your services for dashboards and alerts. Off the request path.',
    tags: ['monitoring', 'metrics', 'alerts', 'observability'],
    defaults: genericConfig(),
  }),
  tech({
    id: 'datadog',
    name: 'Datadog',
    category: 'observability',
    archetype: 'observability',
    icon: 'datadog',
    brandColor: '#632CA6',
    description: 'Hosted metrics, logs and traces. Off the request path.',
    tags: ['monitoring', 'logs', 'tracing', 'apm', 'observability'],
    defaults: genericConfig(),
  }),
];
