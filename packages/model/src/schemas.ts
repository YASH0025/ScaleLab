import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Archetypes: the behaviors the simulation engine understands.
// Hundreds of technologies map onto this small set.
// ─────────────────────────────────────────────────────────────
export const ARCHETYPES = [
  'client',
  'dns',
  'cdn',
  'gateway',
  'load-balancer',
  'compute-service',
  'serverless-function',
  'realtime-server',
  'auth-provider',
  'cache',
  'relational-db',
  'document-db',
  'wide-column-db',
  'search-engine',
  'vector-db',
  'object-storage',
  'message-queue',
  'event-stream',
  'worker',
  'external-api',
  'infra-group',
  'observability',
] as const;
export const ArchetypeSchema = z.enum(ARCHETYPES);
export type Archetype = z.infer<typeof ArchetypeSchema>;

export const PROTOCOLS = [
  'http',
  'grpc',
  'graphql',
  'websocket',
  'db-query',
  'cache-op',
  'publish',
  'consume',
  'object-io',
  'dns-lookup',
  'internal-call',
] as const;
export const ProtocolSchema = z.enum(PROTOCOLS);
export type Protocol = z.infer<typeof ProtocolSchema>;

export const CATEGORIES = [
  'client',
  'frontend',
  'mobile',
  'dns-edge',
  'gateway',
  'load-balancer',
  'backend',
  'serverless',
  'realtime',
  'auth',
  'relational-db',
  'document-db',
  'wide-column-db',
  'graph-db',
  'time-series-db',
  'cache',
  'search',
  'vector-db',
  'object-storage',
  'message-queue',
  'event-stream',
  'worker',
  'analytics',
  'external',
  'infrastructure',
  'observability',
] as const;
export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

// ─────────────────────────────────────────────────────────────
// Timing distributions
// ─────────────────────────────────────────────────────────────
export const DistributionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('constant'), valueMs: z.number().nonnegative() }),
  z.object({ kind: z.literal('exponential'), meanMs: z.number().positive() }),
  z.object({
    kind: z.literal('lognormal'),
    meanMs: z.number().positive(),
    p99Ms: z.number().positive(),
  }),
]);
export type Distribution = z.infer<typeof DistributionSchema>;

// ─────────────────────────────────────────────────────────────
// Per-archetype configuration
// ─────────────────────────────────────────────────────────────
const base = {
  /** Failure injection: false means the component is down. */
  available: z.boolean(),
  /** Failure injection: extra latency added to every operation. */
  extraLatencyMs: z.number().nonnegative(),
};

export const ClientConfigSchema = z.object({ type: z.literal('client'), ...base });

export const LoadBalancerConfigSchema = z.object({
  type: z.literal('load-balancer'),
  ...base,
  strategy: z.enum(['round-robin', 'least-connections', 'random']),
  overhead: DistributionSchema,
  healthChecks: z.boolean(),
});

export const ComputeConfigSchema = z.object({
  type: z.literal('compute'),
  ...base,
  instances: z.number().int().min(1),
  workersPerInstance: z.number().int().min(1),
  serviceTime: DistributionSchema,
  queueLimit: z.number().int().min(0),
  timeoutMs: z.number().positive(),
});

export const CacheConfigSchema = z.object({
  type: z.literal('cache'),
  ...base,
  hitRatio: z.number().min(0).max(1),
  readLatency: DistributionSchema,
  writeLatency: DistributionSchema,
  maxConnections: z.number().int().min(1),
});

export const RelationalDbConfigSchema = z.object({
  type: z.literal('relational-db'),
  ...base,
  connectionPool: z.number().int().min(1),
  readQuery: DistributionSchema,
  writeQuery: DistributionSchema,
  queueLimit: z.number().int().min(0),
  timeoutMs: z.number().positive(),
  readReplicas: z.number().int().min(0),
});

/**
 * Message brokers (RabbitMQ, SQS) and event streams (Kafka, Redpanda).
 * Producers don't wait for consumers; messages wait in a backlog until a consumer is free.
 */
