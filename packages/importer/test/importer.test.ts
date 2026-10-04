import { getLibrary, resolveArchetype } from '@scalelab/catalog';
import { simulate } from '@scalelab/engine';
import { type Design, deriveFlows, derivedMix, validateDesign } from '@scalelab/model';
import { describe, expect, it } from 'vitest';
import { type ImportResult, analyzeProject, layout, pickFiles, toDesign } from '../src';
import { matchImage } from '../src/compose';
import { hostsIn, kindOfEnv, parseEnv } from '../src/env';
import { prismaProvider } from '../src/manifests';
import { djangoCelery, flaskAndDotnet, nextFullStack, nodeShop, polyglot } from './fixtures';

const comp = (r: ImportResult, key: string) => r.components.find((c) => c.key === key);
const tech = (r: ImportResult) => Object.fromEntries(r.components.map((c) => [c.key, c.technologyId]));
const linked = (r: ImportResult, from: string, to: string) => r.links.some((l) => l.from === from && l.to === to);

/** Builds the imported design and runs 5 seconds of traffic through it. */
function runImported(r: ImportResult) {
  const parts = toDesign(r);
  const { flows, handlers } = deriveFlows(parts.nodes, parts.edges, resolveArchetype);
  const design: Design = {
    schemaVersion: 1,
    meta: { name: parts.name, description: '', createdAt: new Date(0).toISOString() },
    nodes: parts.nodes,
    edges: parts.edges,
    flows,
    handlers,
    workloads: [],
  };
  const errors = validateDesign(design, resolveArchetype).filter((i) => i.severity === 'error');
  const result = simulate(design, { id: 'w', name: 'w', durationSec: 5, pattern: { kind: 'constant', rps: 100 }, mix: derivedMix(flows), seed: 1 }, {
    libraryEffect: (id) => getLibrary(id)?.effect,
  });
  return { parts, flows, errors, result };
}

describe('docker-compose + Node services', () => {
  const r = analyzeProject(nodeShop, 'shop');

  it('finds every app and container with the right technology', () => {
    expect(tech(r)).toEqual({
      nginx: 'nginx',
      db: 'postgresql',
      cache: 'redis',
      kafka: 'kafka',
      web: 'nextjs',
      api: 'nestjs',
      stripe: 'stripe',
      worker: 'kafka-consumer',
      sendgrid: 'sendgrid',
    });
    expect(comp(r, 'api')!.instances).toBe(3);
    expect(comp(r, 'api')!.libraries).toEqual(expect.arrayContaining(['prisma', 'ioredis', 'kafkajs', 'passport']));
    expect(comp(r, 'web')!.libraries).toEqual(expect.arrayContaining(['tailwind-css', 'tanstack-query']));
  });

  it('connects apps to what they use, and workers to the stream they read', () => {
    expect(linked(r, 'api', 'db')).toBe(true);
    expect(linked(r, 'api', 'cache')).toBe(true);
    expect(linked(r, 'api', 'kafka')).toBe(true);
    expect(linked(r, 'api', 'stripe')).toBe(true);
    expect(linked(r, 'kafka', 'worker')).toBe(true);
    expect(linked(r, 'worker', 'sendgrid')).toBe(true);
    expect(linked(r, 'nginx', 'api')).toBe(true);
    expect(linked(r, 'web', 'nginx')).toBe(true);
    expect(r.links.find((l) => l.from === 'api' && l.to === 'db')!.evidence).toMatch(/Prisma datasource "postgresql"/);
  });

  it('skips dev tools and Kafka internals, and says so', () => {
    expect(r.notes).toEqual(expect.arrayContaining([expect.stringMatching(/zookeeper.*part of Kafka/), expect.stringMatching(/mailhog.*development tool/)]));
    expect(comp(r, 'zookeeper')).toBeUndefined();
  });

  it('builds a design that validates and simulates', () => {
    const { parts, flows, errors, result } = runImported(r);
    expect(parts.dropped).toEqual([]);
    expect(errors).toEqual([]);
    expect(flows.length).toBeGreaterThan(0);
    expect(result.totals.completed).toBeGreaterThan(300);
    expect(result.totals.messagesConsumed).toBeGreaterThan(0);
  });
});

