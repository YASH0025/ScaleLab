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
} as const;

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
};

const BY_ARCHETYPE: Partial<Record<Archetype, Pricing>> = {
  client: { kind: 'free' },
  'compute-service': compute,
  worker: compute,
};

export function pricingFor(technologyId: string, archetype: Archetype): Pricing | undefined {
  return BY_TECHNOLOGY[technologyId] ?? BY_ARCHETYPE[archetype];
}
