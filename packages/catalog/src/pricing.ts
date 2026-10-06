import type { Archetype, Pricing } from '@scalelab/model';

/**
 * List-price estimates: AWS us-east-1, on-demand, Linux, checked October 2026.
 * They are a starting point for comparing designs, not a quote. Storage, data
 * transfer, frontend hosting, support plans and discounts are not included.
 */
export const PRICES_CHECKED = 'October 2026';

export const PRICING_NOTE =
  'List-price estimates (AWS us-east-1, on-demand, checked October 2026), assuming the load runs around the clock. Excludes storage, data transfer, frontend hosting and discounts.';

const HOURLY = {
  ec2M6iLarge: 0.096, // general-purpose 2 vCPU / 8 GiB
  elasticacheM6gLarge: 0.149, // Redis OSS / Memcached
  rdsPostgresM6gLarge: 0.159, // Single-AZ
  rdsMysqlM6gLarge: 0.152, // Single-AZ
  auroraR6gLarge: 0.26, // Aurora Standard
  mskM5Large: 0.21, // per broker
  amazonMqM7gLarge: 0.2734, // RabbitMQ, single instance
  albBase: 0.0225,
  albLcu: 0.008,
  openSearchR6gLarge: 0.167, // r6g.large.search
} as const;

/** Pay-per-request prices, US East, checked October 2026. Mixed prices assume 90% reads, 10% writes. */
const PER_MILLION = {
  apiGatewayHttp: 1.0, // HTTP APIs, first 300 M a month
  cloudFrontHttps: 1.0, // $0.0100 per 10,000 HTTPS requests; data transfer not included
  lambda: 0.2 + 0.5 * 0.1 * 0.0000166667 * 1_000_000, // requests + 512 MB × 100 ms of compute
  dynamoDbMixed: 0.9 * 0.125 + 0.1 * 0.625, // on-demand reads $0.125 / M, writes $0.625 / M
  s3Mixed: 0.9 * 0.4 + 0.1 * 5, // GET $0.0004 / 1,000, PUT $0.005 / 1,000
  route53PerRequest: 0.4 / 100, // $0.40 / M queries; resolvers cache, about 1 lookup per 100 requests
} as const;

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

const compute: Pricing = { kind: 'per-instance', hourlyUsd: HOURLY.ec2M6iLarge, instanceClass: 'm6i.large' };

