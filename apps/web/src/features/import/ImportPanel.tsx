'use client';

import { getTechnology } from '@scalelab/catalog';
import type { DetectedComponent, ImportResult, Role } from '@scalelab/importer';
import { useRef } from 'react';
import { TechIcon } from '@/lib/tech-icon';
import { useImport } from '@/store/use-import';

const btn = 'rounded-lg border border-line-strong px-3 py-1.5 text-[13px] hover:bg-raised disabled:opacity-40';
const primary = 'rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-40';

const GROUPS: Array<{ title: string; roles: Role[] }> = [
  { title: 'Where traffic starts', roles: ['frontend', 'proxy'] },
  { title: 'Services', roles: ['service'] },
  { title: 'Workers', roles: ['worker'] },
  { title: 'Queues and streams', roles: ['queue'] },
  { title: 'Data', roles: ['database', 'cache', 'storage'] },
  { title: 'Outside services', roles: ['external'] },
];

const EXAMPLES = ['dockersamples/example-voting-app', 'testdrivenio/fastapi-celery', 'docker/awesome-compose/tree/master/react-express-mongodb'];

function SourceStep() {
  const { url, error, setUrl, fromGitHub, fromFolder } = useImport();
  const folder = useRef<HTMLInputElement>(null);
  const submit = () => url.trim() && void fromGitHub();

  return (
    <div className="mt-4">
      <label className="text-[12px] font-medium text-muted" htmlFor="import-url">
        Public GitHub repo
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id="import-url"
          value={url}
          autoFocus
          placeholder="github.com/owner/repo"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-bg px-3 py-2 font-mono text-[13px] outline-none focus:border-accent"
        />
        <button onClick={submit} disabled={!url.trim()} className={primary}>
          Read repo
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-faint">
        Try:
        {EXAMPLES.map((ex) => (
          <button key={ex} onClick={() => setUrl(`github.com/${ex}`)} className="rounded-md bg-raised px-2 py-0.5 font-mono text-muted hover:text-ink">
            {ex.replace('/tree/master/', ' › ')}
          </button>
        ))}
      </div>

      <div className="my-5 flex items-center gap-3 text-[12px] text-faint">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>

      <button onClick={() => folder.current?.click()} className={`${btn} w-full py-2.5`}>
        📁 Choose a project folder from your computer
      </button>
      <input
        ref={folder}
        type="file"
        className="hidden"
        aria-label="Project folder"
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => {
          if (e.target.files?.length) void fromFolder(e.target.files);
          e.target.value = '';
        }}
      />
      <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
        Works for private code too. Your browser may say “upload”, but files are only read here and never leave your computer.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-[#5a2a2e] bg-bad-bg px-3 py-2 text-[12.5px] leading-relaxed text-bad-soft">
          {error}
        </p>
      )}

      <p className="mt-5 border-t border-line pt-3 text-[11.5px] leading-relaxed text-faint">
        ScaleLab reads only setup files: docker-compose, package.json, requirements.txt, pyproject.toml, pom.xml, build.gradle, go.mod, .csproj,
        Dockerfiles and .env examples. Never your source code.
      </p>
    </div>
  );
}

