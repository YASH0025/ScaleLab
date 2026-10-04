import { baseName, dirOf, isRequirementsFile } from './files';
import { type Ecosystem, type Signal, normalizePython, signalFor } from './signals';
import type { Kind, RepoFile } from './types';

/**
 * A unit is one app in the project: a folder with a manifest
 * (package.json, requirements.txt, pom.xml, go.mod…).
 */
export interface Unit {
  dir: string;
  name: string;
  ecosystem: Ecosystem;
  manifests: string[];
  framework?: Found;
  frontend?: Found;
  worker?: Found;
  /** A gRPC server library, used when there's no web framework. */
  grpc?: Found;
  /** Set when the project is a tool, not part of the app. */
  tool?: string;
  /** What it talks to, with the first piece of evidence for each. */
  uses: Map<Kind, string>;
  libraries: Set<string>;
  notes: string[];
}

export interface Found {
  tech: string;
  evidence: string;
  note?: string;
}

interface Dependency {
  name: string;
  /** Where we saw it, like "api/package.json". */
  file: string;
  /** Dev-only dependencies count for libraries, not for what the app is. */
  dev?: boolean;
}

// Earlier entries win when a project has several (Next.js includes React).
const FRONTEND_ORDER = ['nextjs', 'vue', 'angular', 'mobile-app', 'react'];
const FRAMEWORK_ORDER = ['nestjs', 'spring-boot', 'django', 'fastapi', 'go-gin', 'aspnet-core', 'express'];

function rank(order: string[], tech: string) {
  const i = order.indexOf(tech);
  return i < 0 ? order.length : i;
}

// ─── Per-format dependency readers ───────────────────────────────────────────

function packageJson(file: RepoFile): { deps: Dependency[]; name?: string } {
  let pkg: { name?: unknown; dependencies?: unknown; devDependencies?: unknown; peerDependencies?: unknown };
  try {
    pkg = JSON.parse(file.content);
  } catch {
    return { deps: [] };
  }
  const keys = (o: unknown) => (o && typeof o === 'object' ? Object.keys(o as object) : []);
  return {
    name: typeof pkg.name === 'string' ? pkg.name : undefined,
    deps: [
      ...keys(pkg.dependencies).map((name) => ({ name, file: file.path })),
      ...keys(pkg.devDependencies).map((name) => ({ name, file: file.path, dev: true })),
    ],
  };
}

function requirements(file: RepoFile): Dependency[] {
  const deps: Dependency[] = [];
  for (const raw of file.content.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line || line.startsWith('-')) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line);
    if (m) deps.push({ name: m[1]!, file: file.path });
  }
  return deps;
}

