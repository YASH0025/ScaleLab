import type { Design } from '@scalelab/model';
import { buildDesign } from './build';

export interface MicroShopOptions {
  /** Kafka partitions for the order-events stream. Default 6. */
  partitions?: number;
  /** Email worker instances. Default 2. */
  emailWorkers?: number;
}

const lognormal = (meanMs: number, p99Ms: number) => ({ kind: 'lognormal' as const, meanMs, p99Ms });

/**
 * ShopSphere as microservices: a catalog service with a cache, an order service that
 * calls an inventory service, and order events on Kafka for an email worker and an
 * analytics consumer.
 *
 * The lesson is built in: the email worker is slow, and Kafka's partitions cap how many
 * emails it sends at once. As orders ramp up, the email backlog and lag grow while every
 * user request still succeeds. Adding email workers past the partition count doesn't help;
 * adding partitions does.
 */
export function microShop(options: MicroShopOptions = {}): Design {
  return buildDesign(
    'ShopSphere microservices',
    'Catalog, orders and inventory services with Redis, PostgreSQL and Kafka-driven workers.',
    [
      { id: 'storefront', tech: 'nextjs', label: 'Storefront', x: 520, y: 0, libraries: ['tailwind-css', 'tanstack-query'] },
      { id: 'alb', tech: 'aws-alb', label: 'AWS ALB', x: 520, y: 150 },
      { id: 'catalog', tech: 'spring-boot', label: 'Catalog service', x: 200, y: 310, libraries: ['spring-data-jpa', 'lettuce'] },
      { id: 'redis', tech: 'redis', label: 'Redis', x: 40, y: 490 },
      {
        id: 'catalog-db',
        tech: 'postgresql',
        label: 'Catalog DB',
        x: 320,
        y: 490,
        config: { connectionPool: 30, readQuery: lognormal(10, 50), writeQuery: lognormal(20, 90) },
      },
      { id: 'orders', tech: 'nestjs', label: 'Order service', x: 820, y: 310, libraries: ['prisma', 'kafkajs'] },
      { id: 'inventory', tech: 'go-gin', label: 'Inventory service', x: 620, y: 490 },
      {
        id: 'inventory-db',
        tech: 'postgresql',
        label: 'Inventory DB',
        x: 620,
        y: 660,
        config: { connectionPool: 60, readQuery: lognormal(6, 30), writeQuery: lognormal(15, 70) },
      },
      {
        id: 'orders-db',
        tech: 'postgresql',
        label: 'Orders DB',
        x: 920,
        y: 490,
        config: { connectionPool: 60, readQuery: lognormal(8, 40), writeQuery: lognormal(18, 80) },
      },
      { id: 'kafka', tech: 'kafka', label: 'Order events', x: 1220, y: 490, config: { partitions: options.partitions ?? 6 } },
      {
        id: 'email',
        tech: 'background-worker',
        label: 'Email worker',
        x: 1080,
        y: 660,
        config: { instances: options.emailWorkers ?? 2, workersPerInstance: 4, serviceTime: lognormal(80, 300) },
      },
      { id: 'analytics', tech: 'kafka-consumer', label: 'Analytics consumer', x: 1360, y: 660 },
    ],
    [
      ['storefront', 'alb'],
      ['alb', 'catalog'],
      ['alb', 'orders'],
      ['catalog', 'redis'],
      ['catalog', 'catalog-db'],
      ['orders', 'inventory'],
      ['inventory', 'inventory-db'],
      ['orders', 'orders-db'],
      ['orders', 'kafka'],
      ['kafka', 'email'],
      ['kafka', 'analytics'],
    ],
  );
}
