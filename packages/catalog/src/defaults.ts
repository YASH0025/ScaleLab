import type {
  Archetype,
  CacheConfig,
  ComputeConfig,
  Distribution,
  GenericConfig,
  LoadBalancerConfig,
  RelationalDbConfig,
} from '@scalelab/model';

/**
 * Small builders that keep catalog entries short and consistent.
 * All numbers are modeled starting points, not benchmarks. Users can change every value.
 */

const healthy = { available: true, extraLatencyMs: 0 } as const;

export const exp = (meanMs: number): Distribution => ({ kind: 'exponential', meanMs });
export const logn = (meanMs: number, p99Ms: number): Distribution => ({ kind: 'lognormal', meanMs, p99Ms });
export const fixed = (valueMs: number): Distribution => ({ kind: 'constant', valueMs });

/** The archetypes the engine simulates in the MVP. Everything else shows "coming soon". */
export const SIMULATED_ARCHETYPES: readonly Archetype[] = [
  'client',
  'load-balancer',
  'compute-service',
  'cache',
  'relational-db',
];

export const isSimulated = (archetype: Archetype): boolean => SIMULATED_ARCHETYPES.includes(archetype);

export const clientConfig = () => ({ type: 'client' as const, ...healthy });

export function computeConfig(c: {
  workersPerInstance: number;
  serviceTime: Distribution;
  instances?: number;
  queueLimit?: number;
  timeoutMs?: number;
}): ComputeConfig {
  return {
    type: 'compute',
    ...healthy,
    instances: c.instances ?? 2,
    workersPerInstance: c.workersPerInstance,
    serviceTime: c.serviceTime,
    queueLimit: c.queueLimit ?? 200,
    timeoutMs: c.timeoutMs ?? 2000,
  };
}

export function loadBalancerConfig(c: {
  strategy?: LoadBalancerConfig['strategy'];
  overhead: Distribution;
}): LoadBalancerConfig {
  return {
    type: 'load-balancer',
    ...healthy,
    strategy: c.strategy ?? 'least-connections',
    overhead: c.overhead,
    healthChecks: true,
  };
}

export function cacheConfig(c: {
  readLatency: Distribution;
  writeLatency: Distribution;
  hitRatio?: number;
  maxConnections?: number;
}): CacheConfig {
  return {
    type: 'cache',
    ...healthy,
    hitRatio: c.hitRatio ?? 0.8,
    readLatency: c.readLatency,
    writeLatency: c.writeLatency,
    maxConnections: c.maxConnections ?? 1000,
  };
}

export function relationalDbConfig(c: {
  connectionPool: number;
  readQuery: Distribution;
  writeQuery: Distribution;
  queueLimit?: number;
  timeoutMs?: number;
}): RelationalDbConfig {
  return {
    type: 'relational-db',
    ...healthy,
    connectionPool: c.connectionPool,
    readQuery: c.readQuery,
    writeQuery: c.writeQuery,
    queueLimit: c.queueLimit ?? 500,
    timeoutMs: c.timeoutMs ?? 3000,
    readReplicas: 0,
  };
}

export function genericConfig(params: GenericConfig['params'] = {}): GenericConfig {
  return { type: 'generic', ...healthy, params };
}
