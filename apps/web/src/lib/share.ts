import { resolveArchetype } from '@scalelab/catalog';
import { ArchEdgeSchema, ArchNodeSchema, type ArchEdge, type ArchNode, validateDesign } from '@scalelab/model';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { z } from 'zod';

/**
 * Share links carry the whole design inside the URL hash:
 *   https://…/play#d=<compressed JSON>
 * The hash never reaches the server, so sharing needs no backend and no account.
 */

export const HASH_KEY = 'd';

/** Links longer than this may be cut off by some chat apps and browsers. */
export const SAFE_URL_LENGTH = 8000;

const TrafficSchema = z.object({
  kind: z.enum(['constant', 'ramp', 'spike']),
  rps: z.number().min(1).max(50_000),
  fromRps: z.number().min(1).max(50_000),
  toRps: z.number().min(1).max(50_000),
  durationSec: z.number().min(1).max(600),
});
export type SharedTraffic = z.infer<typeof TrafficSchema>;

const PayloadSchema = z.object({
  v: z.literal(1),
  name: z.string().max(120),
  nodes: z.array(ArchNodeSchema).max(200),
  edges: z.array(ArchEdgeSchema).max(500),
  traffic: TrafficSchema.optional(),
});

export interface SharedDesign {
  name: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
  traffic?: SharedTraffic;
}

export function encodeDesign(design: SharedDesign): string {
  const payload = { v: 1 as const, ...design };
  return compressToEncodedURIComponent(JSON.stringify(payload));
}

export type DecodeResult = { ok: true; design: SharedDesign } | { ok: false; error: string };

/**
 * Decodes and fully validates a shared design. Everything in a link is untrusted
 * input, so it must match the schema and pass the same structural checks as the canvas.
 */
export function decodeDesign(encoded: string): DecodeResult {
  let json: unknown;
  try {
    const text = decompressFromEncodedURIComponent(encoded);
    if (!text) return { ok: false, error: 'This share link is incomplete or damaged.' };
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This share link is incomplete or damaged.' };
  }
  const parsed = PayloadSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: 'This share link was made by a different version of ScaleLab.' };

  const { name, nodes, edges, traffic } = parsed.data;
  const issues = validateDesign(
    {
      schemaVersion: 1,
      meta: { name: name || 'Shared design', description: '', createdAt: new Date(0).toISOString() },
      nodes,
      edges,
      flows: [],
      workloads: [],
    },
    resolveArchetype,
  ).filter((i) => i.severity === 'error');
  if (issues.length > 0) return { ok: false, error: `This shared design has a problem: ${issues[0]!.message}` };

  return { ok: true, design: { name: name || 'Shared design', nodes, edges, ...(traffic ? { traffic } : {}) } };
}

export function shareUrl(origin: string, design: SharedDesign): string {
  return `${origin}/play#${HASH_KEY}=${encodeDesign(design)}`;
}

/** Reads the encoded design from a location hash like "#d=…". */
export function readHash(hash: string): string | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return params.get(HASH_KEY) ?? undefined;
}
