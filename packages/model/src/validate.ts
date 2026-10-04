import { checkConnection } from './connections';
import type { Archetype, ArchetypeConfig, Design, FlowStep } from './schemas';
import { DesignSchema } from './schemas';

export interface DesignIssue {
  severity: 'error' | 'warning';
  /** Node, edge or flow id the issue belongs to, when there is one. */
  targetId?: string;
  message: string;
}

/** Resolves a technology id to its archetype. Supplied by the catalog. */
export type ArchetypeResolver = (technologyId: string) => Archetype | undefined;

/** The config `type` each archetype must use. Archetypes not listed use 'generic'. */
const CONFIG_TYPE: Partial<Record<Archetype, ArchetypeConfig['type']>> = {
  client: 'client',
  'load-balancer': 'load-balancer',
  'compute-service': 'compute',
  cache: 'cache',
  'relational-db': 'relational-db',
  worker: 'compute',
  'message-queue': 'queue',
  'event-stream': 'queue',
};

export function expectedConfigType(archetype: Archetype): ArchetypeConfig['type'] {
  return CONFIG_TYPE[archetype] ?? 'generic';
}

function collectFlowNodeIds(steps: FlowStep[], out: string[]): void {
  for (const step of steps) {
    switch (step.kind) {
      case 'call':
      case 'publish':
        out.push(step.nodeId);
        break;
      case 'service-call':
        out.push(step.nodeId);
        collectFlowNodeIds(step.steps, out);
        break;
      case 'cache-lookup':
        out.push(step.cacheNodeId);
        collectFlowNodeIds(step.onHit, out);
        collectFlowNodeIds(step.onMiss, out);
        break;
      case 'parallel':
        for (const branch of step.branches) collectFlowNodeIds(branch, out);
        break;
      case 'respond':
        break;
    }
  }
}

/**
 * Checks a design for structural problems: shape errors, broken references,
 * invalid connections and configs that don't match their technology.
 * Returns an empty list when the design is valid.
 */
export function validateDesign(input: unknown, resolveArchetype: ArchetypeResolver): DesignIssue[] {
  const parsed = DesignSchema.safeParse(input);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      severity: 'error' as const,
      message: `${issue.path.join('.') || 'design'}: ${issue.message}`,
    }));
  }
  const design: Design = parsed.data;
  const issues: DesignIssue[] = [];

  const archetypes = new Map<string, Archetype>();
  const seen = new Set<string>();
  for (const node of design.nodes) {
    if (seen.has(node.id)) {
      issues.push({ severity: 'error', targetId: node.id, message: `Duplicate node id "${node.id}".` });
      continue;
    }
    seen.add(node.id);
    const archetype = resolveArchetype(node.technologyId);
    if (!archetype) {
      issues.push({
        severity: 'error',
        targetId: node.id,
        message: `Unknown technology "${node.technologyId}".`,
      });
      continue;
    }
    archetypes.set(node.id, archetype);
    const expected = expectedConfigType(archetype);
    if (node.config.type !== expected) {
      issues.push({
        severity: 'error',
        targetId: node.id,
        message: `"${node.label}" is a ${archetype} and needs a "${expected}" config, not "${node.config.type}".`,
      });
    }
  }

  for (const node of design.nodes) {
    if (node.parentId === undefined) continue;
    const parent = archetypes.get(node.parentId);
    if (parent !== 'infra-group') {
      issues.push({
        severity: 'error',
        targetId: node.id,
        message: `"${node.label}" is placed inside "${node.parentId}", which is not an infrastructure group.`,
      });
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of design.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push({ severity: 'error', targetId: edge.id, message: `Duplicate edge id "${edge.id}".` });
      continue;
    }
    edgeIds.add(edge.id);
    const source = archetypes.get(edge.source);
    const target = archetypes.get(edge.target);
    if (!source || !target) {
      issues.push({
        severity: 'error',
        targetId: edge.id,
        message: `Edge "${edge.id}" points to a node that doesn't exist.`,
      });
      continue;
    }
    if (edge.source === edge.target) {
      issues.push({ severity: 'error', targetId: edge.id, message: 'A component cannot connect to itself.' });
      continue;
    }
    const check = checkConnection(source, target);
    if (!check.valid) {
      issues.push({ severity: 'error', targetId: edge.id, message: check.reason ?? 'Invalid connection.' });
    } else if (!check.protocols.includes(edge.protocol)) {
      issues.push({
        severity: 'error',
        targetId: edge.id,
        message: `${source} → ${target} can't use "${edge.protocol}". Allowed: ${check.protocols.join(', ')}.`,
      });
    }
  }

  const flowIds = new Set(design.flows.map((flow) => flow.id));
  for (const flow of design.flows) {
    const referenced: string[] = [flow.entryNodeId];
    collectFlowNodeIds(flow.steps, referenced);
    for (const nodeId of referenced) {
      if (!archetypes.has(nodeId)) {
        issues.push({
          severity: 'error',
          targetId: flow.id,
          message: `Flow "${flow.name}" uses node "${nodeId}", which doesn't exist.`,
        });
      }
    }
  }

  const QUEUES: Archetype[] = ['message-queue', 'event-stream'];
  for (const handler of design.handlers ?? []) {
    const referenced: string[] = [handler.queueNodeId, handler.consumerNodeId];
    collectFlowNodeIds(handler.steps, referenced);
    for (const nodeId of referenced) {
      if (!archetypes.has(nodeId)) {
        issues.push({
          severity: 'error',
          targetId: handler.id,
          message: `Message handler "${handler.id}" uses node "${nodeId}", which doesn't exist.`,
        });
      }
    }
    const queueKind = archetypes.get(handler.queueNodeId);
    if (queueKind && !QUEUES.includes(queueKind)) {
      issues.push({
        severity: 'error',
        targetId: handler.id,
        message: `Message handler "${handler.id}" reads from "${handler.queueNodeId}", which is not a queue or stream.`,
      });
    }
  }

  for (const workload of design.workloads) {
    for (const entry of workload.mix) {
      if (!flowIds.has(entry.flowId)) {
        issues.push({
          severity: 'error',
          targetId: workload.id,
          message: `Workload "${workload.name}" uses flow "${entry.flowId}", which doesn't exist.`,
        });
      }
    }
  }

  const connected = new Set<string>();
  for (const edge of design.edges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }
  for (const node of design.nodes) {
    const archetype = archetypes.get(node.id);
    if (archetype && archetype !== 'infra-group' && !connected.has(node.id)) {
      issues.push({ severity: 'warning', targetId: node.id, message: `"${node.label}" isn't connected to anything.` });
    }
  }

  return issues;
}
