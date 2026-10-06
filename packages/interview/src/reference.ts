import { getTechnology } from '@scalelab/catalog';
import type { ArchetypeConfig, Design } from '@scalelab/model';
import { type NodeSpec, buildDesign } from '@scalelab/templates';

/** A component in a model answer: no coordinates, they're laid out automatically. */
export interface RefNode {
  id: string;
  tech: string;
  label: string;
  config?: Partial<ArchetypeConfig>;
  libraries?: string[];
}

const X_GAP = 260;
const Y_GAP = 170;

/**
 * Builds a model answer and lays it out top-down from where traffic starts,
 * each row ordered under its parents so arrows don't cross much.
 */
export function referenceDesign(name: string, nodes: RefNode[], links: Array<[string, string]>): Design {
  const ids = nodes.map((n) => n.id);
  const layer = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const [a, b] of links) {
      if (layer.get(a)! + 1 > layer.get(b)!) {
        layer.set(b, Math.min(layer.get(a)! + 1, ids.length));
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Monitoring sits at the bottom, out of the request path.
  const deepest = Math.max(...layer.values());
  for (const n of nodes) if (getTechnology(n.tech)?.archetype === 'observability') layer.set(n.id, deepest + 1);

  const rows = new Map<number, string[]>();
  for (const id of ids) rows.set(layer.get(id)!, [...(rows.get(layer.get(id)!) ?? []), id]);
  const x = new Map<string, number>();
  const parents = (id: string) => links.filter(([, b]) => b === id).map(([a]) => a);
  const specs = new Map<string, NodeSpec>();
  for (const l of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(l)!;
    const centre = (id: string) => {
      const ps = parents(id).filter((p) => x.has(p));
      return ps.length ? ps.reduce((s, p) => s + x.get(p)!, 0) / ps.length : 0;
    };
    row.sort((a, b) => centre(a) - centre(b));
    row.forEach((id, i) => {
      const nx = Math.round((i - (row.length - 1) / 2) * X_GAP);
      x.set(id, nx);
      const n = nodes.find((m) => m.id === id)!;
      specs.set(id, { id, tech: n.tech, label: n.label, x: nx, y: l * Y_GAP, ...(n.config ? { config: n.config } : {}), ...(n.libraries ? { libraries: n.libraries } : {}) });
    });
  }
  return buildDesign(name, '', ids.map((id) => specs.get(id)!), links);
}
