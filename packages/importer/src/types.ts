/** A file read from the user's project: a path relative to the project root, and its text. */
export interface RepoFile {
  path: string;
  content: string;
}

/**
 * Something a project depends on that becomes its own component on the canvas:
 * a database, cache, broker or outside service.
 */
export type Kind =
  | 'postgres'
  | 'mysql'
  | 'mongodb'
  | 'redis'
  | 'memcached'
  | 'kafka'
  | 'rabbitmq'
  | 'sqs'
  | 'jobs'
  | 's3'
  | 'stripe'
  | 'paypal'
  | 'razorpay'
  | 'twilio'
  | 'sendgrid'
  | 'openai'
  | 'auth0'
  | 'clerk';

export const KIND_TECH: Record<Kind, string> = {
  postgres: 'postgresql',
  mysql: 'mysql',
  mongodb: 'mongodb',
  redis: 'redis',
  memcached: 'memcached',
  kafka: 'kafka',
  rabbitmq: 'rabbitmq',
  sqs: 'aws-sqs',
  jobs: 'redis-queue',
  s3: 'aws-s3',
  stripe: 'stripe',
  paypal: 'paypal',
  razorpay: 'razorpay',
  twilio: 'twilio',
  sendgrid: 'sendgrid',
  openai: 'openai-api',
  auth0: 'auth0',
  clerk: 'clerk',
};

/** Brokers a worker can take jobs from. */
export const BROKER_KINDS: readonly Kind[] = ['kafka', 'rabbitmq', 'sqs', 'jobs'];

export type Role = 'frontend' | 'proxy' | 'service' | 'worker' | 'database' | 'cache' | 'queue' | 'storage' | 'external';

export type Confidence = 'high' | 'guess';

export interface DetectedComponent {
  /** Stable key, also used as the node id. */
  key: string;
  technologyId: string;
  label: string;
  role: Role;
  libraries: string[];
  /** Why we think this exists, like "image postgres:16 in docker-compose.yml". */
  evidence: string[];
  confidence: Confidence;
  /** Replicas from docker-compose, when set. */
  instances?: number;
  /** Shown when the technology is a stand-in, like "Flask is modeled as FastAPI". */
  note?: string;
}

export interface DetectedLink {
  from: string;
  to: string;
  evidence: string;
}

export interface ImportResult {
  name: string;
  components: DetectedComponent[];
  links: DetectedLink[];
  /** Things we skipped or couldn't place, in plain words. */
  notes: string[];
  /** Files that told us something. */
  filesUsed: string[];
}
