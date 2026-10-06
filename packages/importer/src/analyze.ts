import { getTechnology } from '@scalelab/catalog';
import type { Archetype } from '@scalelab/model';
import { type ComposeService, dockerfileImage, dockerfileImages, envKinds, languageOfImage, matchImage, matchServiceName, primaryComposeFiles, readCompose } from './compose';
import { hostsIn, kindOfEnv, parseEnv } from './env';
import { baseName, dirOf, isComposeFile, normalizePath } from './files';
import { type Unit, readUnits } from './manifests';
import { BROKER_KINDS, type DetectedComponent, type DetectedLink, type ImportResult, KIND_TECH, type Kind, type RepoFile, type Role } from './types';

/**
 * The app a compose service builds. Monorepos often build from the root with
 * "dockerfile: src/cart/Dockerfile", so we look from the Dockerfile's folder up
 * to the build folder and take the nearest app.
 */
function unitForService(svc: ComposeService, units: Unit[]): Unit | undefined {
  if (svc.buildDir === undefined) return undefined;
  const byDir = new Map(units.map((u) => [u.dir, u]));
  if (svc.dockerfile && (svc.buildDir === '' || svc.dockerfile.startsWith(`${svc.buildDir}/`))) {
    const start = dirOf(svc.dockerfile);
    for (let dir = start; ; dir = dirOf(dir)) {
      const u = byDir.get(dir);
      // A monorepo's root package.json is tooling, not the app this Dockerfile builds.
      if (u && (dir !== '' || start === '')) return u;
      if (dir === svc.buildDir || dir === '') break;
    }
    if (start !== svc.buildDir) return undefined;
  }
  return byDir.get(svc.buildDir);
}

const ENV_FILE = /^\.env(\.(example|sample|template|dist|local\.example|development|dev))?$/;
const EXTERNAL_KINDS = new Set<Kind>(['stripe', 'paypal', 'razorpay', 'twilio', 'sendgrid', 'openai', 'auth0', 'clerk']);
const AUTH_KINDS = new Set<Kind>(['auth0', 'clerk']);
/** Libraries that run on a server; the rest (UI, state, styling) stay with the frontend. */
const SERVER_LIBRARIES = new Set(['prisma', 'typeorm', 'ioredis', 'kafkajs', 'amqplib', 'passport', 'opentelemetry-sdk', 'zod']);
const NEXT_SERVER_NOTE = 'Next.js server code (API routes and server actions) is modeled as a Node backend next to the frontend.';

/** A sensible stand-in when a server has no framework we recognize. */
const DEFAULT_SERVER: Record<Unit['ecosystem'], string> = {
  node: 'express',
  python: 'fastapi',
  java: 'spring-boot',
  go: 'go-gin',
  dotnet: 'aspnet-core',
};

