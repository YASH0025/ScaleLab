'use client';

import { searchTechnologies } from '@scalelab/catalog';
import type { Category, TechnologyDefinition } from '@scalelab/model';
import { useMemo, useState } from 'react';
import { TechIcon } from '@/lib/tech-icon';

export const DRAG_MIME = 'application/scalelab-technology';

const CATEGORY_LABEL: Partial<Record<Category, string>> = {
  client: 'Clients',
  frontend: 'Frontend',
  'load-balancer': 'Load balancers',
  backend: 'Backend',
  cache: 'Cache',
  'relational-db': 'Databases',
  'document-db': 'NoSQL',
  'dns-edge': 'Edge & CDN',
  gateway: 'API gateways',
  'object-storage': 'Storage',
  'message-queue': 'Queues',
  'event-stream': 'Streaming',
  external: 'External APIs',
  infrastructure: 'Infrastructure',
};

const ORDER: Category[] = [
  'client',
  'frontend',
  'load-balancer',
  'backend',
  'cache',
  'relational-db',
  'document-db',
  'dns-edge',
  'gateway',
  'object-storage',
  'message-queue',
  'event-stream',
  'external',
  'infrastructure',
];

function Item({ tech }: { tech: TechnologyDefinition }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, tech.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={tech.description}
      className="group flex cursor-grab items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors hover:bg-raised active:cursor-grabbing"
    >
      <span className="transition-transform group-hover:-rotate-6 group-hover:scale-110">
        <TechIcon icon={tech.icon} name={tech.name} brandColor={tech.brandColor} size={24} />
      </span>
      <span className="truncate">{tech.name}</span>
      {!tech.simulationSupported && (
        <span className="ml-auto rounded bg-raised px-1.5 py-0.5 text-[10px] text-faint group-hover:bg-line">soon</span>
      )}
    </div>
  );
}

export function LibraryPanel() {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const found = searchTechnologies(query);
    const map = new Map<Category, TechnologyDefinition[]>();
    for (const t of found) map.set(t.category, [...(map.get(t.category) ?? []), t]);
    return ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const);
  }, [query]);

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="p-3">
        <label className="flex items-center gap-2 rounded-lg border border-line-strong bg-bg px-2.5 py-2 text-[13px] focus-within:border-accent">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-faint" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search technologies"
            aria-label="Search technologies"
            className="w-full bg-transparent outline-none placeholder:text-faint"
          />
        </label>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {groups.length === 0 && <p className="px-2 py-6 text-center text-[13px] text-faint">No technologies match “{query}”.</p>}
        {groups.map(([category, techs]) => (
          <section key={category} className="mb-2">
            <h3 className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
              {CATEGORY_LABEL[category] ?? category}
            </h3>
            {techs.map((t) => (
              <Item key={t.id} tech={t} />
            ))}
          </section>
        ))}
      </div>
      <p className="border-t border-line px-3 py-2.5 text-[11px] leading-relaxed text-faint">Drag onto the canvas, then connect the dots.</p>
    </aside>
  );
}
