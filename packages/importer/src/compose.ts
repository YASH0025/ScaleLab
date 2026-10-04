import { parse } from 'yaml';
import { kindOfEnv } from './env';
import { dirOf, joinPath } from './files';
import { parseEnv } from './env';
import type { Kind, RepoFile } from './types';

export interface ComposeService {
  name: string;
  file: string;
  image?: string;
  /** Build folder relative to the project root. */
  buildDir?: string;
  command?: string;
  dependsOn: string[];
  env: Array<[string, string]>;
  replicas?: number;
  hasPorts: boolean;
  /** Dockerfile path relative to the project root, when the service builds one. */
  dockerfile?: string;
  /** Optional services (docker compose --profile …). */
  profiles: string[];
}

type Raw = Record<string, unknown>;

const asRecord = (v: unknown): Raw | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : undefined);
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * Compose's variable substitution: ${VAR}, ${VAR:-default}, ${VAR-default} and $VAR,
 * with values from the .env file next to the compose file. "$$" is a literal "$".
 */
export function interpolate(text: string, vars: Map<string, string>): string {
  return text.replace(/\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?])([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, name, op, fallback, bare) => {
    if (m === '$$') return '$';
    const key = (name ?? bare) as string;
    const value = vars.get(key);
    if (op === ':-' || op === ':?') return value ? value : op === ':-' ? (fallback ?? '') : '';
    if (op === '-' || op === '?') return value !== undefined ? value : op === '-' ? (fallback ?? '') : '';
    return value ?? '';
  });
}

/** Reads a .env file the way Compose does: later lines can use earlier variables. */
export function composeVars(text: string | undefined): Map<string, string> {
  const vars = new Map<string, string>();
  if (!text) return vars;
  for (const [k, v] of parseEnv(text)) vars.set(k, interpolate(v, vars));
  return vars;
}

function envOf(raw: unknown, vars: Map<string, string>): Array<[string, string]> {
  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is string => typeof x === 'string')
      .map((line) => {
        const i = line.indexOf('=');
        // "- KAFKA_ADDR" with no value passes the variable through from .env.
        return (i < 0 ? [line, vars.get(line) ?? ''] : [line.slice(0, i), line.slice(i + 1)]) as [string, string];
      });
  }
  const rec = asRecord(raw);
  return rec ? Object.entries(rec).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)] as [string, string]) : [];
}

/**
 * The compose files that describe the app. When the project root (or the
 * shallowest folder with compose files) has a main docker-compose.yml or
 * compose.yaml, we use it and its override; variants like docker-compose.test.yml
 * or prod.yml are only used when there is no main file.
 */
export function primaryComposeFiles(files: RepoFile[]): RepoFile[] {
  if (files.length === 0) return [];
  const depth = (f: RepoFile) => f.path.split('/').length;
  const top = Math.min(...files.map(depth));
  const shallow = files.filter((f) => depth(f) === top);
  const name = (f: RepoFile) => f.path.slice(f.path.lastIndexOf('/') + 1).toLowerCase();
  const main = shallow.filter((f) => /^(docker-)?compose\.ya?ml$/.test(name(f)));
  if (main.length === 0) return shallow.filter((f) => !/(test|ci|e2e)/.test(name(f))).slice(0, 1);
  return [...main, ...shallow.filter((f) => /^(docker-)?compose\.override\.ya?ml$/.test(name(f)))];
}

/**
 * Reads every compose file. Later files override earlier ones for the same service,
 * the way `docker compose -f a.yml -f b.yml` does. Returns services and any parse errors.
 */
