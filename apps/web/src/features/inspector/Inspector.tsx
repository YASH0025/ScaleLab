'use client';

import { PRICING_NOTE, getLibrary, getTechnology, librariesFor, libraryConflicts } from '@scalelab/catalog';
import { formatUsd } from '@scalelab/planner';
import { type ArchNode, type ArchetypeConfig, type Distribution, affectsSimulation, archetypeName } from '@scalelab/model';
import { type ReactNode, useState } from 'react';
import { TechIcon } from '@/lib/tech-icon';
import { useCost } from '@/lib/use-cost';
import { usePlan } from '@/store/use-plan';
import { removeNodes, updateNode } from '@/store/design-doc';
import { useDesign } from '@/store/use-design';
import { useSim } from '@/store/use-sim';
import { useUi } from '@/store/use-ui';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-3.5">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">{title}</h3>
      {children}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.min(max ?? Infinity, Math.max(min, v)));
          }}
          className="w-[84px] rounded-md border border-line-strong bg-bg px-2 py-1 text-right font-mono text-[12px] outline-none focus:border-accent"
        />
        {suffix && <span className="w-6 text-[11px] text-faint">{suffix}</span>}
      </span>
    </label>
  );
}

const meanOf = (d: Distribution) => (d.kind === 'constant' ? d.valueMs : d.meanMs);
function withMean(d: Distribution, mean: number): Distribution {
  const m = Math.max(0.1, mean);
  if (d.kind === 'constant') return { kind: 'constant', valueMs: m };
  if (d.kind === 'exponential') return { kind: 'exponential', meanMs: m };
  return { kind: 'lognormal', meanMs: m, p99Ms: Math.max(m * 1.01, (d.p99Ms / d.meanMs) * m) };
}