/** Prices by technology id. Technologies not listed fall back to their archetype's default, if any. */
const BY_TECHNOLOGY: Record<string, Pricing> = {
  'aws-alb': {
    kind: 'load-balancer',
    hourlyUsd: HOURLY.albBase,
    unitHourlyUsd: HOURLY.albLcu,
    // An LCU covers 1,000 rule evaluations per second; with a few routing rules that's about 1,000 requests per second.
    requestsPerSecPerUnit: 1000,
  },
  nginx: compute,
  haproxy: compute,
  redis: { kind: 'node', hourlyUsd: HOURLY.elasticacheM6gLarge, instanceClass: 'cache.m6g.large' },
  // A Redis used only for jobs is its own ElastiCache node; one shared with caching costs nothing extra.
  'redis-queue': { kind: 'node', hourlyUsd: HOURLY.elasticacheM6gLarge, instanceClass: 'cache.m6g.large' },
  memcached: { kind: 'node', hourlyUsd: HOURLY.elasticacheM6gLarge, instanceClass: 'cache.m6g.large' },
  // ElastiCache for Valkey node pricing is 20% below Redis OSS.
  valkey: { kind: 'node', hourlyUsd: Math.round(HOURLY.elasticacheM6gLarge * 0.8 * 10_000) / 10_000, instanceClass: 'cache.m6g.large' },
  postgresql: { kind: 'database', hourlyUsd: HOURLY.rdsPostgresM6gLarge, instanceClass: 'db.m6g.large', queriesPerUnit: 25 },
  mysql: { kind: 'database', hourlyUsd: HOURLY.rdsMysqlM6gLarge, instanceClass: 'db.m6g.large', queriesPerUnit: 25 },
  'aurora-postgres': { kind: 'database', hourlyUsd: HOURLY.auroraR6gLarge, instanceClass: 'db.r6g.large', queriesPerUnit: 30 },
  kafka: { kind: 'cluster', hourlyUsd: HOURLY.mskM5Large, nodes: 3, instanceClass: 'kafka.m5.large' },
  redpanda: { kind: 'cluster', hourlyUsd: HOURLY.ec2M6iLarge, nodes: 3, instanceClass: 'm6i.large (self-managed)' },
  rabbitmq: { kind: 'node', hourlyUsd: HOURLY.amazonMqM7gLarge, instanceClass: 'mq.m7g.large' },
  'aws-sqs': { kind: 'per-request', perMillionUsd: 0.4, requestsPerMessage: 3 },
  'aws-route53': { kind: 'per-million-requests', perMillionUsd: round4(PER_MILLION.route53PerRequest), note: 'about 1 DNS lookup per 100 requests' },
  'cloudflare-cdn': { kind: 'third-party', provider: 'Cloudflare (flat monthly plans)' },
  'aws-cloudfront': { kind: 'per-million-requests', perMillionUsd: PER_MILLION.cloudFrontHttps, note: 'HTTPS requests; data transfer not included' },
  'aws-api-gateway': { kind: 'per-million-requests', perMillionUsd: PER_MILLION.apiGatewayHttp, note: 'HTTP API' },
  kong: compute,
  'rate-limiter': compute,
  'aws-lambda': { kind: 'per-million-requests', perMillionUsd: round4(PER_MILLION.lambda), note: '512 MB, 100 ms per call' },
  mongodb: { kind: 'database', hourlyUsd: HOURLY.ec2M6iLarge, instanceClass: 'm6i.large (self-managed)', queriesPerUnit: 25 },
  dynamodb: { kind: 'per-million-requests', perMillionUsd: round4(PER_MILLION.dynamoDbMixed), note: 'on-demand, 90% reads' },
  cassandra: { kind: 'database', hourlyUsd: HOURLY.ec2M6iLarge, instanceClass: 'm6i.large (self-managed)', queriesPerUnit: 50 },
  elasticsearch: { kind: 'database', hourlyUsd: HOURLY.openSearchR6gLarge, instanceClass: 'r6g.large.search', queriesPerUnit: 25 },
  pinecone: { kind: 'third-party', provider: 'Pinecone' },
  'aws-s3': { kind: 'per-million-requests', perMillionUsd: round4(PER_MILLION.s3Mixed), note: '90% reads; storage not included' },
  'firebase-cloud-messaging': { kind: 'third-party', provider: 'Google and Apple (free)' },
  prometheus: compute,
  datadog: { kind: 'third-party', provider: 'Datadog' },
  stripe: { kind: 'third-party', provider: 'Stripe' },
  paypal: { kind: 'third-party', provider: 'PayPal' },
  razorpay: { kind: 'third-party', provider: 'Razorpay' },
  twilio: { kind: 'third-party', provider: 'Twilio' },
  sendgrid: { kind: 'third-party', provider: 'SendGrid' },
  'openai-api': { kind: 'third-party', provider: 'OpenAI' },
  'third-party-api': { kind: 'third-party', provider: 'the provider' },
  auth0: { kind: 'third-party', provider: 'Auth0' },
  clerk: { kind: 'third-party', provider: 'Clerk' },
};

const BY_ARCHETYPE: Partial<Record<Archetype, Pricing>> = {
  client: { kind: 'free' },
  'compute-service': compute,
  'realtime-server': compute,
  worker: compute,
};

export function pricingFor(technologyId: string, archetype: Archetype): Pricing | undefined {
  return BY_TECHNOLOGY[technologyId] ?? BY_ARCHETYPE[archetype];
}
