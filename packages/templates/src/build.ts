import { getTechnology, resolveArchetype } from '@scalelab/catalog';
import {
  type ArchEdge,
  type ArchNode,
  type ArchetypeConfig,
  type Design,
  type Distribution,
  checkConnection,
  deriveFlows,
  derivedMix,
} from '@scalelab/model';

export interface NodeSpec {
  id: string;
  tech: string;
  label: string;
  x: number;
  y: number;
  libraries?: string[];
  /** Applied on top of the catalog defaults for this technology. */
  config?: Partial<ArchetypeConfig>;
}

const CLIENT_LATENCY: Distribution = { kind: 'lognormal', meanMs: 20, p99Ms: 80 };
const INTERNAL_LATENCY: Distribution = { kind: 'lognormal', meanMs: 0.5, p99Ms: 2 };

/**
 * Builds a design from a compact spec, the same way the canvas does:
 * catalog defaults for every node, the first allowed protocol for every edge,
 * and flows derived from the graph.
 */
export function buildDesign(name: string, description: string, specs: NodeSpec[], links: Array<[string, string]>): Design {
  const nodes: ArchNode[] = specs.map((spec) => {
    const tech = getTechnology(spec.tech);
    if (!tech) throw new Error(`Unknown technology "${spec.tech}".`);
    const defaults = JSON.parse(JSON.stringify(tech.defaults)) as ArchetypeConfig;
    return {
      id: spec.id,
      technologyId: spec.tech,
      label: spec.label,
      position: { x: spec.x, y: spec.y },
      config: { ...defaults, ...spec.config } as ArchetypeConfig,
      libraries: (spec.libraries ?? []).map((libraryId) => ({ libraryId })),
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: ArchEdge[] = links.map(([source, target]) => {
    const from = getTechnology(byId.get(source)!.technologyId)!.archetype;
    const to = getTechnology(byId.get(target)!.technologyId)!.archetype;
    const check = checkConnection(from, to);
    if (!check.valid) throw new Error(`Invalid link ${source} → ${target}: ${check.reason}`);
    return {
      id: `e-${source}-${target}`,
      source,
      target,
      protocol: check.protocols[0]!,
      networkLatency: from === 'client' ? CLIENT_LATENCY : INTERNAL_LATENCY,
    };
  });
  const { flows, handlers } = deriveFlows(nodes, edges, resolveArchetype);
  return {
    schemaVersion: 1,
    meta: { name, description, createdAt: '2026-10-04T00:00:00.000Z' },
    nodes,
    edges,
    flows,
    handlers,
    workloads: [
      {
        id: 'ramp',
        name: 'Launch-day ramp',
        durationSec: 60,
        pattern: { kind: 'ramp', fromRps: 500, toRps: 5000 },
        mix: derivedMix(flows),
        seed: 42,
      },
    ],
  };
}