export function readCompose(files: RepoFile[], all: Map<string, RepoFile>): { services: ComposeService[]; notes: string[]; used: string[] } {
  const services = new Map<string, ComposeService>();
  const notes: string[] = [];
  const used: string[] = [];
  // Base files before overrides.
  const ordered = [...files].sort((a, b) => Number(/override/.test(a.path)) - Number(/override/.test(b.path)) || a.path.length - b.path.length);

  for (const file of ordered) {
    const vars = composeVars(all.get(joinPath(dirOf(file.path), '.env'))?.content);
    let doc: unknown;
    try {
      doc = parse(interpolate(file.content, vars));
    } catch {
      notes.push(`Couldn't read ${file.path}; it isn't valid YAML.`);
      continue;
    }
    const raw = asRecord(asRecord(doc)?.services);
    if (!raw) continue;
    used.push(file.path);
    const base = dirOf(file.path);

    for (const [name, value] of Object.entries(raw)) {
      const svc = asRecord(value) ?? {};
      const prev = services.get(name);
      const build = svc.build;
      const buildRec = asRecord(build);
      const context = typeof build === 'string' ? build : typeof buildRec?.context === 'string' ? buildRec.context : buildRec ? '.' : undefined;
      const command = Array.isArray(svc.command) ? asList(svc.command).join(' ') : typeof svc.command === 'string' ? svc.command : undefined;
      const dependsRaw = svc.depends_on;
      const dependsOn = Array.isArray(dependsRaw) ? asList(dependsRaw) : Object.keys(asRecord(dependsRaw) ?? {});
      const links = asList(svc.links).map((l) => l.split(':')[0]!);

      const env = envOf(svc.environment, vars);
      const envFiles = typeof svc.env_file === 'string' ? [svc.env_file] : asList(svc.env_file);
      for (const f of envFiles) {
        const envFile = all.get(joinPath(base, f));
        if (envFile) env.push(...parseEnv(envFile.content));
      }
      const replicas = Number(asRecord(svc.deploy)?.replicas);
      const dockerfile = typeof buildRec?.dockerfile === 'string' ? buildRec.dockerfile : 'Dockerfile';

      services.set(name, {
        name,
        file: file.path,
        image: typeof svc.image === 'string' ? svc.image : prev?.image,
        buildDir: context !== undefined ? joinPath(base, context) : prev?.buildDir,
        command: command ?? prev?.command,
        dependsOn: [...new Set([...(prev?.dependsOn ?? []), ...dependsOn, ...links])],
        env: [...(prev?.env ?? []), ...env],
        ...(Number.isInteger(replicas) && replicas > 0 ? { replicas } : prev?.replicas ? { replicas: prev.replicas } : {}),
        hasPorts: Boolean(svc.ports) || Boolean(prev?.hasPorts),
        ...(context !== undefined ? { dockerfile: joinPath(joinPath(base, context), dockerfile) } : prev?.dockerfile ? { dockerfile: prev.dockerfile } : {}),
        profiles: asList(svc.profiles).length ? asList(svc.profiles) : (prev?.profiles ?? []),
      });
    }
  }
  return { services: [...services.values()], notes, used };
}

export interface ImageMatch {
  tech?: string;
  /** Not shown on the canvas, with a reason. */
  skip?: string;
  note?: string;
  kind?: Kind;
}

const DEV_TOOLS =
  /^(adminer|dpage\/pgadmin4|pgadmin|mailhog\/mailhog|mailhog|axllent\/mailpit|mailpit|rediscommander\/redis-commander|redis-commander|provectuslabs\/kafka-ui|kafka-ui|obsidiandynamics\/kafdrop|jaegertracing\/[\w-]+|prom\/prometheus|grafana\/[\w-]+|otel\/[\w-]+|portainer\/[\w-]+|mongo-express|phpmyadmin|redis\/redisinsight|maildev\/maildev)$/;

