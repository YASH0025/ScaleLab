import type { ArchEdge, ArchNode, Design, Journey } from '@scalelab/model';
import * as Y from 'yjs';

/**
 * The Yjs document is the single source of truth for the design.
 * Today it is saved to the browser (IndexedDB). Later the same document syncs
 * between collaborators through a Hocuspocus server, with no change to this API.
 *
 * Granularity: each node and edge is one entry in a Y.Map, so two people editing
 * different components never conflict.
 */
export const doc = new Y.Doc();
const nodesMap = doc.getMap<ArchNode>('nodes');
const edgesMap = doc.getMap<ArchEdge>('edges');
const metaMap = doc.getMap<string>('meta');
const journeysMap = doc.getMap<Journey>('journeys');

export interface DesignSnapshot {
  name: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
  journeys: Journey[];
}

export function snapshot(): DesignSnapshot {
  return {
    name: metaMap.get('name') ?? 'Untitled design',
    nodes: [...nodesMap.values()],
    edges: [...edgesMap.values()],
    journeys: [...journeysMap.values()],
  };
}

export function isEmpty(): boolean {
  return nodesMap.size === 0 && !metaMap.has('name');
}

export function subscribe(listener: () => void): () => void {
  doc.on('update', listener);
  return () => doc.off('update', listener);
}

export function loadDesign(design: Pick<Design, 'nodes' | 'edges' | 'journeys'> & { meta: { name: string } }): void {
  doc.transact(() => {
    nodesMap.clear();
    edgesMap.clear();
    journeysMap.clear();
    for (const n of design.nodes) nodesMap.set(n.id, n);
    for (const e of design.edges) edgesMap.set(e.id, e);
    for (const j of design.journeys ?? []) journeysMap.set(j.id, j);
    metaMap.set('name', design.meta.name);
  });
}

export function saveJourney(journey: Journey): void {
  journeysMap.set(journey.id, journey);
}

export function removeJourney(id: string): void {
  journeysMap.delete(id);
}

export function clearDesign(name = 'Untitled design'): void {
  loadDesign({ nodes: [], edges: [], meta: { name } });
}

export function renameDesign(name: string): void {
  metaMap.set('name', name);
}

export function addNode(node: ArchNode): void {
  nodesMap.set(node.id, node);
}

export function updateNode(id: string, update: (node: ArchNode) => ArchNode): void {
  const current = nodesMap.get(id);
  if (current) nodesMap.set(id, update(current));
}

export function moveNode(id: string, position: { x: number; y: number }): void {
  updateNode(id, (n) => ({ ...n, position: { x: Math.round(position.x), y: Math.round(position.y) } }));
}

/** Removes nodes and every edge touching them. */
/** Removes nodes, every edge touching them, and journey steps that used them. */
export function removeNodes(ids: string[]): void {
  const gone = new Set(ids);
  doc.transact(() => {
    for (const id of ids) nodesMap.delete(id);
    for (const [id, e] of edgesMap) if (gone.has(e.source) || gone.has(e.target)) edgesMap.delete(id);
    for (const [id, j] of journeysMap) {
      if (!j.steps.some((s) => gone.has(s.serviceNodeId))) continue;
      const steps = j.steps.filter((s) => !gone.has(s.serviceNodeId));
      if (steps.length === 0) journeysMap.delete(id);
      else journeysMap.set(id, { ...j, steps });
    }
  });
}

export function addEdge(edge: ArchEdge): void {
  for (const e of edgesMap.values()) if (e.source === edge.source && e.target === edge.target) return;
  edgesMap.set(edge.id, edge);
}

export function removeEdges(ids: string[]): void {
  doc.transact(() => {
    for (const id of ids) edgesMap.delete(id);
  });
}

let persistenceStarted: Promise<void> | undefined;

/** Starts browser persistence once; resolves when saved data has loaded. */
export function startPersistence(): Promise<void> {
  if (!persistenceStarted) {
    persistenceStarted = import('y-indexeddb').then(
      ({ IndexeddbPersistence }) =>
        new Promise<void>((resolve) => {
          const persistence = new IndexeddbPersistence('scalelab-design', doc);
          persistence.once('synced', () => resolve());
        }),
    );
  }
  return persistenceStarted;
}
