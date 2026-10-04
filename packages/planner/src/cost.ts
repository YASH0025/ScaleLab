import { getTechnology } from '@scalelab/catalog';
import type { ArchNode, Pricing } from '@scalelab/model';

export const HOURS_PER_MONTH = 730;
const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600;

/** Sustained load used for usage-based prices. Unknown usage leaves those lines at their base price. */
export interface Usage {
  /** Requests per second arriving at load balancers. */
  requestsPerSec?: number;
  /** Messages per second published to each queue or stream, by node id. */
  messagesPerSec?: Record<string, number>;
}

export interface CostLine {
  nodeId: string;
  label: string;
  monthlyUsd: number;
  /** What the price is based on, e.g. "2 × m6i.large". */
  basis: string;
  /** True when the price depends on traffic, not just configuration. */
  usageBased: boolean;
  /** True when this technology has no price yet. */
  unpriced: boolean;
}

export interface CostEstimate {
  monthlyUsd: number;
  lines: CostLine[];
  unpricedCount: number;
}

const SIZES = ['large', 'xlarge', '2xlarge', '4xlarge', '8xlarge', '16xlarge'];

/**
 * How many size steps a database must grow to serve `queries` at once.
 * Each step doubles the instance (and the price): large → xlarge → 2xlarge…
 */
export function databaseSizeSteps(queries: number, queriesPerUnit: number): number {
  let steps = 0;
  while (queriesPerUnit * 2 ** steps < queries && steps < SIZES.length - 1) steps++;
  return steps;
}

function resize(instanceClass: string, steps: number): string {
  if (steps === 0) return instanceClass;
  return instanceClass.replace(/large$/, SIZES[steps]!);
}

const money = (n: number) => Math.round(n * 100) / 100;

function lineFor(node: ArchNode, pricing: Pricing | undefined, usage: Usage): Omit<CostLine, 'nodeId' | 'label'> {
  const c = node.config;
  if (!pricing) return { monthlyUsd: 0, basis: 'Not priced yet', usageBased: false, unpriced: true };
  switch (pricing.kind) {
    case 'free':
      return { monthlyUsd: 0, basis: 'Runs on users’ devices', usageBased: false, unpriced: false };
    case 'per-instance': {
      const count = c.type === 'compute' ? c.instances : 1;
      return {
        monthlyUsd: money(pricing.hourlyUsd * HOURS_PER_MONTH * count),
        basis: `${count} × ${pricing.instanceClass}`,
        usageBased: false,
        unpriced: false,
      };
    }
    case 'database': {
      const pool = c.type === 'relational-db' ? c.connectionPool : pricing.queriesPerUnit;
      const replicas = c.type === 'relational-db' ? c.readReplicas : 0;
      const steps = databaseSizeSteps(pool, pricing.queriesPerUnit);
      const perInstance = pricing.hourlyUsd * 2 ** steps * HOURS_PER_MONTH;
      const size = resize(pricing.instanceClass, steps);
      return {
        monthlyUsd: money(perInstance * (1 + replicas)),
        basis: replicas > 0 ? `${size} + ${replicas} read replica${replicas > 1 ? 's' : ''}` : size,
        usageBased: false,
        unpriced: false,
      };
    }
    case 'node':
      return { monthlyUsd: money(pricing.hourlyUsd * HOURS_PER_MONTH), basis: pricing.instanceClass, usageBased: false, unpriced: false };
    case 'cluster':
      return {
        monthlyUsd: money(pricing.hourlyUsd * HOURS_PER_MONTH * pricing.nodes),
        basis: `${pricing.nodes} × ${pricing.instanceClass}`,
        usageBased: false,
        unpriced: false,
      };
    case 'load-balancer': {
      const rps = usage.requestsPerSec ?? 0;
      const units = rps / pricing.requestsPerSecPerUnit;
      return {
        monthlyUsd: money((pricing.hourlyUsd + units * pricing.unitHourlyUsd) * HOURS_PER_MONTH),
        basis: usage.requestsPerSec === undefined ? 'Base price; traffic adds capacity units' : `Base + ${units.toFixed(1)} capacity units`,
        usageBased: true,
        unpriced: false,
      };
    }
    case 'third-party':
      return { monthlyUsd: 0, basis: `Billed by ${pricing.provider} per use, not included`, usageBased: true, unpriced: false };
    case 'per-request': {
      const perSec = usage.messagesPerSec?.[node.id];
      const requests = (perSec ?? 0) * SECONDS_PER_MONTH * pricing.requestsPerMessage;
      return {
        monthlyUsd: money((requests / 1_000_000) * pricing.perMillionUsd),
        basis: perSec === undefined ? 'Pay per message; run a simulation to estimate' : `${Math.round(perSec).toLocaleString('en-US')} messages/s`,
        usageBased: true,
        unpriced: false,
      };
    }
  }
}

/** Monthly cost of a design at a sustained load, line by line. */
export function estimateCost(nodes: ArchNode[], usage: Usage = {}): CostEstimate {
  const lines: CostLine[] = nodes.map((node) => {
    const tech = getTechnology(node.technologyId);
    return { nodeId: node.id, label: node.label, ...lineFor(node, tech?.pricing, usage) };
  });
  return {
    monthlyUsd: money(lines.reduce((sum, l) => sum + l.monthlyUsd, 0)),
    lines,
    unpricedCount: lines.filter((l) => l.unpriced).length,
  };
}

export function formatUsd(n: number): string {
  return n >= 100 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`;
}
