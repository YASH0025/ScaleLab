import type { Archetype, Protocol } from './schemas';

/**
 * Which protocols are allowed between two archetypes.
 * A pair that is missing from this table cannot be connected.
 * The UI uses this to suggest protocols while drawing an edge and
 * to explain why an invalid connection was rejected.
 */
type Rules = Partial<Record<Archetype, Partial<Record<Archetype, Protocol[]>>>>;

const HTTP_LIKE: Protocol[] = ['http', 'grpc', 'graphql', 'websocket'];
const SERVICE_CALL: Protocol[] = ['http', 'grpc', 'graphql', 'internal-call'];

const COMPUTE_LIKE: Archetype[] = ['compute-service', 'serverless-function', 'realtime-server', 'worker'];

const computeTargets: Partial<Record<Archetype, Protocol[]>> = {
  'compute-service': SERVICE_CALL,
  'serverless-function': SERVICE_CALL,
  'realtime-server': ['websocket', 'internal-call'],
  'auth-provider': ['http'],
  cache: ['cache-op'],
  'relational-db': ['db-query'],
  'document-db': ['db-query'],
  'wide-column-db': ['db-query'],
  'search-engine': ['http', 'db-query'],
  'vector-db': ['http', 'db-query'],
  'object-storage': ['object-io'],
  'message-queue': ['publish'],
  'event-stream': ['publish'],
  'external-api': ['http', 'grpc'],
  observability: ['internal-call'],
};

const entryTargets: Partial<Record<Archetype, Protocol[]>> = {
  dns: ['dns-lookup'],
  cdn: HTTP_LIKE,
  gateway: HTTP_LIKE,
  'load-balancer': HTTP_LIKE,
  'compute-service': HTTP_LIKE,
  'serverless-function': HTTP_LIKE,
  'realtime-server': ['websocket'],
  'auth-provider': ['http'],
  'object-storage': ['object-io'],
};

const rules: Rules = {
  client: entryTargets,
  dns: {},
  cdn: {
    gateway: HTTP_LIKE,
    'load-balancer': HTTP_LIKE,
    'compute-service': HTTP_LIKE,
    'serverless-function': HTTP_LIKE,
    'object-storage': ['object-io'],
  },
  gateway: {
    'load-balancer': HTTP_LIKE,
    'compute-service': HTTP_LIKE,
    'serverless-function': HTTP_LIKE,
    'realtime-server': ['websocket'],
    'auth-provider': ['http'],
  },
  'load-balancer': {
    gateway: HTTP_LIKE,
    'compute-service': HTTP_LIKE,
    'serverless-function': HTTP_LIKE,
    'realtime-server': ['websocket'],
  },
  'message-queue': { worker: ['consume'], 'compute-service': ['consume'], 'serverless-function': ['consume'] },
  'event-stream': { worker: ['consume'], 'compute-service': ['consume'], 'serverless-function': ['consume'] },
};

for (const source of COMPUTE_LIKE) {
  rules[source] = computeTargets;
}

export interface ConnectionCheck {
  valid: boolean;
  /** Allowed protocols, best default first. Empty when invalid. */
  protocols: Protocol[];
  /** Human-readable reason, shown when the connection is rejected. */
  reason?: string;
}

const PASSIVE: Archetype[] = ['infra-group'];

export function checkConnection(source: Archetype, target: Archetype): ConnectionCheck {
  if (PASSIVE.includes(source) || PASSIVE.includes(target)) {
    return {
      valid: false,
      protocols: [],
      reason: 'Infrastructure groups contain components. Drop nodes inside them instead of connecting to them.',
    };
  }
  const protocols = rules[source]?.[target] ?? [];
  if (protocols.length === 0) {
    return {
      valid: false,
      protocols: [],
      reason: `A ${source} can't talk to a ${target} directly. Route it through a service that owns that dependency.`,
    };
  }
  return { valid: true, protocols: [...protocols] };
}

export function isProtocolAllowed(source: Archetype, target: Archetype, protocol: Protocol): boolean {
  return checkConnection(source, target).protocols.includes(protocol);
}
