import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFromFolder, loadFromGitHub, parseGitHubUrl } from '../src/lib/repo-source';

describe('parseGitHubUrl', () => {
  it('accepts the ways people paste repo links', () => {
    const plain = { owner: 'vercel', repo: 'next.js' };
    expect(parseGitHubUrl('vercel/next.js')).toEqual(plain);
    expect(parseGitHubUrl('github.com/vercel/next.js')).toEqual(plain);
    expect(parseGitHubUrl('https://github.com/vercel/next.js.git')).toEqual(plain);
    expect(parseGitHubUrl('https://www.github.com/vercel/next.js/')).toEqual(plain);
    expect(parseGitHubUrl('git@github.com:vercel/next.js.git')).toEqual(plain);
    expect(parseGitHubUrl('  https://github.com/vercel/next.js?tab=readme  ')).toEqual(plain);
  });

  it('keeps a branch and folder from /tree/ links', () => {
    expect(parseGitHubUrl('https://github.com/docker/awesome-compose/tree/master/react-express-mongodb')).toEqual({
      owner: 'docker',
      repo: 'awesome-compose',
      ref: 'master',
      path: 'react-express-mongodb',
    });
    expect(parseGitHubUrl('github.com/a/b/tree/dev')).toEqual({ owner: 'a', repo: 'b', ref: 'dev' });
  });

  it('rejects things that are not GitHub repos', () => {
    expect(parseGitHubUrl('')).toBeUndefined();
    expect(parseGitHubUrl('vercel')).toBeUndefined();
    expect(parseGitHubUrl('https://gitlab.com/a/b')).toBeUndefined();
    expect(parseGitHubUrl('github.com/bad owner/x')).toBeUndefined();
  });
});

describe('loadFromGitHub', () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: init.status ?? 200, headers: init.headers });

  it('lists the tree once and reads only setup files from the default branch', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url === 'https://api.github.com/repos/acme/shop') return respond({ default_branch: 'main' });
        if (url.startsWith('https://api.github.com/repos/acme/shop/git/trees/main')) {
          return respond({
            truncated: false,
            tree: [
              { path: 'docker-compose.yml', type: 'blob', size: 100 },
              { path: 'api/package.json', type: 'blob', size: 100 },
              { path: 'api/src/index.ts', type: 'blob', size: 100 },
              { path: 'node_modules/x/package.json', type: 'blob', size: 100 },
              { path: 'api', type: 'tree' },
              { path: 'huge/package.json', type: 'blob', size: 10_000_000 },
            ],
          });
        }
        if (url === 'https://raw.githubusercontent.com/acme/shop/main/docker-compose.yml') return respond('services: {}');
        if (url === 'https://raw.githubusercontent.com/acme/shop/main/api/package.json') return respond('{"name":"api"}');
        return respond('missing', { status: 404 });
      }),
    );
    const progress: string[] = [];
    const project = await loadFromGitHub('github.com/acme/shop', (m) => progress.push(m));
    expect(project.name).toBe('shop');
    expect(project.source).toBe('acme/shop');
    expect(project.files.map((f) => f.path)).toEqual(['docker-compose.yml', 'api/package.json']);
    expect(calls.filter((c) => c.startsWith('https://api.github.com'))).toHaveLength(2);
    expect(progress.at(-1)).toBe('Reading files (2 of 2)');
  });

  it('reads only inside a folder link, with paths relative to it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/repos/docker/awesome-compose')) return respond({ default_branch: 'master' });
        if (url.includes('/git/trees/master')) {
          return respond({ truncated: false, tree: [{ path: 'react-express-mongodb/compose.yaml', type: 'blob', size: 10 }, { path: 'other/compose.yaml', type: 'blob', size: 10 }] });
        }
        if (url === 'https://raw.githubusercontent.com/docker/awesome-compose/master/react-express-mongodb/compose.yaml') return respond('services: {}');
        return respond('', { status: 404 });
      }),
    );
    const project = await loadFromGitHub('https://github.com/docker/awesome-compose/tree/master/react-express-mongodb', () => {});
    expect(project.name).toBe('react-express-mongodb');
    expect(project.files).toEqual([{ path: 'compose.yaml', content: 'services: {}' }]);
  });

  it('explains private or missing repos and the anonymous rate limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ message: 'Not Found' }, { status: 404 })));
    await expect(loadFromGitHub('acme/secret', () => {})).rejects.toThrow(/Couldn't find acme\/secret\. If it's private, choose the folder/);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond({ message: 'rate limited' }, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' } })),
    );
    await expect(loadFromGitHub('acme/shop', () => {})).rejects.toThrow(/60 reads an hour/);

    await expect(loadFromGitHub('not a link', () => {})).rejects.toThrow(/doesn’t look like a GitHub repo link/);
  });
});

describe('loadFromFolder', () => {
  it('reads setup files under the picked folder and ignores the rest', async () => {
    const file = (path: string, text: string) => {
      const f = new File([text], path.split('/').pop()!);
      Object.defineProperty(f, 'webkitRelativePath', { value: path });
      return f;
    };
    const project = await loadFromFolder(
      [
        file('my-app/package.json', '{"name":"my-app","dependencies":{"express":"4"}}'),
        file('my-app/src/server.js', 'secret source code'),
        file('my-app/node_modules/express/package.json', '{}'),
        file('my-app/.env.example', 'DATABASE_URL=postgres://x@db/y'),
      ],
      () => {},
    );
    expect(project.name).toBe('my-app');
    expect(project.source).toBe('my-app (folder)');
    expect(project.files.map((f) => f.path).sort()).toEqual(['.env.example', 'package.json']);
  });
});
