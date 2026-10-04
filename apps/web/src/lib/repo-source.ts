import { MAX_FILE_BYTES, type RepoFile, isInterestingPath, normalizePath, pickFiles } from '@scalelab/importer';

/**
 * Where a project's files come from: a public GitHub repo (read straight from
 * GitHub in the browser, no ScaleLab server involved) or a folder on the
 * user's computer (read locally, never uploaded).
 */

export interface RepoRef {
  owner: string;
  repo: string;
  ref?: string;
  /** Only read inside this folder of the repo. */
  path?: string;
}

export interface LoadedProject {
  name: string;
  /** Shown to the user, like "vercel/next.js" or "my-app (folder)". */
  source: string;
  files: RepoFile[];
  /** Files we would have read but skipped, because the project was too big. */
  truncated: boolean;
}

export type Progress = (message: string) => void;

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Accepts "owner/repo", "github.com/owner/repo", full URLs with ".git",
 * and links to a branch or folder: ".../tree/main/services/api".
 */
export function parseGitHubUrl(input: string): RepoRef | undefined {
  let s = input.trim();
  if (!s) return undefined;
  s = s.replace(/^git@github\.com:/i, 'github.com/').replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  if (/^github\.com\//i.test(s)) s = s.slice('github.com/'.length);
  else if (s.includes('.') && s.split('/')[0]!.includes('.')) return undefined; // another host
  const parts = s.split(/[?#]/)[0]!.split('/').filter(Boolean);
  if (parts.length < 2) return undefined;
  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/i, '');
  if (!OWNER.test(owner) || !REPO.test(repo)) return undefined;
  if (parts[2] === 'tree' && parts[3]) {
    const path = parts.slice(4).join('/');
    return { owner, repo, ref: decodeURIComponent(parts[3]), ...(path ? { path: decodeURIComponent(path) } : {}) };
  }
  return { owner, repo };
}

class FriendlyError extends Error {}

async function github(path: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json' }, signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new FriendlyError("Couldn't reach GitHub. Check your connection, or choose the folder from your computer instead.");
  }
  if (res.status === 403 || res.status === 429) {
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      const when = reset ? new Date(reset * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'in an hour';
      throw new FriendlyError(`GitHub allows 60 reads an hour without signing in, and they're used up. Try again at ${when}, or choose the folder from your computer.`);
    }
  }
  if (res.status === 404) throw new FriendlyError('not-found');
  if (!res.ok) throw new FriendlyError(`GitHub answered ${res.status}. Try again, or choose the folder from your computer.`);
  return res.json();
}

/** Runs tasks with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await task(items[i]!);
      }
    }),
  );
  return out;
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export async function loadFromGitHub(input: string, onProgress: Progress, signal?: AbortSignal): Promise<LoadedProject> {
  const ref = parseGitHubUrl(input);
  if (!ref) throw new Error('That doesn’t look like a GitHub repo link. Try something like github.com/owner/repo.');
  const label = `${ref.owner}/${ref.repo}`;
  try {
    onProgress(`Looking up ${label}`);
    const meta = (await github(`/repos/${ref.owner}/${ref.repo}`, signal)) as { default_branch: string; private?: boolean };
    const branch = ref.ref ?? meta.default_branch;

    onProgress('Listing files');
    const tree = (await github(`/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, signal)) as {
      tree: Array<{ path: string; type: string; size?: number }>;
      truncated: boolean;
    };
    const prefix = ref.path ? `${normalizePath(ref.path)}/` : '';
    const candidates = tree.tree
      .filter((e) => e.type === 'blob' && (e.size ?? 0) <= MAX_FILE_BYTES && e.path.startsWith(prefix))
      .map((e) => e.path.slice(prefix.length));
    const wanted = pickFiles(candidates);
    const interesting = candidates.filter(isInterestingPath).length;

    let done = 0;
    const files = await pool(wanted, 6, async (path) => {
      const url = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${encodePath(branch)}/${encodePath(prefix + path)}`;
      const res = await fetch(url, { signal });
      done++;
      onProgress(`Reading files (${done} of ${wanted.length})`);
      return res.ok ? { path, content: await res.text() } : undefined;
    });
    return {
      name: ref.path ? ref.path.split('/').pop()! : ref.repo,
      source: ref.path ? `${label}/${ref.path}` : label,
      files: files.filter((f): f is RepoFile => f !== undefined),
      truncated: tree.truncated || interesting > wanted.length,
    };
  } catch (err) {
    if (err instanceof FriendlyError && err.message === 'not-found') {
      throw new Error(
        ref.ref
          ? `Couldn't find ${label} at "${ref.ref}". Check the branch name.`
          : `Couldn't find ${label}. If it's private, choose the folder from your computer instead (private repos need GitHub sign-in, which is coming).`,
      );
    }
    throw err;
  }
}

/** Reads a folder picked with <input webkitdirectory>. Files stay in the browser. */
export async function loadFromFolder(list: FileList | File[], onProgress: Progress): Promise<LoadedProject> {
  const all = [...list];
  if (all.length === 0) throw new Error('That folder is empty.');
  const rel = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
  const root = rel(all[0]!).split('/')[0] ?? 'project';
  const byPath = new Map<string, File>();
  for (const f of all) {
    const path = normalizePath(rel(f).split('/').slice(1).join('/') || f.name);
    if (f.size <= MAX_FILE_BYTES) byPath.set(path, f);
  }
  const candidates = [...byPath.keys()];
  const wanted = pickFiles(candidates);
  let done = 0;
  const files = await Promise.all(
    wanted.map(async (path) => {
      const content = await byPath.get(path)!.text();
      done++;
      onProgress(`Reading files (${done} of ${wanted.length})`);
      return { path, content };
    }),
  );
  return {
    name: root,
    source: `${root} (folder)`,
    files,
    truncated: candidates.filter(isInterestingPath).length > wanted.length,
  };
}