function ConfigFields({ node }: { node: ArchNode }) {
  const set = (config: ArchetypeConfig) => updateNode(node.id, (n) => ({ ...n, config }));
  const c = node.config;
  switch (c.type) {
    case 'compute':
      return (
        <>
          <NumberField label="Instances" value={c.instances} min={1} max={64} onChange={(v) => set({ ...c, instances: Math.round(v) })} />
          <NumberField label="Workers / instance" value={c.workersPerInstance} min={1} max={5000} onChange={(v) => set({ ...c, workersPerInstance: Math.round(v) })} />
          <NumberField label="Service time" value={meanOf(c.serviceTime)} min={0.1} step={1} suffix="ms" onChange={(v) => set({ ...c, serviceTime: withMean(c.serviceTime, v) })} />
          <NumberField label="Queue limit" value={c.queueLimit} min={0} onChange={(v) => set({ ...c, queueLimit: Math.round(v) })} />
          <NumberField label="Timeout" value={c.timeoutMs} min={10} step={100} suffix="ms" onChange={(v) => set({ ...c, timeoutMs: v })} />
        </>
      );
    case 'load-balancer': {
      const archetype = getTechnology(node.technologyId)?.archetype;
      if (archetype === 'dns') {
        return (
          <p className="text-[13px] leading-relaxed text-muted">
            Points your domain at the entry point. Resolvers cache the answer, so it adds about a millisecond, not a full lookup per request.
          </p>
        );
      }
      return (
        <>
          <label className="flex items-center justify-between py-1.5 text-[13px]">
            <span className="text-muted">Strategy</span>
            <select
              value={c.strategy}
              onChange={(e) => set({ ...c, strategy: e.target.value as typeof c.strategy })}
              className="rounded-md border border-line-strong bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent"
            >
              <option value="least-connections">Least connections</option>
              <option value="round-robin">Round robin</option>
              <option value="random">Random</option>
            </select>
          </label>
          <NumberField label="Rate limit" value={c.rateLimitRps ?? 0} min={0} step={100} suffix="/s" onChange={(v) => set({ ...c, rateLimitRps: Math.round(v) })} />
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            Requests above the rate limit get 429 Too Many Requests instead of overloading what sits behind. 0 means no limit.
          </p>
        </>
      );
    }
    case 'cache':
      return (
        <>
          <NumberField label="Hit ratio" value={Math.round(c.hitRatio * 100)} min={0} max={100} suffix="%" onChange={(v) => set({ ...c, hitRatio: v / 100 })} />
          <NumberField label="Read latency" value={meanOf(c.readLatency)} min={0.1} step={0.5} suffix="ms" onChange={(v) => set({ ...c, readLatency: withMean(c.readLatency, v) })} />
          <NumberField label="Max connections" value={c.maxConnections} min={1} onChange={(v) => set({ ...c, maxConnections: Math.round(v) })} />
        </>
      );
    case 'relational-db':
      return (
        <>
          <NumberField label="Connection pool" value={c.connectionPool} min={1} max={5000} onChange={(v) => set({ ...c, connectionPool: Math.round(v) })} />
          <NumberField label="Read query" value={meanOf(c.readQuery)} min={0.1} suffix="ms" onChange={(v) => set({ ...c, readQuery: withMean(c.readQuery, v) })} />
          <NumberField label="Write query" value={meanOf(c.writeQuery)} min={0.1} suffix="ms" onChange={(v) => set({ ...c, writeQuery: withMean(c.writeQuery, v) })} />
          <NumberField label="Read replicas" value={c.readReplicas} min={0} max={15} onChange={(v) => set({ ...c, readReplicas: Math.round(v) })} />
          <NumberField label="Shards" value={c.shards ?? 1} min={1} max={256} onChange={(v) => set({ ...c, shards: Math.round(v) })} />
          <NumberField label="Queue limit" value={c.queueLimit} min={0} onChange={(v) => set({ ...c, queueLimit: Math.round(v) })} />
          <NumberField label="Timeout" value={c.timeoutMs} min={10} step={100} suffix="ms" onChange={(v) => set({ ...c, timeoutMs: v })} />
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            Each shard holds part of the data with its own pool and replicas, so capacity grows with shards. Replicas serve reads only.
          </p>
        </>
      );
    case 'queue':
      return (
        <>
          <label className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
            <span className="text-muted">Delivery</span>
            <select
              value={c.fanOut ? 'fanout' : 'compete'}
              onChange={(e) => set({ ...c, fanOut: e.target.value === 'fanout' })}
              className="rounded-md border border-line-strong bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent"
            >
              <option value="fanout">Every consumer gets every message</option>
              <option value="compete">Consumers share the work</option>
            </select>
          </label>
          {c.fanOut && (
            <NumberField label="Partitions" value={c.partitions} min={0} max={1000} onChange={(v) => set({ ...c, partitions: Math.round(v) })} />
          )}
          <NumberField label="Max backlog" value={c.maxBacklog} min={1} step={1000} onChange={(v) => set({ ...c, maxBacklog: Math.round(v) })} />
          <NumberField label="Publish latency" value={meanOf(c.publishLatency)} min={0.1} step={0.5} suffix="ms" onChange={(v) => set({ ...c, publishLatency: withMean(c.publishLatency, v) })} />
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            {c.fanOut
              ? 'Each consumer processes at most one message per partition at a time. Partitions cap parallelism.'
              : 'Producers don’t wait for consumers. When the backlog is full, publishing fails.'}
          </p>
        </>
      );
    case 'external':
      return (
        <>
          <NumberField label="Response time" value={meanOf(c.latency)} min={1} step={10} suffix="ms" onChange={(v) => set({ ...c, latency: withMean(c.latency, v) })} />
          <NumberField label="Errors" value={Math.round(c.errorRate * 1000) / 10} min={0} max={100} step={0.5} suffix="%" onChange={(v) => set({ ...c, errorRate: v / 100 })} />
          <NumberField label="Slow, no reply" value={Math.round(c.timeoutRate * 1000) / 10} min={0} max={100} step={0.5} suffix="%" onChange={(v) => set({ ...c, timeoutRate: v / 100 })} />
          <NumberField label="Caller waits" value={c.timeoutMs} min={10} step={500} suffix="ms" onChange={(v) => set({ ...c, timeoutMs: v })} />
          <NumberField label="Rate limit" value={c.rateLimitRps} min={0} step={10} suffix="/s" onChange={(v) => set({ ...c, rateLimitRps: Math.round(v) })} />
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            Errors fail before anything happens. “Slow, no reply” means the work is done (the card is charged) but the caller gives up waiting. Rate
            limit 0 means no limit.
          </p>
        </>
      );
    case 'client':
      return <p className="text-[13px] leading-relaxed text-muted">Sends the traffic you set in the toolbar. Connect it to a load balancer or a backend.</p>;
    case 'generic':
      return getTechnology(node.technologyId)?.archetype === 'observability' ? (
        <p className="text-[13px] leading-relaxed text-muted">Collects metrics and logs from what you connect to it. It sits off the request path, so it never slows requests down.</p>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted">You can place and connect this now. Its behavior isn’t simulated yet, so it only adds network latency.</p>
      );
  }
}

