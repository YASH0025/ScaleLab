/**
 * Which files in a project are worth reading. We only need manifests, compose
 * files and env examples, never source code, so a big repo stays a few dozen reads.
 */

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'vendor',
  'dist',
  'build',
  'target',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'site-packages',
  'test',
  'tests',
  '__tests__',
  'e2e',
  'testdata',
  'fixtures',
  '__fixtures__',
  'example',
  'examples',
  'sample',
  'samples',
  'docs',
  'doc',
  'website',
  '.github',
  '.idea',
  '.vscode',
  'bin',
  'obj',
  'template',
  'templates',
]);

const EXACT = new Set([
  'package.json',
  'pyproject.toml',
  'Pipfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'go.mod',
  'schema.prisma',
  'Procfile',
  'Dockerfile',
  '.env',
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.dist',
  '.env.local.example',
  '.env.development',
  '.env.dev',
]);

/** How deep we look; manifests deeper than this are almost always vendored or examples. */
export const MAX_DEPTH = 5;
/** Most files we read from one project. */
export const MAX_FILES = 200;
/** Larger files are skipped (lock files and generated manifests can be huge). */
export const MAX_FILE_BYTES = 512 * 1024;

export function isComposeFile(name: string): boolean {
  return /^(docker-)?compose([.-][\w.-]+)?\.ya?ml$/i.test(name);
}

export function isRequirementsFile(path: string): boolean {
  const parts = path.split('/');
  const name = parts[parts.length - 1]!;
  if (/^requirements([.-][\w-]+)?\.txt$/i.test(name)) return true;
  return parts[parts.length - 2] === 'requirements' && name.endsWith('.txt');
}

export function isInterestingPath(path: string): boolean {
  const clean = normalizePath(path);
  const parts = clean.split('/');
  if (parts.length > MAX_DEPTH + 1) return false;
  for (const dir of parts.slice(0, -1)) {
    if (IGNORED_DIRS.has(dir) || dir.startsWith('.') || /^examples?[-_]|[-_]examples?$|^demos?$/i.test(dir)) return false;
  }
  const name = parts[parts.length - 1]!;
  return EXACT.has(name) || isComposeFile(name) || isRequirementsFile(clean) || name.endsWith('.csproj');
}

/** Interesting paths, shallowest first, capped at MAX_FILES. */
export function pickFiles(paths: string[]): string[] {
  return paths
    .map(normalizePath)
    .filter(isInterestingPath)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, MAX_FILES);
}

export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

export const dirOf = (path: string) => {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
};

export const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export const joinPath = (dir: string, rel: string) => normalizePath(dir ? `${dir}/${rel}` : rel);