/** PEP 621 `dependencies = [...]`, Poetry `[tool.poetry.dependencies]` and Pipfile `[packages]`. */
function tomlDeps(file: RepoFile): Dependency[] {
  const deps: Dependency[] = [];
  const text = file.content;
  const list = /^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(text);
  if (list) {
    for (const m of list[1]!.matchAll(/["']\s*([A-Za-z0-9][A-Za-z0-9._-]*)/g)) deps.push({ name: m[1]!, file: file.path });
  }
  const sections = /^\[(tool\.poetry\.dependencies|tool\.poetry\.group\.[\w-]+\.dependencies|packages)\]\s*$/gm;
  for (const m of text.matchAll(sections)) {
    const start = m.index! + m[0].length;
    const rest = text.slice(start);
    const end = rest.search(/^\[/m);
    for (const line of (end < 0 ? rest : rest.slice(0, end)).split(/\r?\n/)) {
      const key = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(line);
      if (key && key[1] !== 'python') deps.push({ name: key[1]!, file: file.path });
    }
  }
  return deps;
}

function pom(file: RepoFile): Dependency[] {
  return [...file.content.matchAll(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/g)].map((m) => ({ name: m[1]!, file: file.path }));
}

function gradle(file: RepoFile): Dependency[] {
  const deps: Dependency[] = [];
  for (const m of file.content.matchAll(/["']([\w.-]+):([\w.-]+)(?::[^"']*)?["']/g)) deps.push({ name: m[2]!, file: file.path });
  // Version-catalog style: implementation(libs.spring.boot.starter.web)
  for (const m of file.content.matchAll(/libs\.([\w.]+)/g)) deps.push({ name: m[1]!.replace(/\./g, '-'), file: file.path });
  return deps;
}

function goMod(file: RepoFile): { deps: Dependency[]; module?: string } {
  const deps: Dependency[] = [];
  let inBlock = false;
  let module: string | undefined;
  for (const raw of file.content.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (line.startsWith('module ')) module = line.slice(7).trim();
    else if (/^require\s*\($/.test(line)) inBlock = true;
    else if (inBlock && line === ')') inBlock = false;
    else {
      const m = (inBlock ? /^([^\s]+)\s+v\S+/ : /^require\s+([^\s]+)\s+v\S+/).exec(line);
      if (m) deps.push({ name: m[1]!, file: file.path });
    }
  }
  return { deps, module };
}

function csproj(file: RepoFile): { deps: Dependency[]; web: boolean } {
  return {
    web: /Sdk\s*=\s*"Microsoft\.NET\.Sdk\.Web"/.test(file.content),
    deps: [...file.content.matchAll(/<PackageReference\s+Include\s*=\s*"([^"]+)"/g)].map((m) => ({ name: m[1]!, file: file.path })),
  };
}

/** The database a Prisma schema points at. */
export function prismaProvider(text: string): string | undefined {
  const block = /datasource\s+\w+\s*\{([\s\S]*?)\}/.exec(text);
  return block ? /provider\s*=\s*"(\w+)"/.exec(block[1]!)?.[1] : undefined;
}

// ─── Units ───────────────────────────────────────────────────────────────────

function ecosystemOf(path: string): Ecosystem | undefined {
  const name = baseName(path);
  if (name === 'package.json') return 'node';
  if (name === 'pyproject.toml' || name === 'Pipfile' || isRequirementsFile(path)) return 'python';
  if (name === 'pom.xml' || name.startsWith('build.gradle')) return 'java';
  if (name === 'go.mod') return 'go';
  if (name.endsWith('.csproj')) return 'dotnet';
  return undefined;
}

/** The folder an app lives in. requirements/base.txt belongs to the folder above "requirements". */
function unitDir(path: string): string {
  const dir = dirOf(path);
  return baseName(dir) === 'requirements' && path.endsWith('.txt') ? dirOf(dir) : dir;
}

const cleanName = (name: string) => name.replace(/^@[^/]+\//, '');

export function readUnits(files: RepoFile[], projectName: string): Unit[] {
  const units = new Map<string, Unit>();
  const byPath = new Map(files.map((f) => [f.path, f]));

  for (const file of files) {
    const ecosystem = ecosystemOf(file.path);
    if (!ecosystem) continue;
    const dir = unitDir(file.path);
    const key = `${dir}|${ecosystem}`;
    let unit = units.get(key);
    if (!unit) {
      unit = { dir, name: baseName(dir) || projectName, ecosystem, manifests: [], uses: new Map(), libraries: new Set(), notes: [] };
      units.set(key, unit);
    }
    unit.manifests.push(file.path);

    let deps: Dependency[] = [];
    const name = baseName(file.path);
    if (ecosystem === 'node') {
      const pkg = packageJson(file);
      deps = pkg.deps;
      if (pkg.name) unit.name = cleanName(pkg.name);
    } else if (ecosystem === 'python') {
      deps = name.endsWith('.txt') ? requirements(file) : tomlDeps(file);
    } else if (ecosystem === 'java') {
      deps = name === 'pom.xml' ? pom(file) : gradle(file);
    } else if (ecosystem === 'go') {
      const mod = goMod(file);
      deps = mod.deps;
      if (mod.module) unit.name = baseName(mod.module.replace(/\/v\d+$/, ''));
    } else {
      const proj = csproj(file);
      deps = proj.deps;
      unit.name = name.replace(/\.csproj$/, '');
      if (proj.web) consider(unit, { framework: 'aspnet-core' }, `${file.path} is an ASP.NET Core web project`);
    }

    for (const dep of deps) {
      const signal = signalFor(ecosystem, dep.name);
      if (!signal) continue;
      const shownName = ecosystem === 'python' ? normalizePython(dep.name) : dep.name;
      const evidence = `${shownName} in ${dep.file}`;
      if (dep.dev) {
        if (signal.library) unit.libraries.add(signal.library);
        continue;
      }
      consider(unit, signal, evidence);
    }

    // Prisma decides the database through its schema, not a driver package.
    if (ecosystem === 'node' && unit.libraries.has('prisma')) {
      const schema = byPath.get(dir ? `${dir}/prisma/schema.prisma` : 'prisma/schema.prisma') ?? byPath.get(dir ? `${dir}/schema.prisma` : 'schema.prisma');
      const provider = schema ? prismaProvider(schema.content) : undefined;
      const kind: Kind | undefined =
        provider === 'postgresql' || provider === 'cockroachdb' ? 'postgres' : provider === 'mysql' ? 'mysql' : provider === 'mongodb' ? 'mongodb' : undefined;
      if (kind && !unit.uses.has(kind)) unit.uses.set(kind, `Prisma datasource "${provider}" in ${schema!.path}`);
      if (provider === 'sqlite') unit.notes.push(`${unit.name} uses SQLite through Prisma. SQLite runs inside the app, so it isn't shown as its own component.`);
    }
  }
  const all = [...units.values()];
  const isApp = (u: Unit) => Boolean(u.framework || u.frontend || u.worker || u.grpc);
  for (const unit of all) {
    const parent = all.find((p) => p !== unit && p.ecosystem === unit.ecosystem && p.dir !== '' && unit.dir.startsWith(`${p.dir}/`) && isApp(p));
    if (parent) units.delete(`${unit.dir}|${unit.ecosystem}`);
  }
  for (const unit of units.values()) {
    if (!unit.framework && !unit.frontend && unit.grpc) {
      const name = unit.grpc.tech;
      unit.framework = { ...unit.grpc, note: `A gRPC service, modeled as ${TECH_NAMES[name] ?? name}.` };
    }
  }
  return [...units.values()];
}

const TECH_NAMES: Record<string, string> = { express: 'Express', fastapi: 'FastAPI', 'spring-boot': 'Spring Boot', 'go-gin': 'Gin' };

function consider(unit: Unit, signal: Signal, evidence: string) {
  if (signal.framework && (!unit.framework || rank(FRAMEWORK_ORDER, signal.framework) < rank(FRAMEWORK_ORDER, unit.framework.tech))) {
    unit.framework = { tech: signal.framework, evidence, ...(signal.note ? { note: signal.note } : {}) };
  }
  if (signal.frontend && (!unit.frontend || rank(FRONTEND_ORDER, signal.frontend) < rank(FRONTEND_ORDER, unit.frontend.tech))) {
    unit.frontend = { tech: signal.frontend, evidence, ...(signal.note ? { note: signal.note } : {}) };
  }
  if (signal.worker && !unit.worker) unit.worker = { tech: signal.worker, evidence };
  if (signal.grpc && !unit.grpc) unit.grpc = { tech: signal.grpc, evidence };
  if (signal.tool && !unit.tool) unit.tool = `${signal.tool}, ${evidence}`;
  if (signal.uses && !unit.uses.has(signal.uses)) unit.uses.set(signal.uses, evidence);
  if (signal.library) unit.libraries.add(signal.library);
}