/** What a container image is. Registry and tag are ignored: "docker.io/library/postgres:16-alpine" → postgres. */
export function matchImage(image: string): ImageMatch {
  let repo = image.split('@')[0]!.replace(/:[^/]*$/, '').toLowerCase();
  repo = repo.replace(/^(docker\.io\/|registry\.hub\.docker\.com\/|public\.ecr\.aws\/|ghcr\.io\/|quay\.io\/|mcr\.microsoft\.com\/)/, '').replace(/^library\//, '');
  const last = repo.split('/').pop()!;

  if (/opentelemetry-collector|^otel\/|jaeger|zipkin|tempo|loki|fluent-?bit|fluentd|datadog\/agent|newrelic/.test(repo)) return { skip: 'an observability tool' };
  if (DEV_TOOLS.test(repo) || DEV_TOOLS.test(last)) return { skip: 'a local development tool' };
  if (/zookeeper/.test(repo)) return { skip: 'part of Kafka' };
  if (/localstack/.test(repo)) return { skip: 'a local AWS emulator' };
  if (/^(postgres|postgis\/postgis|timescale\/timescaledb[\w-]*|bitnami\/postgresql|supabase\/postgres|ankane\/pgvector|pgvector\/pgvector)$/.test(repo)) return { tech: 'postgresql', kind: 'postgres' };
  if (/^(mysql|mariadb|bitnami\/mysql|bitnami\/mariadb|percona)$/.test(repo)) return { tech: 'mysql', kind: 'mysql' };
  if (/^(mongo|bitnami\/mongodb|mongodb\/mongodb-community-server)$/.test(repo)) return { tech: 'mongodb', kind: 'mongodb' };
  if (/^(redis|redis\/redis-stack[\w-]*|bitnami\/redis|eqalpha\/keydb|redislabs\/[\w-]+|redis\/[\w-]+)$/.test(repo)) return { tech: 'redis', kind: 'redis' };
  if (/^(valkey\/valkey|valkey-io\/valkey|bitnami\/valkey)$/.test(repo)) return { tech: 'valkey', kind: 'redis' };
  if (/^(memcached|bitnami\/memcached)$/.test(repo)) return { tech: 'memcached', kind: 'memcached' };
  if (/^(rabbitmq|bitnami\/rabbitmq)$/.test(repo)) return { tech: 'rabbitmq', kind: 'rabbitmq' };
  if (/^(confluentinc\/cp-kafka|confluentinc\/cp-server|bitnami\/kafka|apache\/kafka[\w-]*|wurstmeister\/kafka|ubuntu\/kafka)$/.test(repo)) return { tech: 'kafka', kind: 'kafka' };
  if (/redpanda/.test(repo)) return { tech: 'redpanda', kind: 'kafka' };
  if (/^(nginx|nginxinc\/[\w-]+|bitnami\/nginx)$/.test(repo)) return { tech: 'nginx' };
  if (/^(haproxy|haproxytech\/haproxy[\w-]*)$/.test(repo)) return { tech: 'haproxy' };
  if (/^traefik$/.test(repo)) return { tech: 'nginx', note: 'Traefik is modeled as Nginx (a similar reverse proxy).' };
  if (/^envoyproxy\/envoy[\w-]*$/.test(repo)) return { tech: 'nginx', note: 'Envoy is modeled as Nginx (a similar proxy).' };
  if (/^caddy$/.test(repo)) return { tech: 'nginx', note: 'Caddy is modeled as Nginx (a similar reverse proxy).' };
  if (/^(kong|kong\/kong-gateway)$/.test(repo)) return { tech: 'kong' };
  if (/^(minio\/minio|bitnami\/minio)$/.test(repo)) return { tech: 'aws-s3', kind: 's3', note: 'MinIO is modeled as S3 (it speaks the same API).' };
  if (/elasticsearch|opensearch|cassandra|flagd|unleash|growthbook|minio\/mc|scylla|clickhouse|neo4j|qdrant|weaviate|milvus|nats|pulsar|keycloak|vault|consul|etcd/.test(repo)) {
    return { skip: "not in ScaleLab's catalog yet" };
  }
  return {};
}

/**
 * A last resort when the image is unknown: a service named after what it is.
 * "redis" running "acme/custom-redis" is very likely Redis.
 */
export function matchServiceName(name: string): ImageMatch {
  const n = name.toLowerCase();
  if (/^(postgres|postgresql|pg)$/.test(n)) return { tech: 'postgresql', kind: 'postgres' };
  if (/^(mysql|mariadb)$/.test(n)) return { tech: 'mysql', kind: 'mysql' };
  if (/^(mongo|mongodb)$/.test(n)) return { tech: 'mongodb', kind: 'mongodb' };
  if (/^redis$/.test(n)) return { tech: 'redis', kind: 'redis' };
  if (/^(kafka|broker)$/.test(n)) return { tech: 'kafka', kind: 'kafka' };
  if (/^rabbit(mq)?$/.test(n)) return { tech: 'rabbitmq', kind: 'rabbitmq' };
  return {};
}

/** The language a Dockerfile's base image is for, when we can tell. */
export function languageOfImage(image: string): string | undefined {
  const repo = image.split('@')[0]!.replace(/:[^/]*$/, '').toLowerCase().split('/').pop()!;
  const known: Array<[RegExp, string]> = [
    [/^ruby/, 'Ruby'],
    [/^rust/, 'Rust'],
    [/^php/, 'PHP'],
    [/^(gcc|clang)/, 'C++'],
    [/^elixir/, 'Elixir'],
    [/^(erlang)/, 'Erlang'],
    [/^(swift)/, 'Swift'],
    [/^(dart)/, 'Dart'],
    [/^(node)/, 'Node.js'],
    [/^(python)/, 'Python'],
    [/^(golang)/, 'Go'],
    [/^(eclipse-temurin|openjdk|amazoncorretto|gradle|maven)/, 'Java'],
    [/^(dotnet|aspnet|sdk|runtime)$/, '.NET'],
  ];
  return known.find(([re]) => re.test(repo))?.[1];
}

/** All base images in a Dockerfile, first stage first. */
export function dockerfileImages(text: string): string[] {
  return [...text.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/gim)].map((m) => m[1]!);
}

/** The base image of the final stage of a Dockerfile: "FROM nginx:1.27 AS web" → "nginx:1.27". */
export function dockerfileImage(text: string): string | undefined {
  let image: string | undefined;
  for (const m of text.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/gim)) image = m[1];
  return image;
}

/** Kinds an env list points at, with the key as evidence. */
export function envKinds(env: Array<[string, string]>): Map<Kind, string> {
  const out = new Map<Kind, string>();
  for (const [k, v] of env) {
    const kind = kindOfEnv(k, v);
    if (kind && !out.has(kind)) out.set(kind, k);
  }
  return out;
}