export const QueueConfigSchema = z.object({
  type: z.literal('queue'),
  ...base,
  /** Backlog size at which the broker pushes back and publishes are rejected. */
  maxBacklog: z.number().int().min(1),
  /** Time for the broker to acknowledge a publish. */
  publishLatency: DistributionSchema,
  /**
   * Event streams only: a consumer group processes at most this many messages at once
   * (one per partition). 0 means no limit.
   */
  partitions: z.number().int().min(0),
  /**
   * true: every consumer group gets its own copy of each message (Kafka, Redpanda).
   * false: consumers compete and each message is processed once (RabbitMQ, SQS).
   */
  fanOut: z.boolean(),
});

/**
 * A third-party service (Stripe, Auth0, Twilio…). You don't control it: it can be slow,
 * return errors, rate-limit you, or time out after it already did the work.
 */
export const ExternalConfigSchema = z.object({
  type: z.literal('external'),
  ...base,
  latency: DistributionSchema,
  /** Share of calls that fail with an error. Nothing happens on the provider's side. */
  errorRate: z.number().min(0).max(1),
  /**
   * Share of calls that hang until the caller gives up. The provider did the work
   * (the card was charged), but your service never hears back.
   */
  timeoutRate: z.number().min(0).max(1),
  /** How long your service waits for a reply before giving up. */
  timeoutMs: z.number().positive(),
  /** Calls per second the provider accepts before answering 429. 0 means no limit. */
  rateLimitRps: z.number().int().min(0),
});

/** Archetypes the engine does not simulate yet carry free-form params. */
export const GenericConfigSchema = z.object({
  type: z.literal('generic'),
  ...base,
  params: z.record(z.union([z.number(), z.string(), z.boolean()])),
});

export const ArchetypeConfigSchema = z.discriminatedUnion('type', [
  ClientConfigSchema,
  LoadBalancerConfigSchema,
  ComputeConfigSchema,
  CacheConfigSchema,
  RelationalDbConfigSchema,
  QueueConfigSchema,
  ExternalConfigSchema,
  GenericConfigSchema,
]);
export type ArchetypeConfig = z.infer<typeof ArchetypeConfigSchema>;
export type ClientConfig = z.infer<typeof ClientConfigSchema>;
export type LoadBalancerConfig = z.infer<typeof LoadBalancerConfigSchema>;
export type ComputeConfig = z.infer<typeof ComputeConfigSchema>;
export type CacheConfig = z.infer<typeof CacheConfigSchema>;
export type RelationalDbConfig = z.infer<typeof RelationalDbConfigSchema>;
export type QueueConfig = z.infer<typeof QueueConfigSchema>;
export type ExternalConfig = z.infer<typeof ExternalConfigSchema>;
export type GenericConfig = z.infer<typeof GenericConfigSchema>;

// ─────────────────────────────────────────────────────────────
// Catalog: technologies and libraries as data
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// Pricing: list-price estimates, never quotes
// ─────────────────────────────────────────────────────────────
export const PricingSchema = z.discriminatedUnion('kind', [
  /** Nothing to pay for in the modeled system (users' browsers, frontends hosted elsewhere). */
  z.object({ kind: z.literal('free') }),
  /** One machine per instance (backends, workers); self-hosted proxies count as one instance. */
  z.object({ kind: z.literal('per-instance'), hourlyUsd: z.number().nonnegative(), instanceClass: z.string() }),
  /**
   * A managed database. Concurrent-query capacity (the connection pool) needs a bigger instance:
   * each doubling past `queriesPerUnit` doubles the price. Read replicas cost the same as the primary.
   */
  z.object({
    kind: z.literal('database'),
    hourlyUsd: z.number().nonnegative(),
    instanceClass: z.string(),
    queriesPerUnit: z.number().int().positive(),
  }),
  /** A single managed node (a cache). */
  z.object({ kind: z.literal('node'), hourlyUsd: z.number().nonnegative(), instanceClass: z.string() }),
  /** A cluster of brokers billed per broker (Kafka). */
  z.object({ kind: z.literal('cluster'), hourlyUsd: z.number().nonnegative(), nodes: z.number().int().positive(), instanceClass: z.string() }),
  /** A managed load balancer: an hourly base plus capacity units that grow with traffic. */
  z.object({
    kind: z.literal('load-balancer'),
    hourlyUsd: z.number().nonnegative(),
    unitHourlyUsd: z.number().nonnegative(),
    requestsPerSecPerUnit: z.number().positive(),
  }),
  /** Billed by the provider per use (Stripe fees, Twilio messages). Not part of your infrastructure bill. */
  z.object({ kind: z.literal('third-party'), provider: z.string() }),
  /** Pay per API request (SQS). Each message takes `requestsPerMessage` requests: send, receive, delete. */
  z.object({ kind: z.literal('per-request'), perMillionUsd: z.number().nonnegative(), requestsPerMessage: z.number().positive() }),
]);
export type Pricing = z.infer<typeof PricingSchema>;

