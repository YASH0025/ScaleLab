import type { Kind } from './types';

/** Reads KEY=VALUE lines from a .env file. Comments and blank lines are ignored. */
export function parseEnv(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    out.push([m[1]!, value]);
  }
  return out;
}

const SCHEMES: Array<[RegExp, Kind]> = [
  [/^postgres(ql)?(\+\w+)?:\/\//i, 'postgres'],
  [/^(mysql|mariadb)(\+\w+)?:\/\//i, 'mysql'],
  [/^mongodb(\+srv)?:\/\//i, 'mongodb'],
  [/^rediss?:\/\//i, 'redis'],
  [/^amqps?:\/\//i, 'rabbitmq'],
  [/^memcached?:\/\//i, 'memcached'],
];

const KEYS: Array<[RegExp, Kind]> = [
  [/^KAFKA_(BROKERS?|BOOTSTRAP(_SERVERS)?|URL|HOST)S?$/i, 'kafka'],
  [/(^|_)SQS(_|$)/i, 'sqs'],
  [/(^|_)S3_BUCKET|^AWS_S3_/i, 's3'],
  [/^STRIPE_/i, 'stripe'],
  [/^PAYPAL_/i, 'paypal'],
  [/^RAZORPAY_/i, 'razorpay'],
  [/^TWILIO_/i, 'twilio'],
  [/^SENDGRID_/i, 'sendgrid'],
  [/^OPENAI_/i, 'openai'],
  [/^AUTH0_/i, 'auth0'],
  [/^(NEXT_PUBLIC_)?CLERK_/i, 'clerk'],
];

/** Keys whose Redis URL is a job broker rather than a cache. */
const JOB_BROKER_KEY = /CELERY|BROKER|BULL|QUEUE|JOBS?_|RQ_/i;

/** What one env entry points at, if anything. */
export function kindOfEnv(key: string, value: string): Kind | undefined {
  for (const [re, kind] of SCHEMES) {
    if (re.test(value)) return kind === 'redis' && JOB_BROKER_KEY.test(key) ? 'jobs' : kind;
  }
  for (const [re, kind] of KEYS) if (re.test(key)) return kind;
  return undefined;
}

/**
 * Host names in an env value, used to link docker-compose services:
 * "postgres://app:secret@db:5432/shop" → ["db"]; "http://orders:3000" → ["orders"];
 * a bare host like "redis" or "kafka:9092" → itself.
 */
export function hostsIn(value: string): string[] {
  const hosts: string[] = [];
  for (const part of value.split(',')) {
    const v = part.trim();
    const url = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([A-Za-z0-9_.-]+)/i.exec(v);
    if (url) hosts.push(url[1]!);
    else {
      const bare = /^([A-Za-z][A-Za-z0-9_.-]*)(?::\d+)?$/.exec(v);
      if (bare) hosts.push(bare[1]!);
    }
  }
  return hosts;
}