describe('Django + Celery', () => {
  const r = analyzeProject(djangoCelery, 'shop');

  it('models Celery on Redis as a job queue that the web app feeds and workers drain', () => {
    expect(comp(r, 'web')!.technologyId).toBe('django');
    expect(comp(r, 'web')!.libraries).toContain('django-orm');
    expect(comp(r, 'worker')!.technologyId).toBe('celery');
    expect(comp(r, 'job-queue')!.technologyId).toBe('redis-queue');
    expect(linked(r, 'web', 'job-queue')).toBe(true);
    expect(linked(r, 'job-queue', 'worker')).toBe(true);
    expect(linked(r, 'worker', 'db')).toBe(true);
    expect(linked(r, 'users', 'web')).toBe(true);
  });

  it('folds a Redis that only holds jobs into the job queue, and skips beat', () => {
    expect(comp(r, 'redis')).toBeUndefined();
    expect(r.notes).toEqual(expect.arrayContaining([expect.stringMatching(/holds the job queue/), expect.stringMatching(/beat.*scheduler/)]));
  });

  it('simulates', () => {
    const { errors, result } = runImported(r);
    expect(errors).toEqual([]);
    expect(result.totals.messagesConsumed).toBeGreaterThan(0);
  });
});

describe('services without docker-compose', () => {
  it('shares one database and one stream between services, and starts traffic at both', () => {
    const r = analyzeProject(polyglot, 'acme');
    expect(tech(r)).toMatchObject({ 'orders-service': 'spring-boot', inventory: 'go-gin', postgresql: 'postgresql', 'apache-kafka': 'kafka', redis: 'redis' });
    expect(r.components.filter((c) => c.technologyId === 'postgresql')).toHaveLength(1);
    expect(comp(r, 'orders-service')!.libraries).toEqual(['spring-data-jpa', 'spring-kafka', 'resilience4j']);
    expect(linked(r, 'users', 'orders-service') && linked(r, 'users', 'inventory')).toBe(true);
    expect(r.notes).toEqual([expect.stringMatching(/Nothing reads from Apache Kafka/)]);
    expect(runImported(r).errors).toEqual([]);
  });

  it('splits a full-stack Next.js app into the frontend and its server code', () => {
    const r = analyzeProject(nextFullStack, 'saas');
    const server = comp(r, 'saas-starter-server')!;
    expect(server.confidence).toBe('guess');
    expect(server.note).toMatch(/modeled as a Node backend/);
    expect(server.libraries).toEqual(['prisma', 'zod']);
    expect(comp(r, 'saas-starter')!.libraries).toEqual(['nextauth', 'tailwind-css']);
    expect(linked(r, 'saas-starter', 'saas-starter-server')).toBe(true);
    expect(linked(r, 'saas-starter-server', 'postgresql')).toBe(true);
    expect(runImported(r).result.totals.completed).toBeGreaterThan(300);
  });

  it('reads Poetry and .csproj, models Flask as FastAPI, and skips tooling', () => {
    const r = analyzeProject(flaskAndDotnet, 'mixed');
    expect(comp(r, 'api')!.technologyId).toBe('fastapi');
    expect(comp(r, 'api')!.note).toMatch(/Flask is modeled as FastAPI/);
    expect(comp(r, 'billing')!.technologyId).toBe('aspnet-core');
    expect(linked(r, 'billing', 'stripe')).toBe(true);
    expect(linked(r, 'api', 'mongodb')).toBe(true);
    expect(comp(r, 'tools')).toBeUndefined();
    expect(r.notes).toEqual([expect.stringMatching(/Skipped tools/)]);
  });

  it('says so when it finds nothing', () => {
    const r = analyzeProject([{ path: 'README.md', content: '# hi' }], 'empty');
    expect(r.components).toEqual([]);
    expect(r.notes[0]).toMatch(/Nothing we recognize/);
  });
});

