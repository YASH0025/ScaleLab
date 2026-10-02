import type { ArchEdge, ArchNode, Design } from '@scalelab/model';
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

export interface DesignSnapshot {
  name: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
}

export function snapshot(): DesignSnapshot {
  return {
    name: metaMap.get('name') ?? 'Untitled design',
    nodes: [...nodesMap.values()],
    edges: [...edgesMap.values()],
  };
}

export function isEmpty(): boolean {
  return nodesMap.size === 0 && !metaMap.has('name');
}

export function subscribe(listener: () => void): () => void {
  doc.on('update', listener);
  return () => doc.off('update', listener);
}

export function loadDesign(design: Pick<Design, 'nodes' | 'edges'> & { meta: { name: string } }): void {
  doc.transact(() => {
    nodesMap.clear();
    edgesMap.clear();
    for (const n of design.nodes) nodesMap.set(n.id, n);
    for (const e of design.edges) edgesMap.set(e.id, e);
    metaMap.set('name', design.meta.name);
  });
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
export function removeNodes(ids: string[]): void {
  const gone = new Set(ids);
  doc.transact(() => {
    for (const id of ids) nodesMap.delete(id);
    for (const [id, e] of edgesMap) if (gone.has(e.source) || gone.has(e.target)) edgesMap.delete(id);
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
