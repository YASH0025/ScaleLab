import { getTechnology } from '@scalelab/catalog';
import type { ApiFlow, ArchEdge, ArchNode, ArchetypeConfig, Design, FlowStep, Workload } from '@scalelab/model';

export interface ShopSphereOptions {
  /** Put Redis in front of PostgreSQL for product reads. Default true. */
  cache?: boolean;
  /** Number of Spring Boot instances behind the load balancer. Default 2. */
  backendInstances?: number;
  /** Redis hit ratio when the cache is on. Default 0.8. */
  cacheHitRatio?: number;
  /** Read replicas for PostgreSQL. Default 0. */
  readReplicas?: number;
}

function defaultsOf(technologyId: string): ArchetypeConfig {
  const tech = getTechnology(technologyId);
  if (!tech) throw new Error(`Template uses unknown technology "${technologyId}".`);
  return JSON.parse(JSON.stringify(tech.defaults)) as ArchetypeConfig;
}

const net = { kind: 'lognormal' as const, meanMs: 0.5, p99Ms: 2 };

/**
 * ShopSphere: the e-commerce example from the product concept.
 * Next.js storefront (shoppers' browsers) → AWS ALB → Spring Boot (×2) → Redis + PostgreSQL.
 *
 * The database is sized so it becomes the bottleneck somewhere around 2,500–3,000 rps
 * without the cache. That makes the classic lessons visible in one run: more backends
 * don't help a saturated database, and a cache does.
 */
export function shopSphere(options: ShopSphereOptions = {}): Design {
  const cache = options.cache ?? true;
  const instances = options.backendInstances ?? 2;

  const spring = defaultsOf('spring-boot');
  if (spring.type === 'compute') spring.instances = instances;

  const redis = defaultsOf('redis');
  if (redis.type === 'cache') redis.hitRatio = options.cacheHitRatio ?? 0.8;

  const postgres = defaultsOf('postgresql');
  if (postgres.type === 'relational-db') {
    postgres.connectionPool = 30;
    postgres.readQuery = { kind: 'lognormal', meanMs: 10, p99Ms: 50 };
    postgres.writeQuery = { kind: 'lognormal', meanMs: 20, p99Ms: 90 };
    postgres.readReplicas = options.readReplicas ?? 0;
  }

  const nodes: ArchNode[] = [
    {
      id: 'storefront',
      technologyId: 'nextjs',
      label: 'Storefront',
      position: { x: 400, y: 0 },
      config: defaultsOf('nextjs'),
      libraries: [{ libraryId: 'tailwind-css' }, { libraryId: 'zustand' }, { libraryId: 'tanstack-query' }],
    },
    { id: 'alb', technologyId: 'aws-alb', label: 'AWS ALB', position: { x: 400, y: 140 }, config: defaultsOf('aws-alb'), libraries: [] },
    {
      id: 'api',
      technologyId: 'spring-boot',
      label: 'Product service',
      position: { x: 400, y: 280 },
      config: spring,
      libraries: [{ libraryId: 'spring-data-jpa' }, { libraryId: 'lettuce' }],
    },
    { id: 'postgres', technologyId: 'postgresql', label: 'PostgreSQL', position: { x: 560, y: 440 }, config: postgres, libraries: [] },
  ];
  const edges: ArchEdge[] = [
    { id: 'e-storefront-alb', source: 'storefront', target: 'alb', protocol: 'http', networkLatency: { kind: 'lognormal', meanMs: 20, p99Ms: 80 } },
    { id: 'e-alb-api', source: 'alb', target: 'api', protocol: 'http', networkLatency: net },
    { id: 'e-api-postgres', source: 'api', target: 'postgres', protocol: 'db-query', networkLatency: net },
  ];
  if (cache) {
    nodes.push({ id: 'redis', technologyId: 'redis', label: 'Redis', position: { x: 240, y: 440 }, config: redis, libraries: [] });
    edges.push({ id: 'e-api-redis', source: 'api', target: 'redis', protocol: 'cache-op', networkLatency: net });
  }

  const readProduct: FlowStep[] = cache
    ? [
        {
          kind: 'cache-lookup',
          cacheNodeId: 'redis',
          onHit: [],
          onMiss: [{ kind: 'call', nodeId: 'postgres', operation: 'read' }],
          writeBackOnMiss: true,
        },
      ]
    : [{ kind: 'call', nodeId: 'postgres', operation: 'read' }];

  const flows: ApiFlow[] = [
    {
      id: 'get-product',
      name: 'Get product',
      method: 'GET',
      path: '/api/products/{id}',
      entryNodeId: 'alb',
      steps: [{ kind: 'call', nodeId: 'api', operation: 'process' }, ...readProduct, { kind: 'respond', status: 200 }],
      retry: { attempts: 0, backoffMs: 0 },
    },
    {
      id: 'place-order',
      name: 'Place order',
      method: 'POST',
      path: '/api/orders',
      entryNodeId: 'alb',
      steps: [
        { kind: 'call', nodeId: 'api', operation: 'process' },
        { kind: 'call', nodeId: 'postgres', operation: 'write' },
        { kind: 'respond', status: 201 },
      ],
      retry: { attempts: 0, backoffMs: 0 },
    },
  ];

  const workloads: Workload[] = [
    {
      id: 'ramp',
      name: 'Launch-day ramp',
      durationSec: 60,
      pattern: { kind: 'ramp', fromRps: 500, toRps: 5000 },
      mix: [
        { flowId: 'get-product', weight: 9 },
        { flowId: 'place-order', weight: 1 },
      ],
      seed: 42,
    },
  ];

  return {
    schemaVersion: 1,
    meta: {
      name: 'ShopSphere',
      description: 'E-commerce product catalog: load balancer, two Spring Boot instances, Redis and PostgreSQL.',
      createdAt: '2026-10-03T00:00:00.000Z',
    },
    nodes,
    edges,
    flows,
    workloads,
  };
}
