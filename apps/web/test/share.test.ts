import { shopSphere } from '@scalelab/templates';
import { compressToEncodedURIComponent } from 'lz-string';
import { describe, expect, it } from 'vitest';
import { SAFE_URL_LENGTH, decodeDesign, encodeDesign, readHash, shareUrl } from '../src/lib/share';

const example = () => {
  const d = shopSphere();
  return {
    name: d.meta.name,
    nodes: d.nodes,
    edges: d.edges,
    traffic: { kind: 'ramp' as const, rps: 1000, fromRps: 500, toRps: 5000, durationSec: 60 },
  };
};

describe('share links', () => {
  it('round-trips a design with its traffic settings', () => {
    const design = example();
    const result = decodeDesign(encodeDesign(design));
    expect(result).toEqual({ ok: true, design });
  });

  it('keeps the example link comfortably short', () => {
    const url = shareUrl('https://scale-lab-pi.vercel.app', example());
    expect(url.length).toBeLessThan(SAFE_URL_LENGTH / 2);
  });

  it('reads the design from the hash', () => {
    const url = shareUrl('https://x.app', example());
    const encoded = readHash(new URL(url).hash);
    expect(encoded).toBeDefined();
    expect(decodeDesign(encoded!).ok).toBe(true);
    expect(readHash('#other=1')).toBeUndefined();
  });

  it('rejects damaged links', () => {
    expect(decodeDesign('not-a-real-link').ok).toBe(false);
    expect(decodeDesign('').ok).toBe(false);
  });

  it('rejects data that does not match the schema', () => {
    const bad = compressToEncodedURIComponent(JSON.stringify({ v: 1, name: 'x', nodes: [{ id: 1 }], edges: [] }));
    const result = decodeDesign(bad);
    expect(result.ok).toBe(false);
  });

  it('rejects designs with invalid structure, like unknown technologies', () => {
    const design = example();
    design.nodes[0] = { ...design.nodes[0]!, technologyId: 'made-up-tech' };
    const result = decodeDesign(encodeDesign(design));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/made-up-tech/);
  });

  it('rejects out-of-range traffic', () => {
    const design = { ...example(), traffic: { kind: 'constant' as const, rps: 10_000_000, fromRps: 1, toRps: 1, durationSec: 60 } };
    expect(decodeDesign(encodeDesign(design)).ok).toBe(false);
  });
});
