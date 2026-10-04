'use client';

import { getTechnology } from '@scalelab/catalog';
import { checkConnection } from '@scalelab/model';
import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type EdgeChange,
  MiniMap,
  type NodeChange,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
} from '@xyflow/react';
import { type DragEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { createEdge, createNode } from '@/lib/design-helpers';
import { addEdge, addNode, moveNode, removeEdges, removeNodes } from '@/store/design-doc';
import { useDesign } from '@/store/use-design';
import { useUi } from '@/store/use-ui';
import { DRAG_MIME } from '../library/LibraryPanel';
import { FlowEdge, type FlowEdgeType } from './FlowEdge';
import { type TechFlowNode, TechNode } from './TechNode';

const nodeTypes = { tech: TechNode };
const edgeTypes = { flow: FlowEdge };

export function Canvas() {
  const nodes = useDesign((s) => s.nodes);
  const edges = useDesign((s) => s.edges);
  const selectedId = useUi((s) => s.selectedNodeId);
  const select = useUi((s) => s.select);
  const toast = useUi((s) => s.toast);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const fitRequest = useUi((s) => s.fitRequest);
  useEffect(() => {
    if (fitRequest === 0) return;
    // Wait a frame so freshly loaded nodes are measured first.
    const t = setTimeout(() => void fitView({ padding: 0.25, maxZoom: 1, duration: 400 }), 60);
    return () => clearTimeout(t);
  }, [fitRequest, fitView]);
  const [wobbling, setWobbling] = useState(false);

  // Local copy of React Flow nodes so dragging is smooth; committed to the document on drop.
  const [rfNodes, setRfNodes] = useState<TechFlowNode[]>([]);
  useEffect(() => {
    setRfNodes(
      nodes.map((n) => ({
        id: n.id,
        type: 'tech',
        position: n.position,
        data: { arch: n },
        selected: n.id === selectedId,
      })),
    );
  }, [nodes, selectedId]);

  const rfEdges = useMemo<FlowEdgeType[]>(() => {
    const techOf = new Map(nodes.map((n) => [n.id, n.technologyId]));
    return edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'flow',
      data: { arch: e, sourceTechId: techOf.get(e.source) ?? '', targetTechId: techOf.get(e.target) ?? '' },
    }));
  }, [edges, nodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange<TechFlowNode>[]) => {
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id);
      if (removed.length > 0) {
        removeNodes(removed);
        if (selectedId && removed.includes(selectedId)) select(undefined);
      }
      for (const c of changes) if (c.type === 'select' && c.selected) select(c.id);
      setRfNodes((current) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), current));
    },
    [select, selectedId],
  );

  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdgeType>[]) => {
    const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id);
    if (removed.length > 0) removeEdges(removed);
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      const source = nodes.find((n) => n.id === connection.source);
      const target = nodes.find((n) => n.id === connection.target);
      const sourceKind = source && getTechnology(source.technologyId)?.archetype;
      const targetKind = target && getTechnology(target.technologyId)?.archetype;
      if (!source || !target || !sourceKind || !targetKind || source.id === target.id) return;
      const check = checkConnection(sourceKind, targetKind);
      if (!check.valid) {
        toast(check.reason ?? 'Those two can’t be connected.', 'error');
        setWobbling(true);
        setTimeout(() => setWobbling(false), 450);
        return;
      }
      addEdge(createEdge(source, target, check.protocols[0]!));
    },
    [nodes, toast],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const technologyId = event.dataTransfer.getData(DRAG_MIME);
      if (!technologyId) return;
      const position = screenToFlowPosition({ x: event.clientX - 114, y: event.clientY - 30 });
      const node = createNode(technologyId, position, nodes);
      addNode(node);
      select(node.id);
    },
    [nodes, screenToFlowPosition, select],
  );

  return (
    <div
      className={`relative h-full w-full ${wobbling ? 'anim-wobble' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={(_, node) => moveNode(node.id, node.position)}
        onPaneClick={() => select(undefined)}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.3}
        maxZoom={1.75}
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable position="bottom-right" nodeColor="#2c3343" nodeStrokeWidth={0} />
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-2xl border border-dashed border-line-strong bg-panel/80 px-8 py-6 text-center">
            <p className="text-[15px] font-semibold">Drag a technology here to start</p>
            <p className="mt-1 text-[13px] text-muted">Try Next.js, then a load balancer, a backend and a database.</p>
          </div>
        </div>
      )}
    </div>
  );
}