export const TechnologyDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  category: CategorySchema,
  archetype: ArchetypeSchema,
  /** Icon key resolved by the UI (e.g. a Devicon / Simple Icons slug). */
  icon: z.string().min(1),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  description: z.string().min(1),
  tags: z.array(z.string()),
  defaults: ArchetypeConfigSchema,
  /** False shows a "simulation coming soon" badge in the UI. */
  simulationSupported: z.boolean(),
  /** List-price estimate. Missing means "not priced yet". */
  pricing: PricingSchema.optional(),
});
export type TechnologyDefinition = z.infer<typeof TechnologyDefinitionSchema>;

export const LIBRARY_CATEGORIES = [
  'ui-kit',
  'styling',
  'state',
  'data-fetching',
  'forms',
  'animation',
  'orm',
  'auth',
  'validation',
  'cache-client',
  'resilience',
  'messaging-client',
  'observability',
  'api-layer',
  'testing',
] as const;
export const LibraryCategorySchema = z.enum(LIBRARY_CATEGORIES);
export type LibraryCategory = z.infer<typeof LibraryCategorySchema>;

export const LibraryEffectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('add-overhead'), perRequestMs: z.number().nonnegative() }),
  z.object({
    kind: z.literal('enable-resilience'),
    retries: z.boolean(),
    circuitBreaker: z.boolean(),
    timeouts: z.boolean(),
  }),
  z.object({ kind: z.literal('auth-step'), latency: DistributionSchema }),
  z.object({
    kind: z.literal('connection-pool'),
    target: ArchetypeSchema,
    poolSize: z.number().int().min(1),
  }),
  z.object({ kind: z.literal('rich-tracing') }),
]);
export type LibraryEffect = z.infer<typeof LibraryEffectSchema>;

export const LibraryDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  category: LibraryCategorySchema,
  icon: z.string().min(1),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** Technology ids this library can be attached to. */
  compatibleWith: z.array(z.string()).min(1),
  /** Library ids that overlap with this one (soft warning, not a block). */
  conflictsWith: z.array(z.string()).default([]),
  effect: LibraryEffectSchema,
});
export type LibraryDefinition = z.infer<typeof LibraryDefinitionSchema>;

/** A library has a simulation effect (shown with a ⚡ badge) unless its effect is 'none'. */
export function affectsSimulation(lib: LibraryDefinition): boolean {
  return lib.effect.kind !== 'none';
}

// ─────────────────────────────────────────────────────────────
// Architecture model: nodes, edges, libraries
// ─────────────────────────────────────────────────────────────
export const LibraryAttachmentSchema = z.object({
  libraryId: z.string(),
  settings: z.record(z.union([z.number(), z.string(), z.boolean()])).optional(),
});
export type LibraryAttachment = z.infer<typeof LibraryAttachmentSchema>;

export const ArchNodeSchema = z.object({
  id: z.string().min(1),
  technologyId: z.string().min(1),
  label: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  /** Membership in an infra group (Kubernetes cluster, availability zone, region). */
  parentId: z.string().optional(),
  config: ArchetypeConfigSchema,
  libraries: z.array(LibraryAttachmentSchema).default([]),
});
export type ArchNode = z.infer<typeof ArchNodeSchema>;