function ReadingStep() {
  const { progress, back } = useImport();
  return (
    <div className="mt-6 pb-2" aria-live="polite">
      <div className="h-1.5 overflow-hidden rounded-full bg-raised">
        <div className="anim-indeterminate h-full w-1/3 rounded-full bg-accent" />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-[13px] text-muted">{progress}…</p>
        <button onClick={back} className="text-[12.5px] text-faint hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}

function ComponentRow({ c, excluded, onToggle }: { c: DetectedComponent; excluded: boolean; onToggle: () => void }) {
  const tech = getTechnology(c.technologyId);
  if (!tech) return null;
  return (
    <li>
      <label className={`flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-raised ${excluded ? 'opacity-45' : ''}`}>
        <input type="checkbox" checked={!excluded} onChange={onToggle} className="mt-2 accent-[var(--color-accent)]" aria-label={`Include ${c.label}`} />
        <TechIcon icon={tech.icon} name={tech.name} brandColor={tech.brandColor} size={28} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold">{c.label}</span>
            <span className="shrink-0 text-[12px] text-muted">{tech.name}</span>
            {c.instances && c.instances > 1 && <span className="shrink-0 font-mono text-[11px] text-faint">×{c.instances}</span>}
            {c.confidence === 'guess' && (
              <span className="shrink-0 rounded bg-[#2a2414] px-1.5 py-0.5 text-[10.5px] font-medium text-warn" title="Our best guess. Untick it if it's wrong.">
                guess
              </span>
            )}
          </span>
          <span className="block truncate text-[11.5px] text-faint" title={c.evidence.join('\n')}>
            {c.evidence[0]}
          </span>
          {c.note && <span className="block text-[11.5px] leading-snug text-warn">{c.note}</span>}
        </span>
      </label>
    </li>
  );
}

function ReviewStep({ result }: { result: ImportResult }) {
  const { excluded, toggle, back, load, project } = useImport();
  const kept = result.components.filter((c) => !excluded.has(c.key));
  const keptLinks = result.links.filter((l) => !excluded.has(l.from) && !excluded.has(l.to));
  const guesses = result.components.filter((c) => c.confidence === 'guess').length;

  if (result.components.length === 0) {
    return (
      <div className="mt-4">
        <p className="rounded-xl bg-bg p-4 text-[13px] leading-relaxed text-muted">{result.notes[0]}</p>
        <div className="mt-4 flex justify-end">
          <button onClick={back} className={btn}>
            ← Try another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <p className="text-[13px] text-muted">
        Found <span className="font-semibold text-ink">{result.components.length} components</span> and {result.links.length} connections in{' '}
        <span className="font-mono text-ink">{project?.source}</span>
        {guesses > 0 && <> · {guesses} marked “guess”: check those</>}.
      </p>

      <div className="mt-3 max-h-[50vh] space-y-3 overflow-y-auto pr-1">
        {GROUPS.map((g) => {
          const items = result.components.filter((c) => g.roles.includes(c.role));
          if (items.length === 0) return null;
          return (
            <section key={g.title}>
              <h3 className="px-2 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{g.title}</h3>
              <ul className="mt-0.5">
                {items.map((c) => (
                  <ComponentRow key={c.key} c={c} excluded={excluded.has(c.key)} onToggle={() => toggle(c.key)} />
                ))}
              </ul>
            </section>
          );
        })}

        {result.notes.length > 0 && (
          <section className="rounded-lg bg-bg px-3 py-2.5">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">Worth knowing</h3>
            <ul className="mt-1 space-y-1 text-[12px] leading-relaxed text-muted">
              {result.notes.map((n) => (
                <li key={n}>• {n}</li>
              ))}
            </ul>
          </section>
        )}

        <details className="px-2 text-[12px] text-faint">
          <summary className="cursor-pointer hover:text-muted">
            Read {project?.fileCount} files{project?.truncated ? ' (big project: some folders were left out)' : ''}
          </summary>
          <ul className="mt-1 font-mono text-[11px] leading-relaxed">
            {result.filesUsed.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </details>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-4">
        <p className="text-[11.5px] text-faint">Settings start from realistic defaults. You can change anything on the canvas.</p>
        <div className="flex shrink-0 gap-2">
          <button onClick={back} className={btn}>
            Back
          </button>
          <button onClick={load} disabled={kept.length === 0} className={primary}>
            Load {kept.length} components{keptLinks.length ? ` and ${keptLinks.length} connections` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Import your project": read a repo or folder, review what was found, load it onto the canvas. */
export function ImportPanel() {
  const { open, step, result, close } = useImport();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[7vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section role="dialog" aria-label="Import your project" className="anim-toast w-[640px] max-w-[96vw] rounded-2xl border border-line-strong bg-panel p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[17px] font-semibold">{step === 'review' ? 'Here’s what we found' : 'Import your project'}</h2>
            {step !== 'review' && (
              <p className="mt-1 text-[13px] leading-relaxed text-muted">ScaleLab reads your setup files and draws your architecture, ready to run.</p>
            )}
          </div>
          <button onClick={close} aria-label="Close" className="px-1 text-[18px] text-faint hover:text-ink">
            ×
          </button>
        </div>
        {step === 'source' && <SourceStep />}
        {step === 'reading' && <ReadingStep />}
        {step === 'review' && result && <ReviewStep result={result} />}
      </section>
    </div>
  );
}