function Libraries({ node }: { node: ArchNode }) {
  const [adding, setAdding] = useState(false);
  const available = librariesFor(node.technologyId);
  const attached = node.libraries.map((l) => l.libraryId);
  const conflicts = libraryConflicts(attached);
  if (available.length === 0) return <p className="text-[13px] text-faint">No libraries for this technology yet.</p>;

  const attach = (libraryId: string) => {
    updateNode(node.id, (n) => ({ ...n, libraries: [...n.libraries, { libraryId }] }));
    setAdding(false);
  };
  const detach = (libraryId: string) =>
    updateNode(node.id, (n) => ({ ...n, libraries: n.libraries.filter((l) => l.libraryId !== libraryId) }));

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {attached.map((id) => {
          const lib = getLibrary(id);
          if (!lib) return null;
          return (
            <span key={id} className="anim-chip group inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-raised py-1 pl-1 pr-2 text-[12px]">
              <TechIcon icon={lib.icon} name={lib.name} brandColor={lib.brandColor} size={18} />
              {lib.name}
              {affectsSimulation(lib) && <span title="Changes the simulation">⚡</span>}
              <button onClick={() => detach(id)} aria-label={`Remove ${lib.name}`} className="ml-0.5 text-faint hover:text-ink">
                ×
              </button>
            </span>
          );
        })}
        <button
          onClick={() => setAdding((a) => !a)}
          className="rounded-full border border-dashed border-accent px-2.5 py-1 text-[12px] text-accent-soft hover:bg-raised"
        >
          + Add library
        </button>
      </div>
      {conflicts.map(([a, b]) => (
        <p key={`${a}-${b}`} className="mt-2 text-[12px] text-warn">
          {getLibrary(a)?.name} and {getLibrary(b)?.name} do the same job. You usually need only one.
        </p>
      ))}
      {adding && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-line-strong bg-bg p-1">
          {available
            .filter((l) => !attached.includes(l.id))
            .map((lib) => (
              <button
                key={lib.id}
                onClick={() => attach(lib.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-raised"
              >
                <TechIcon icon={lib.icon} name={lib.name} brandColor={lib.brandColor} size={20} />
                <span className="flex-1">{lib.name}</span>
                <span className="text-[11px] text-faint">{lib.category}</span>
                {affectsSimulation(lib) && <span title="Changes the simulation">⚡</span>}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function Failures({ node }: { node: ArchNode }) {
  const status = useSim((s) => s.status);
  const injected = useSim((s) => s.injected[node.id]);
  const inject = useSim((s) => s.inject);
  const live = status === 'running' || status === 'paused';
  const c = node.config;
  if (c.type !== 'compute' && c.type !== 'cache' && c.type !== 'relational-db' && c.type !== 'queue' && c.type !== 'external' && c.type !== 'load-balancer') return null;
  // Outside services are slow in seconds, not milliseconds; enough to pass most caller timeouts.
  const extraMs = c.type === 'external' ? 2000 : 100;
  const btn = 'rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <Section title="Break things">
      {!live && <p className="mb-2 text-[12px] text-faint">Press Run, then try these while traffic flows.</p>}
      <div className="flex flex-wrap gap-2">
        {c.type === 'compute' &&
          Array.from({ length: c.instances }, (_, i) => {
            const down = injected?.downInstances.includes(i) ?? false;
            return (
              <button
                key={i}
                disabled={!live}
                onClick={() => inject({ nodeId: node.id, instance: i, action: down ? 'up' : 'down' })}
                className={`${btn} ${down ? 'border-ok text-ok' : 'border-[#5a2a2e] text-bad-soft hover:bg-bad-bg'}`}
              >
                {down ? `Restore #${i + 1}` : `Kill instance #${i + 1}`}
              </button>
            );
          })}
        {c.type !== 'compute' && (
          <button
            disabled={!live}
            onClick={() => inject({ nodeId: node.id, action: injected?.down ? 'up' : 'down' })}
            className={`${btn} ${injected?.down ? 'border-ok text-ok' : 'border-[#5a2a2e] text-bad-soft hover:bg-bad-bg'}`}
          >
            {injected?.down ? 'Bring back up' : c.type === 'external' ? 'Outage' : 'Take down'}
          </button>
        )}
        <button
          disabled={!live}
          onClick={() =>
            inject({ nodeId: node.id, action: 'latency', extraLatencyMs: injected?.extraLatencyMs ? 0 : extraMs })
          }
          className={`${btn} border-line-strong hover:bg-raised`}
        >
          {injected?.extraLatencyMs ? 'Remove latency' : extraMs >= 1000 ? `+${extraMs / 1000} s latency` : `+${extraMs} ms latency`}
        </button>
      </div>
    </Section>
  );
}

function CostSummary() {
  const { estimate, rps } = useCost();
  const show = usePlan((s) => s.show);
  const paid = estimate.lines.filter((l) => l.monthlyUsd > 0).sort((a, b) => b.monthlyUsd - a.monthlyUsd);
  return (
    <section className="mt-5 rounded-xl border border-line bg-card px-3.5 py-3">
      <div className="text-[12px] text-muted">Estimated cost at {rps.toLocaleString()} rps</div>
      <div className="mt-0.5 text-[22px] font-semibold tabular-nums">
        {formatUsd(estimate.monthlyUsd)}
        <span className="ml-1 text-[13px] font-normal text-muted">/ month</span>
      </div>
      {paid.length > 0 && (
        <ul className="mt-2 space-y-1 text-[12px]">
          {paid.map((l) => (
            <li key={l.nodeId} className="flex justify-between gap-2">
              <span className="truncate text-muted" title={l.basis}>
                {l.label}
              </span>
              <span className="shrink-0 font-mono">{formatUsd(l.monthlyUsd)}</span>
            </li>
          ))}
        </ul>
      )}
      {estimate.unpricedCount > 0 && (
        <p className="mt-2 text-[11px] text-faint">
          {estimate.unpricedCount} component{estimate.unpricedCount > 1 ? 's aren’t' : ' isn’t'} priced yet.
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-faint">{PRICING_NOTE}</p>
      <button
        onClick={show}
        className="mt-3 w-full rounded-lg border border-accent/60 px-3 py-1.5 text-[12.5px] text-accent-soft hover:bg-raised"
      >
        Find the cheapest setup for my traffic
      </button>
    </section>
  );
}

function NodeCost({ nodeId }: { nodeId: string }) {
  const { estimate } = useCost();
  const line = estimate.lines.find((l) => l.nodeId === nodeId);
  if (!line) return null;
  return (
    <p className="mb-2 text-[12px] text-muted">
      {line.unpriced ? 'Not priced yet' : `≈ ${formatUsd(line.monthlyUsd)} / month`}
      {!line.unpriced && <span className="text-faint"> · {line.basis}</span>}
    </p>
  );
}

function Overview() {
  const nodes = useDesign((s) => s.nodes);
  const hints = useSim((s) => s.hints);
  return (
    <div className="px-4 py-4">
      <h2 className="text-[15px] font-semibold">Your architecture</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        {nodes.length === 0
          ? 'Drag technologies from the left and connect them top to bottom: client → load balancer → services → cache and database. Services can call other services and publish to queues that workers consume.'
          : `${nodes.length} components. Select one to tune it, attach libraries, or break it during a run.`}
      </p>
      {hints.map((h) => (
        <p key={h} className="mt-3 rounded-lg border border-line-strong bg-raised px-3 py-2 text-[12px] text-warn">
          {h}
        </p>
      ))}
      <ul className="mt-4 space-y-2 text-[12px] text-faint">
        <li>Drag from a node’s bottom dot to another node to connect them.</li>
        <li>Press Delete to remove the selected component.</li>
        <li>All numbers are modeled estimates, not measurements.</li>
      </ul>
      {nodes.length > 0 && <CostSummary />}
    </div>
  );
}

export function Inspector() {
  const selectedId = useUi((s) => s.selectedNodeId);
  const node = useDesign((s) => s.nodes.find((n) => n.id === selectedId));
  const running = useSim((s) => s.status === 'running' || s.status === 'paused');
  const select = useUi((s) => s.select);
  const tech = node && getTechnology(node.technologyId);

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line bg-panel">
      {!node || !tech ? (
        <Overview />
      ) : (
        <>
          <div className="flex items-center gap-3 px-4 py-4">
            <TechIcon icon={tech.icon} name={tech.name} brandColor={tech.brandColor} size={38} />
            <div className="min-w-0 flex-1">
              <input
                value={node.label}
                onChange={(e) => updateNode(node.id, (n) => ({ ...n, label: e.target.value }))}
                aria-label="Component name"
                className="w-full rounded bg-transparent text-[15px] font-semibold outline-none focus:bg-bg"
              />
              <div className="text-[12px] text-muted">
                {tech.name} · {archetypeName(tech.archetype)}
              </div>
            </div>
          </div>
          <Section title="Configuration">
            <NodeCost nodeId={node.id} />
            {running && <p className="mb-1 text-[11px] text-faint">Changes apply on the next run.</p>}
            <ConfigFields node={node} />
          </Section>
          <Section title="Libraries">
            <Libraries node={node} />
          </Section>
          <Failures node={node} />
          <div className="mt-auto border-t border-line px-4 py-3">
            <button
              onClick={() => {
                removeNodes([node.id]);
                select(undefined);
              }}
              className="text-[12px] text-faint hover:text-bad-soft"
            >
              Remove from canvas
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