export const ArchEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  protocol: ProtocolSchema,
  networkLatency: DistributionSchema,
});
export type ArchEdge = z.infer<typeof ArchEdgeSchema>;

// ─────────────────────────────────────────────────────────────
// API flows: what happens when a request arrives
// ─────────────────────────────────────────────────────────────
export type FlowStep =
  /**
   * Uses a node. On a backend the first call takes one of its workers and keeps it
   * until the request finishes (the entry service). On a cache or database it is one round trip.
   */
  | {
      kind: 'call';
      nodeId: string;
      operation: 'read' | 'write' | 'process';
      /**
       * A side effect this call makes in the world, like "saved to Orders DB" or
       * "Stripe call went through". Recorded when it happens, even if the request later fails.
       */
      effect?: string;
    }
  /**
   * A synchronous call to another backend service (microservices). The callee takes a
   * worker, does its own work, runs `steps` (its own dependencies), then frees the worker
   * and replies. The caller's worker stays busy waiting the whole time.
   */
  | { kind: 'service-call'; nodeId: string; steps: FlowStep[] }
  | {
      kind: 'cache-lookup';
      cacheNodeId: string;
      onHit: FlowStep[];
      onMiss: FlowStep[];
      writeBackOnMiss: boolean;
    }
  | { kind: 'parallel'; branches: FlowStep[][] }
  /** Sends a message to a queue or stream and continues without waiting for consumers. */
  | { kind: 'publish'; nodeId: string; effect?: string }
  | { kind: 'respond'; status: number };

export const FlowStepSchema: z.ZodType<FlowStep> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('call'),
      nodeId: z.string(),
      operation: z.enum(['read', 'write', 'process']),
      effect: z.string().optional(),
    }),
    z.object({ kind: z.literal('service-call'), nodeId: z.string(), steps: z.array(FlowStepSchema) }),
    z.object({
      kind: z.literal('cache-lookup'),
      cacheNodeId: z.string(),
      onHit: z.array(FlowStepSchema),
      onMiss: z.array(FlowStepSchema),
      writeBackOnMiss: z.boolean(),
    }),
    z.object({ kind: z.literal('parallel'), branches: z.array(z.array(FlowStepSchema)) }),
    z.object({ kind: z.literal('publish'), nodeId: z.string(), effect: z.string().optional() }),
    z.object({ kind: z.literal('respond'), status: z.number().int() }),
  ]),
);

export const ApiFlowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().startsWith('/'),
  /** First node the request reaches after the client. */
  entryNodeId: z.string(),
  steps: z.array(FlowStepSchema),
  retry: z.object({ attempts: z.number().int().min(0), backoffMs: z.number().nonnegative() }),
  fallback: z.object({ status: z.number().int() }).optional(),
});
export type ApiFlow = z.infer<typeof ApiFlowSchema>;

// ─────────────────────────────────────────────────────────────
// Workloads: traffic definitions
// ─────────────────────────────────────────────────────────────
export const TrafficPatternSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('constant'), rps: z.number().positive() }),
  z.object({ kind: z.literal('ramp'), fromRps: z.number().nonnegative(), toRps: z.number().positive() }),
  z.object({
    kind: z.literal('spike'),
    baseRps: z.number().positive(),
    spikeRps: z.number().positive(),
    spikeAtSec: z.number().nonnegative(),
    spikeDurationSec: z.number().positive(),
  }),
  z.object({
    kind: z.literal('burst'),
    baseRps: z.number().nonnegative(),
    burstRps: z.number().positive(),
    burstEverySec: z.number().positive(),
    burstDurationSec: z.number().positive(),
  }),
]);
export type TrafficPattern = z.infer<typeof TrafficPatternSchema>;