describe('building the canvas', () => {
  it('lays components out top-down from where traffic starts', () => {
    const r = analyzeProject(nodeShop, 'shop');
    const { nodes } = toDesign(r);
    const y = (id: string) => nodes.find((n) => n.id === id)!.position.y;
    expect(y('web')).toBeLessThan(y('nginx'));
    expect(y('nginx')).toBeLessThan(y('api'));
    expect(y('api')).toBeLessThan(y('db'));
    expect(y('kafka')).toBeLessThan(y('worker'));
    const xs = nodes.filter((n) => n.position.y === y('db')).map((n) => n.position.x);
    expect(new Set(xs).size).toBe(xs.length); // no overlaps in a row
  });

  it('leaves out excluded components and their links', () => {
    const r = analyzeProject(nodeShop, 'shop');
    const { nodes, edges } = toDesign(r, new Set(['stripe', 'worker']));
    expect(nodes.map((n) => n.id)).not.toContain('stripe');
    expect(edges.some((e) => e.target === 'stripe' || e.source === 'worker' || e.target === 'worker')).toBe(false);
  });

  it('drops links the canvas does not allow, with the reason', () => {
    const r: ImportResult = {
      name: 't',
      components: [
        { key: 'db', technologyId: 'postgresql', label: 'DB', role: 'database', libraries: [], evidence: [], confidence: 'high' },
        { key: 'cache', technologyId: 'redis', label: 'Cache', role: 'cache', libraries: [], evidence: [], confidence: 'high' },
      ],
      links: [{ from: 'db', to: 'cache', evidence: 'x' }],
      notes: [],
      filesUsed: [],
    };
    expect(toDesign(r).dropped).toEqual([expect.stringMatching(/^DB → Cache: /)]);
  });

  it('survives cycles', () => {
    const c = (key: string) => ({ key, technologyId: 'express', label: key, role: 'service' as const, libraries: [], evidence: [], confidence: 'high' as const });
    const edge = (s: string, t: string) => ({ id: `${s}${t}`, source: s, target: t, protocol: 'http' as const, networkLatency: { kind: 'constant' as const, valueMs: 1 } });
    const pos = layout([c('a'), c('b')], [edge('a', 'b'), edge('b', 'a')]);
    expect(pos.size).toBe(2);
  });
});

describe('reading files', () => {
  it('picks manifests and skips dependencies, tests, examples and deep paths', () => {
    expect(
      pickFiles([
        'package.json',
        'node_modules/express/package.json',
        'apps/api/package.json',
        'apps/api/test/package.json',
        'examples/demo/package.json',
        'services/billing/requirements/base.txt',
        'services/billing/README.md',
        'deploy/compose.prod.yaml',
        'a/b/c/d/e/f/package.json',
        '.github/workflows/package.json',
        'infra/Billing.csproj',
        'web/.env.example',
      ]),
    ).toEqual(['package.json', 'deploy/compose.prod.yaml', 'infra/Billing.csproj', 'web/.env.example', 'apps/api/package.json', 'services/billing/requirements/base.txt']);
  });

  it('parses env files and finds what they point at', () => {
    expect(parseEnv('export A="1"\n# c\nB=two # note\nC=\'x y\'')).toEqual([['A', '1'], ['B', 'two'], ['C', 'x y']]);
    expect(kindOfEnv('DATABASE_URL', 'postgresql://u:p@db/x')).toBe('postgres');
    expect(kindOfEnv('CELERY_BROKER_URL', 'redis://redis:6379/0')).toBe('jobs');
    expect(kindOfEnv('CACHE_URL', 'redis://redis:6379/1')).toBe('redis');
    expect(kindOfEnv('KAFKA_BOOTSTRAP_SERVERS', 'kafka:9092')).toBe('kafka');
    expect(kindOfEnv('STRIPE_SECRET_KEY', 'sk')).toBe('stripe');
    expect(kindOfEnv('PORT', '3000')).toBeUndefined();
    expect(hostsIn('postgres://app:secret@db:5432/shop')).toEqual(['db']);
    expect(hostsIn('kafka-1:9092,kafka-2:9092')).toEqual(['kafka-1', 'kafka-2']);
  });

  it('recognizes container images regardless of registry and tag', () => {
    expect(matchImage('docker.io/library/postgres:16-alpine').tech).toBe('postgresql');
    expect(matchImage('bitnami/kafka:3.7').tech).toBe('kafka');
    expect(matchImage('redpandadata/redpanda:v24.1.1').tech).toBe('redpanda');
    expect(matchImage('traefik:v3.0').note).toMatch(/Traefik/);
    expect(matchImage('dpage/pgadmin4').skip).toMatch(/development tool/);
    expect(matchImage('elasticsearch:8.14.0').skip).toMatch(/catalog/);
    expect(matchImage('acme/api:latest')).toEqual({});
  });

  it('reads the Prisma datasource provider', () => {
    expect(prismaProvider('generator x { provider = "prisma-client-js" }\ndatasource db {\n provider = "mysql"\n}')).toBe('mysql');
  });
});