function roleOf(technologyId: string): Role {
  const archetype: Archetype | undefined = getTechnology(technologyId)?.archetype;
  switch (archetype) {
    case 'client':
      return 'frontend';
    case 'load-balancer':
    case 'gateway':
    case 'cdn':
      return 'proxy';
    case 'worker':
      return 'worker';
    case 'cache':
      return 'cache';
    case 'relational-db':
    case 'document-db':
    case 'wide-column-db':
      return 'database';
    case 'message-queue':
    case 'event-stream':
      return 'queue';
    case 'object-storage':
      return 'storage';
    case 'external-api':
    case 'auth-provider':
      return 'external';
    default:
      return 'service';
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'component';

interface AppParts {
  frontend?: string;
  server?: string;
  worker?: string;
}

/**
 * Reads a project's manifests, compose files and env examples and works out
 * its components and how they connect. Pure: no network, no file system.
 */
export function analyzeProject(input: RepoFile[], projectName: string): ImportResult {
  const files = input.map((f) => ({ path: normalizePath(f.path), content: f.content }));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const notes: string[] = [];
  const filesUsed = new Set<string>();

  const components = new Map<string, DetectedComponent>();
  const links: DetectedLink[] = [];
  const linkSeen = new Set<string>();
  const kindComp = new Map<Kind, string>();

  // ─── Helpers ───────────────────────────────────────────────────────────────
  const uniqueKey = (base: string) => {
    let key = slug(base);
    for (let i = 2; components.has(key); i++) key = `${slug(base)}-${i}`;
    return key;
  };
  const add = (c: Omit<DetectedComponent, 'key' | 'role'> & { key?: string }): string => {
    const key = c.key ?? uniqueKey(c.label);
    components.set(key, { ...c, key, role: roleOf(c.technologyId) });
    return key;
  };
  const link = (from: string | undefined, to: string | undefined, evidence: string) => {
    if (!from || !to || from === to) return;
    const id = `${from}>${to}`;
    if (linkSeen.has(id)) return;
    linkSeen.add(id);
    links.push({ from, to, evidence });
  };
  const roleIs = (key: string, ...roles: Role[]) => roles.includes(components.get(key)!.role);

  // ─── Read everything ───────────────────────────────────────────────────────
  const units = readUnits(files, projectName);
  for (const u of units) {
    for (const m of u.manifests) filesUsed.add(m);
    notes.push(...u.notes);
  }

  const envFiles = files.filter((f) => ENV_FILE.test(baseName(f.path)));
  const envByDir = new Map<string, Map<Kind, string>>();
  for (const f of envFiles) {
    const kinds = envByDir.get(dirOf(f.path)) ?? new Map<Kind, string>();
    for (const [k, v] of parseEnv(f.content)) {
      const kind = kindOfEnv(k, v);
      if (kind && !kinds.has(kind)) {
        kinds.set(kind, `${k} in ${f.path}`);
        filesUsed.add(f.path);
      }
    }
    envByDir.set(dirOf(f.path), kinds);
  }

  const composeFiles = primaryComposeFiles(files.filter((f) => isComposeFile(baseName(f.path))));
  const compose = readCompose(composeFiles, byPath);
  // Optional services (profiles) and Celery Flower dashboards aren't part of the running app.
  compose.services = compose.services.filter((svc) => {
    if (svc.profiles.length > 0) {
      notes.push(`Skipped "${svc.name}": it only runs with the "${svc.profiles[0]}" profile.`);
      return false;
    }
    if (/\bflower\b/.test(svc.command ?? '') || /flower/.test(svc.image ?? '')) {
      notes.push(`Skipped "${svc.name}": Flower is a dashboard for Celery.`);
      return false;
    }
    return true;
  });
  notes.push(...compose.notes);
  for (const f of compose.used) filesUsed.add(f);
  const hasCompose = compose.services.length > 0;

  // Infra containers first, so apps can link to them by kind.
  const svcKey = new Map<string, string>();
  const svcApp = new Map<string, AppParts>();
  const svcUnit = new Map<string, Unit>();
  for (const svc of compose.services) {
    const unit = unitForService(svc, units);
    if (unit) continue;
    const dockerfile = svc.dockerfile ? byPath.get(svc.dockerfile) : undefined;
    const fromImage = dockerfile ? dockerfileImage(dockerfile.content) : undefined;
    // A service that builds is described by its Dockerfile; its image: is just the tag it gets.
    const builds = svc.buildDir !== undefined;
    const image = builds ? (fromImage ?? svc.image) : svc.image;
    if (!image) continue;
    let m = matchImage(image);
    if (!m.tech && !m.skip) {
      const byName = matchServiceName(svc.name);
      if (byName.tech) m = { ...byName, note: `Guessed from the service name; the image "${image}" isn't one we know.` };
    }
    if (builds && !m.tech) continue; // A custom build we can't place; reported below.
    if (builds && dockerfile) filesUsed.add(dockerfile.path);
    if (m.skip) {
      notes.push(`Skipped "${svc.name}" (${image}): ${m.skip}.`);
      continue;
    }
    if (!m.tech) {
      notes.push(`Couldn't tell what "${svc.name}" (${image}) is, so it isn't on the canvas. Add it by hand if it matters.`);
      continue;
    }
    const key = add({
      key: uniqueKey(svc.name),
      technologyId: m.tech,
      label: svc.name,
      libraries: [],
      evidence: [builds ? `FROM ${image} in ${svc.dockerfile}` : `image ${svc.image} in ${svc.file}`],
      confidence: m.note?.startsWith('Guessed') ? 'guess' : 'high',
      ...(m.note ? { note: m.note } : {}),
    });
    svcKey.set(svc.name, key);
    if (m.kind && !kindComp.has(m.kind)) kindComp.set(m.kind, key);
  }

  /** The shared component for something apps talk to, created on first use. */
  const kindTarget = (kind: Kind, evidence: string): string => {
    const existing = kindComp.get(kind);
    if (existing) return existing;
    const tech = KIND_TECH[kind];
    const name = kind === 'jobs' ? 'Job queue' : getTechnology(tech)!.name;
    const external = EXTERNAL_KINDS.has(kind);
    const redis = kind === 'jobs' ? compose.services.find((s) => s.image && matchImage(s.image).kind === 'redis') : undefined;
    const key = add({
      technologyId: tech,
      label: name,
      libraries: [],
      evidence: [evidence, ...(redis ? [`jobs are kept in the "${redis.name}" container`] : [])],
      confidence: external || !hasCompose || kind === 'jobs' ? 'high' : 'guess',
      ...(!external && hasCompose && kind !== 'jobs' && kind !== 's3'
        ? { note: 'No matching container in docker-compose; it may be a managed service (like RDS or ElastiCache).' }
        : {}),
    });
    kindComp.set(kind, key);
    return key;
  };

  const workerTech = (unit: Unit): string => {
    if (unit.worker) return unit.worker.tech;
    if (unit.uses.has('jobs')) return unit.ecosystem === 'node' ? 'bullmq-worker' : 'background-worker';
    if (unit.uses.has('kafka')) return 'kafka-consumer';
    return 'background-worker';
  };
  const usesBroker = (unit: Unit) => BROKER_KINDS.some((k) => unit.uses.has(k));
  const needsServer = (unit: Unit) => [...unit.uses.keys()].some((k) => !AUTH_KINDS.has(k));
  const librariesOf = (unit: Unit, tech: string) => {
    const libs = [...unit.libraries];
    // Django projects talk to their database through the Django ORM.
    if (tech === 'django' && ['postgres', 'mysql'].some((k) => unit.uses.has(k as Kind))) libs.push('django-orm');
    return libs;
  };

  /** Creates the frontend, server and/or worker for one app. */
  const appComponents = (
    unit: Unit,
    label: string,
    opts: { evidence?: string; replicas?: number; forceWorker?: boolean; hasPorts?: boolean; inCompose?: boolean },
  ): AppParts | undefined => {
    if (unit.tool) {
      notes.push(`Skipped "${label}": ${unit.tool}.`);
      return {};
    }
    const parts: AppParts = {};
    const base = opts.evidence ? [opts.evidence] : [];
    const replicas = opts.replicas ? { instances: opts.replicas } : {};
    const makeWorker = (name: string, confidence: 'high' | 'guess', why: string) =>
      add({ technologyId: workerTech(unit), label: name, libraries: librariesOf(unit, workerTech(unit)), evidence: [...base, why], confidence, ...replicas });

    if (opts.forceWorker) {
      parts.worker = makeWorker(label, 'high', unit.worker?.evidence ?? `runs as a worker (${unit.manifests[0]})`);
      return parts;
    }
    if (unit.frontend) {
      const f = unit.frontend;
      const split = f.tech === 'nextjs' && !unit.framework && needsServer(unit);
      const frontendLibs = librariesOf(unit, f.tech).filter((l) => !split || !SERVER_LIBRARIES.has(l));
      parts.frontend = add({ technologyId: f.tech, label, libraries: frontendLibs, evidence: [...base, f.evidence], confidence: 'high', ...(f.note ? { note: f.note } : {}) });
      if (split) {
        parts.server = add({
          technologyId: 'express',
          label: `${label} server`,
          libraries: librariesOf(unit, 'express').filter((l) => SERVER_LIBRARIES.has(l)),
          evidence: [`${f.evidence}, with server-side packages`],
          confidence: 'guess',
          note: NEXT_SERVER_NOTE,
          ...replicas,
        });
        link(parts.frontend, parts.server, 'the frontend calls its own server code');
      }
    }
    if (unit.framework) {
      const fw = unit.framework;
      parts.server = add({
        technologyId: fw.tech,
        label: parts.frontend ? `${label} server` : label,
        libraries: librariesOf(unit, fw.tech),
        evidence: [...base, fw.evidence],
        confidence: 'high',
        ...(fw.note ? { note: fw.note } : {}),
        ...replicas,
      });
      if (parts.frontend) link(parts.frontend, parts.server, 'same app');
    }
    if (!unit.frontend && !unit.framework) {
      if (unit.worker || usesBroker(unit)) {
        parts.worker = makeWorker(label, unit.worker ? 'high' : 'guess', unit.worker?.evidence ?? `no web framework, and it talks to a queue (${unit.manifests[0]})`);
      } else if (opts.inCompose && !opts.hasPorts) {
        parts.worker = makeWorker(label, 'guess', `runs in docker-compose with no web framework and no ports (${unit.manifests[0]})`);
      } else if (opts.hasPorts) {
        const tech = DEFAULT_SERVER[unit.ecosystem];
        parts.server = add({
          technologyId: tech,
          label,
          libraries: librariesOf(unit, tech),
          evidence: [...base, `${unit.manifests[0]}, with ports open`],
          confidence: 'guess',
          note: `No web framework we know was found, so it's modeled as ${getTechnology(tech)!.name}.`,
          ...replicas,
        });
      } else {
        return undefined;
      }
    }
    return parts;
  };

  /** Links an app's parts to what it uses: servers publish to brokers, workers consume from them. */
  const wire = (unit: Unit, parts: AppParts, extra: Map<Kind, string>) => {
    const uses = new Map(unit.uses);
    for (const [k, v] of extra) if (!uses.has(k)) uses.set(k, v);
    for (const [k, v] of envByDir.get(unit.dir) ?? []) if (!uses.has(k)) uses.set(k, v);
    if (units.length === 1) for (const [k, v] of envByDir.get('') ?? []) if (!uses.has(k)) uses.set(k, v);

    // Celery sends tasks through RabbitMQ when the project uses it, otherwise through Redis.
    if (unit.worker?.tech === 'celery') {
      const broker: Kind = uses.has('rabbitmq') ? 'rabbitmq' : 'jobs';
      if (!uses.has(broker)) uses.set(broker, `${unit.worker.evidence} (task broker)`);
      // The redis package in a Celery project is usually just the broker client.
      if (broker === 'jobs' && /^redis in /.test(uses.get('redis') ?? '')) uses.delete('redis');
    }

    for (const [kind, evidence] of uses) {
      const isBroker = BROKER_KINDS.includes(kind);
      if (isBroker) {
        if (!parts.server && !parts.worker) continue;
        const target = kindTarget(kind, evidence);
        if (parts.server) link(parts.server, target, evidence);
        if (parts.worker) link(target, parts.worker, evidence);
        continue;
      }
      if (parts.server || parts.worker) {
        const target = kindTarget(kind, evidence);
        if (parts.server) link(parts.server, target, evidence);
        if (parts.worker) link(parts.worker, target, evidence);
      } else if (parts.frontend && AUTH_KINDS.has(kind)) {
        link(parts.frontend, kindTarget(kind, evidence), evidence);
      }
    }
  };

  // ─── Apps from docker-compose ──────────────────────────────────────────────
  const claimed = new Set<Unit>();
  const workerFromCompose = new Set<Unit>();
  for (const svc of compose.services) {
    const unit = unitForService(svc, units);
    if (!unit) {
      if (svc.buildDir !== undefined && !svcKey.has(svc.name) && svc.hasPorts) {
        const dockerfile = svc.dockerfile ? byPath.get(svc.dockerfile) : undefined;
        const language = dockerfile ? dockerfileImages(dockerfile.content).map(languageOfImage).find(Boolean) : undefined;
        const key = add({
          key: uniqueKey(svc.name),
          technologyId: 'express',
          label: svc.name,
          libraries: [],
          evidence: [`service "${svc.name}" in ${svc.file}, with ports open`],
          confidence: 'guess',
          note: `${language ? `Written in ${language}, which` : 'Its language'} isn't in the catalog yet, so it's modeled as a generic web service.`,
          ...(svc.replicas ? { instances: svc.replicas } : {}),
        });
        svcKey.set(svc.name, key);
        svcApp.set(svc.name, { server: key });
        if (dockerfile) filesUsed.add(dockerfile.path);
        continue;
      }
      if (svc.buildDir !== undefined && !svcKey.has(svc.name)) {
        notes.push(
          `"${svc.name}" builds from ${svc.buildDir || 'the project root'}, but no package.json, requirements.txt, pyproject.toml, pom.xml, build.gradle, go.mod or .csproj was found there, so it isn't on the canvas.`,
        );
      }
      continue;
    }
    claimed.add(unit);
    svcUnit.set(svc.name, unit);
    const command = svc.command ?? '';
    if (/\bcelery\b/.test(command) && /\bbeat\b/.test(command)) {
      notes.push(`Skipped "${svc.name}": Celery beat is a scheduler that only queues tasks on a timer.`);
      continue;
    }
    const forceWorker = /\b(worker|consumer|sidekiq|queue:work|dramatiq|rq\s+worker)\b/i.test(command) || (/\bcelery\b/.test(command) && !/\bflower\b/.test(command));
    if (forceWorker) workerFromCompose.add(unit);
    const parts = appComponents(unit, svc.name, {
      evidence: `service "${svc.name}" in ${svc.file}`,
      ...(svc.replicas ? { replicas: svc.replicas } : {}),
      forceWorker,
      hasPorts: svc.hasPorts,
      inCompose: true,
    });
    if (!parts) {
      notes.push(`Skipped "${svc.name}": no web framework, frontend or worker found in ${unit.manifests.join(', ')}.`);
      continue;
    }
    if (!parts.server && !parts.worker && !parts.frontend) continue; // a tool, already noted
    svcApp.set(svc.name, parts);
    svcKey.set(svc.name, (parts.server ?? parts.worker ?? parts.frontend)!);
    wire(unit, parts, envKindsWithEvidence(svc));
  }

  // A Celery app whose compose file has no worker service still has workers somewhere.
  for (const unit of claimed) {
    if (unit.worker && !workerFromCompose.has(unit)) {
      const worker = add({
        technologyId: unit.worker.tech,
        label: `${unit.name} worker`,
        libraries: [],
        evidence: [unit.worker.evidence],
        confidence: 'guess',
        note: 'No worker service in docker-compose; it may run elsewhere.',
      });
      wire(unit, { worker }, new Map());
    }
  }

  // ─── Apps that aren't in docker-compose ────────────────────────────────────
  const skippedLibraries: string[] = [];
  for (const unit of units) {
    if (claimed.has(unit)) continue;
    const label = unit.name;
    const parts = appComponents(unit, label, {});
    if (!parts) {
      const isRoot = unit.dir === '';
      if (!isRoot || units.length === 1) skippedLibraries.push(unit.dir || 'the project root');
      continue;
    }
    if (!parts.server && !parts.worker && !parts.frontend) continue; // a tool, already noted
    if (unit.worker && (parts.server || parts.frontend) && !parts.worker) {
      parts.worker = add({ technologyId: unit.worker.tech, label: `${label} worker`, libraries: [], evidence: [unit.worker.evidence], confidence: 'high' });
    }
    wire(unit, parts, new Map());
  }

  /** Whether a compose app uses Redis as a cache (not only as a job broker). */
  const usesRedisCache = (svcName: string) => {
    const parts = svcApp.get(svcName);
    const redisKey = kindComp.get('redis');
    return Boolean(redisKey && links.some((l) => l.to === redisKey && (l.from === parts?.server || l.from === parts?.worker)));
  };

  if (skippedLibraries.length > 0) {
    const shown = skippedLibraries.slice(0, 4).join(', ') + (skippedLibraries.length > 4 ? `, and ${skippedLibraries.length - 4} more` : '');
    notes.push(
      skippedLibraries.length === 1
        ? `Skipped ${shown}: no web framework, frontend or worker found. It's probably a shared library or tooling.`
        : `Skipped ${skippedLibraries.length} folders (${shown}): no web framework, frontend or worker found. They're probably shared libraries or tooling.`,
    );
  }

  // ─── Links from docker-compose depends_on and URLs in env ──────────────────
  for (const svc of compose.services) {
    const fromKey = svcKey.get(svc.name);
    if (!fromKey) continue;
    const parts = svcApp.get(svc.name);
    const targets = new Map<string, string>();
    const isWorkerOnly = Boolean(parts?.worker && !parts.server && !parts.frontend);
    for (const d of svc.dependsOn) {
      // depends_on is start-up order. For workers it rarely means "calls"; a URL in env does.
      if (isWorkerOnly && svcApp.has(d)) continue;
      targets.set(d, `depends_on in ${svc.file}`);
    }
    for (const [k, v] of svc.env) for (const h of hostsIn(v)) if (!targets.has(h)) targets.set(h, `${k} in ${svc.file}`);

    for (const [target, evidence] of targets) {
      const toKey = svcKey.get(target);
      if (!toKey || toKey === fromKey) continue;
      const to = components.get(toKey)!;
      const from = components.get(fromKey)!;
      if (to.role === 'frontend' && from.role === 'proxy') {
        // Browsers reach the frontend through the proxy; ScaleLab starts traffic at the frontend.
        link(toKey, fromKey, `${evidence} (the proxy serves the frontend)`);
        continue;
      }
      if (to.role === 'queue') {
        if (parts?.server) link(parts.server, toKey, evidence);
        if (parts?.worker) link(toKey, parts.worker, evidence);
        continue;
      }
      if (to.role === 'cache' && kindComp.has('jobs') && !usesRedisCache(svc.name)) {
        // This Redis holds the job queue, which is already drawn; the app doesn't use it as a cache.
        continue;
      }
      link(fromKey, toKey, evidence);
    }
  }

  // A Redis container that only holds the job queue is shown as the job queue.
  const jobsKey = kindComp.get('jobs');
  const redisKey = kindComp.get('redis');
  if (jobsKey && redisKey && !links.some((l) => l.from === redisKey || l.to === redisKey)) {
    notes.push(`The "${components.get(redisKey)!.label}" container holds the job queue, so it's shown as "${components.get(jobsKey)!.label}".`);
    components.delete(redisKey);
    kindComp.delete('redis');
    for (const [name, key] of svcKey) if (key === redisKey) svcKey.delete(name);
  }
  for (const c of components.values()) {
    if (c.role === 'queue' && !links.some((l) => l.from === c.key)) {
      notes.push(`Nothing reads from ${c.label}: we couldn't tell which service consumes it. Connect a consumer by hand, or messages will pile up.`);
    }
  }

  // ─── Where traffic starts ──────────────────────────────────────────────────
  const all = [...components.values()];
  const incoming = new Map<string, number>();
  for (const l of links) incoming.set(l.to, (incoming.get(l.to) ?? 0) + 1);
  const outgoing = (key: string) => links.filter((l) => l.from === key);

  const services = all.filter((c) => c.role === 'service');
  // Entry proxies sit in front of everything. A proxy that services call (an image
  // server, say) is a backend, not where traffic comes in.
  const proxies = all.filter((c) => c.role === 'proxy' && !links.some((l) => l.to === c.key && !roleIs(l.from, 'frontend')));
  const entries = services.filter((c) => !incoming.get(c.key));
  let clients = all.filter((c) => c.role === 'frontend');

  if (clients.length === 0 && (services.length > 0 || proxies.length > 0)) {
    const users = add({ key: uniqueKey('users'), technologyId: 'web-browser', label: 'Users', libraries: [], evidence: ['added so traffic has a starting point'], confidence: 'high' });
    clients = [components.get(users)!];
  }
  for (const client of clients) {
    const callsBackend = outgoing(client.key).some((l) => roleIs(l.to, 'service', 'proxy'));
    if (callsBackend) continue;
    if (proxies.length > 0) for (const p of proxies) link(client.key, p.key, 'traffic enters through the proxy');
    else for (const s of entries) link(client.key, s.key, 'nothing else calls this service, so users do');
  }
  for (const p of proxies) {
    if (outgoing(p.key).some((l) => roleIs(l.to, 'service'))) continue;
    for (const s of entries) link(p.key, s.key, 'the proxy forwards to services nothing else calls');
  }
  // Services that still have no callers get traffic from the main way in, so they aren't left idle.
  const front = proxies[0] ?? clients[0];
  const orphans = entries.filter((s) => !links.some((l) => l.to === s.key));
  if (front) for (const s of orphans) link(front.key, s.key, 'nothing else calls this service, so users do');

  const wiredEntries = entries.filter((s) => links.some((l) => l.to === s.key && roleIs(l.from, 'frontend', 'proxy')));
  if (orphans.length > 0 && wiredEntries.length > 1) {
    notes.push(
      `We couldn't see who calls ${orphans.length === 1 ? orphans[0]!.label : `${orphans.length} services (${orphans.slice(0, 3).map((o) => o.label).join(', ')}${orphans.length > 3 ? '…' : ''})`}, so traffic goes straight to ${orphans.length === 1 ? 'it' : 'them'}. Draw the calls you know to make the simulation realistic.`,
    );
  } else if (wiredEntries.length > 3) {
    notes.push(
      `We couldn't see which services call each other, so traffic starts at all ${wiredEntries.length} of them. Draw the calls you know (frontend → cart, and so on) to make the simulation realistic.`,
    );
  }

  if (components.size === 0) {
    notes.unshift('Nothing we recognize was found. ScaleLab reads docker-compose files, package.json, requirements.txt, pyproject.toml, pom.xml, build.gradle, go.mod, .csproj and .env examples.');
  }

  return { name: projectName, components: [...components.values()], links, notes, filesUsed: [...filesUsed].sort() };
}

function envKindsWithEvidence(svc: ComposeService): Map<Kind, string> {
  const out = new Map<Kind, string>();
  for (const [kind, key] of envKinds(svc.env)) out.set(kind, `${key} in ${svc.file}`);
  return out;
}