export const WorkloadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  durationSec: z.number().positive(),
  pattern: TrafficPatternSchema,
  /** Single requests. Can be empty when only journeys run. */
  mix: z.array(z.object({ flowId: z.string(), weight: z.number().positive() })),
  /** Users starting each journey per second, alongside the request mix. */
  journeys: z.array(z.object({ journeyId: z.string(), usersPerSec: z.number().positive() })).optional(),
  /** Same seed + same design gives identical results on every machine. */
  seed: z.number().int(),
});
export type Workload = z.infer<typeof WorkloadSchema>;

// ─────────────────────────────────────────────────────────────
// A complete design (what the Yjs document stores)
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// Journeys: what a user does, step by step
// ─────────────────────────────────────────────────────────────
export const JourneyStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** The service that handles this step. */
  serviceNodeId: z.string(),
  /** Reads look things up; writes change data and trigger side effects. */
  operation: z.enum(['read', 'write']),
  /** How many times the user's app retries this step after a failure. */
  retries: z.number().int().min(0).max(5),
  /**
   * Retries reuse an idempotency key, so a side effect that already happened
   * isn't applied a second time (no double charges).
   */
  idempotent: z.boolean(),
});
export type JourneyStep = z.infer<typeof JourneyStepSchema>;

export const JourneySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  steps: z.array(JourneyStepSchema).min(1).max(20),
});
export type Journey = z.infer<typeof JourneySchema>;

/**
 * What a consumer does with each message it takes from a queue or stream.
 * The first step usually takes a worker on the consumer for the whole job.
 */
export const MessageHandlerSchema = z.object({
  id: z.string().min(1),
  queueNodeId: z.string(),
  consumerNodeId: z.string(),
  steps: z.array(FlowStepSchema),
});
export type MessageHandler = z.infer<typeof MessageHandlerSchema>;

export const DesignSchema = z.object({
  schemaVersion: z.literal(1),
  meta: z.object({
    name: z.string().min(1),
    description: z.string().default(''),
    createdAt: z.string(),
  }),
  nodes: z.array(ArchNodeSchema),
  edges: z.array(ArchEdgeSchema),
  flows: z.array(ApiFlowSchema),
  /** Consumers of queues and streams. Optional so older designs stay valid. */
  handlers: z.array(MessageHandlerSchema).optional(),
  /** User journeys through the system. */
  journeys: z.array(JourneySchema).optional(),
  workloads: z.array(WorkloadSchema),
});
export type Design = z.infer<typeof DesignSchema>;

// ─────────────────────────────────────────────────────────────
// Simulation results (produced by the engine, never edited by users)
// ─────────────────────────────────────────────────────────────
export type RequestStatus = 'ok' | 'rejected' | 'timeout' | 'error' | 'fallback';

export interface TraceSpan {
  nodeId: string;
  startMs: number;
  /** Time spent waiting in a queue. */
  waitMs: number;
  /** Time spent being processed. */
  serviceMs: number;
  outcome: 'complete' | 'cache-hit' | 'cache-miss' | 'rejected' | 'timeout' | 'failed';
  children?: TraceSpan[];
}

export interface RequestTrace {
  requestId: string;
  flowId: string;
  startMs: number;
  totalMs: number;
  status: RequestStatus;
  httpStatus: number;
  spans: TraceSpan[];
}

export interface NodeMetricsSample {
  nodeId: string;
  /** 0..1 */
  utilization: number;
  queueLength: number;
  avgWaitMs: number;
  observedHitRatio?: number;
}

export interface MetricsSample {
  simTimeSec: number;
  throughputRps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  /** 0..1 */
  errorRate: number;
  nodes: NodeMetricsSample[];
}

export interface Finding {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  area: 'scalability' | 'reliability' | 'performance' | 'data-access' | 'security' | 'maintainability';
  title: string;
  observation: string;
  /** Must be traceable to metrics; findings never appear without evidence. */
  evidence: string;
  suggestedExperiment: string;
}

export interface ExperimentSummary {
  id: string;
  name: string;
  createdAt: string;
  designSnapshot: Pick<Design, 'nodes' | 'edges' | 'flows'>;
  workload: Workload;
  totals: {
    completed: number;
    failed: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    peakThroughputRps: number;
  };
  findings: Finding[];
}