describe('lessons from real projects', () => {
  const f = (o: Record<string, string>) => Object.entries(o).map(([path, content]) => ({ path, content }));

  it('uses the main compose file over test variants, and reads Dockerfiles for custom builds', () => {
    const r = analyzeProject(
      f({
        'docker-compose.yml': 'services:\n  proxy:\n    build: ./proxy\n    ports: ["80:80"]\n    depends_on: [vote]\n  vote:\n    build: ./vote\n    ports: ["5000:80"]\n    depends_on: [redis]\n  worker:\n    build: ./worker\n    depends_on: [redis, db, vote]\n  seed:\n    build: ./seed\n    profiles: [seed]\n  redis:\n    image: redis:alpine\n  db:\n    image: postgres:15\n',
        'vote/docker-compose.test.yml': 'services:\n  vote:\n    build: .\n    depends_on: [db]\n  db:\n    image: mysql:8\n',
        'proxy/Dockerfile': 'FROM node:20 AS build\nRUN echo hi\nFROM nginx:1.27-alpine\nCOPY . /usr/share/nginx/html\n',
        'vote/requirements.txt': 'Flask\nredis\n',
        'worker/Worker.csproj': '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Npgsql" Version="8" /><PackageReference Include="StackExchange.Redis" Version="2" /></ItemGroup></Project>',
      }),
      'voting',
    );
    expect(tech(r)).toMatchObject({ proxy: 'nginx', vote: 'fastapi', worker: 'background-worker', redis: 'redis', db: 'postgresql' });
    expect(comp(r, 'proxy')!.evidence[0]).toBe('FROM nginx:1.27-alpine in proxy/Dockerfile');
    expect(comp(r, 'worker')!.confidence).toBe('guess');
    expect(linked(r, 'worker', 'db') && linked(r, 'worker', 'redis')).toBe(true);
    expect(linked(r, 'worker', 'vote')).toBe(false); // depends_on is start-up order, not a call
    expect(linked(r, 'users', 'proxy') && linked(r, 'proxy', 'vote')).toBe(true);
    expect(r.notes).toEqual([expect.stringMatching(/"seed": it only runs with the "seed" profile/)]);
  });

  it('treats gRPC-only projects as services, skips load generators and Flower', () => {
    const r = analyzeProject(
      f({
        'docker-compose.yml': 'services:\n  worker:\n    build: ./app\n    command: celery -A app worker\n  flower:\n    build: ./app\n    command: celery -A app flower\n  redis:\n    image: redis:7\n',
        'app/requirements.txt': 'celery\nredis\n',
        'checkout/go.mod': 'module example.com/checkout\n\nrequire google.golang.org/grpc v1.64.0\n',
        'loadgen/requirements.txt': 'locust\n',
      }),
      'grpc',
    );
    expect(comp(r, 'checkout')!.technologyId).toBe('go-gin');
    expect(comp(r, 'checkout')!.evidence[0]).toMatch(/grpc/);
    expect(comp(r, 'loadgen')).toBeUndefined();
    expect(comp(r, 'flower')).toBeUndefined();
    expect(r.notes).toEqual(expect.arrayContaining([expect.stringMatching(/load-testing tool/), expect.stringMatching(/Flower is a dashboard/)]));
  });

  it('says when it could not see calls between many services, and groups skipped packages', () => {
    const svc = (name: string) => [`${name}/go.mod`, 'module x/' + name + '\nrequire github.com/gin-gonic/gin v1.10.0\n'];
    const lib = (name: string) => [`packages/${name}/package.json`, JSON.stringify({ name })];
    const r = analyzeProject(f(Object.fromEntries([...['a', 'b', 'c', 'd'].map(svc), ...['ui', 'utils', 'config', 'types', 'eslint'].map(lib)])), 'many');
    expect(r.notes).toEqual(
      expect.arrayContaining([expect.stringMatching(/traffic starts at all 4/), expect.stringMatching(/Skipped 5 folders \(packages\/ui, packages\/utils, packages\/config, packages\/types, and 1 more\)/)]),
    );
  });
});

describe('layout details', () => {
  it('puts a worker that nothing feeds next to the services, not up with the users', () => {
    const r = analyzeProject(
      [
        { path: 'docker-compose.yml', content: 'services:\n  web:\n    build: ./web\n    ports: ["80:80"]\n    depends_on: [db]\n  worker:\n    build: ./worker\n    depends_on: [db]\n  db:\n    image: postgres\n' },
        { path: 'web/requirements.txt', content: 'fastapi\n' },
        { path: 'worker/requirements.txt', content: 'psycopg2\n' },
      ],
      'x',
    );
    const { nodes } = toDesign(r);
    const y = (id: string) => nodes.find((n) => n.id === id)!.position.y;
    expect(y('worker')).toBe(y('web'));
    expect(y('users')).toBeLessThan(y('worker'));
  });
});
