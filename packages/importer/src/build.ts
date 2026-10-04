import { getTechnology, librariesFor } from '@scalelab/catalog';
import { type ArchEdge, type ArchNode, type ArchetypeConfig, type Distribution, checkConnection } from '@scalelab/model';
import type { DetectedComponent, ImportResult } from './types';

const CLIENT_LATENCY: Distribution = { kind: 'lognormal', meanMs: 20, p99Ms: 80 };
const INTERNAL_LATENCY: Distribution = { kind: 'lognormal', meanMs: 0.5, p99Ms: 2 };

const X_GAP = 260;
const Y_GAP = 180;

export interface ImportedDesign {
  name: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
  /** Links that couldn't be drawn, with the reason. */
  dropped: string[];
}

/**
 * Turns an analysis into canvas nodes and edges: catalog defaults for every
 * component, valid connections only, and a top-down layered layout.
 */
export function toDesign(result: ImportResult, excluded: ReadonlySet<string> = new Set()): ImportedDesign {
  const kept = result.components.filter((c) => !excluded.has(c.key) && getTechnology(c.technologyId));
  const byKey = new Map(kept.map((c) => [c.key, c]));
  const dropped: string[] = [];

  const edges: ArchEdge[] = [];
  for (const l of result.links) {
    const from = byKey.get(l.from);
    const to = byKey.get(l.to);
    if (!from || !to) continue;
    const a = getTechnology(from.technologyId)!.archetype;
    const b = getTechnology(to.technologyId)!.archetype;
    const check = checkConnection(a, b);
    if (!check.valid) {
      dropped.push(`${from.label} → ${to.label}: ${check.reason}`);
      continue;
    }
    edges.push({
      id: `e-${from.key}-${to.key}`,
      source: from.key,
      target: to.key,
      protocol: check.protocols[0]!,
      networkLatency: a === 'client' ? CLIENT_LATENCY : INTERNAL_LATENCY,
    });
  }

  const positions = layout(kept, edges);
  const nodes: ArchNode[] = kept.map((c) => {
    const tech = getTechnology(c.technologyId)!;
    const config = JSON.parse(JSON.stringify(tech.defaults)) as ArchetypeConfig;
    if (c.instances && config.type === 'compute') config.instances = Math.min(64, c.instances);
    const allowed = new Set(librariesFor(c.technologyId).map((l) => l.id));
    return {
      id: c.key,
      technologyId: c.technologyId,
      label: c.label.slice(0, 60),
      position: positions.get(c.key)!,
      config,
      libraries: [...new Set(c.libraries)].filter((id) => allowed.has(id)).map((libraryId) => ({ libraryId })),
    };
  });
  return { name: result.name, nodes, edges, dropped };
}

/**
 * Layers from where traffic starts: each node sits one row below its deepest
 * parent. Within a row, nodes are ordered by their parents' positions to keep
 * lines from crossing.
 */
export function layout(components: DetectedComponent[], edges: ArchEdge[]): Map<string, { x: number; y: number }> {
  const keys = components.map((c) => c.key);
  const parents = new Map<string, string[]>(keys.map((k) => [k, []]));
  for (const e of edges) parents.get(e.target)?.push(e.source);

  // Longest-path layering, bounded so cycles can't loop forever.
  const layer = new Map<string, number>(keys.map((k) => [k, 0]));
  for (let pass = 0; pass < keys.length; pass++) {
    let changed = false;
    for (const e of edges) {
      const next = Math.min((layer.get(e.source) ?? 0) + 1, keys.length);
      if (next > (layer.get(e.target) ?? 0)) {
        layer.set(e.target, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Things nothing calls that aren't where traffic starts (a worker polling a database,
  // say) sit just above what they use, not up with the users.
  const roles = new Map(components.map((c) => [c.key, c.role]));
  for (const k of keys) {
    if (parents.get(k)!.length > 0 || roles.get(k) === 'frontend') continue;
    const childLayers = edges.filter((e) => e.source === k).map((e) => layer.get(e.target)!);
    if (childLayers.length) layer.set(k, Math.max(1, Math.min(...childLayers) - 1));
  }
  // Nodes with nothing connected go to the bottom row, out of the way.
  const connected = new Set(edges.flatMap((e) => [e.source, e.target]));
  const deepest = Math.max(0, ...[...layer.values()]);
  for (const k of keys) if (!connected.has(k) && keys.length > 1) layer.set(k, deepest + 1);

  const rows = new Map<number, string[]>();
  for (const k of keys) {
    const l = layer.get(k)!;
    rows.set(l, [...(rows.get(l) ?? []), k]);
  }
  const x = new Map<string, number>();
  const pos = new Map<string, { x: number; y: number }>();
  for (const l of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(l)!;
    const centre = (k: string) => {
      const ps = parents.get(k)!.filter((p) => x.has(p));
      return ps.length ? ps.reduce((s, p) => s + x.get(p)!, 0) / ps.length : Number.POSITIVE_INFINITY;
    };
    row.sort((a, b) => centre(a) - centre(b) || a.localeCompare(b));
    row.forEach((k, i) => {
      const nx = Math.round((i - (row.length - 1) / 2) * X_GAP);
      x.set(k, nx);
      pos.set(k, { x: nx, y: l * Y_GAP });
    });
  }
  return pos;
}
