import { buildDesign } from '@scalelab/templates';
import { describe, expect, it } from 'vitest';
import { CONCEPTS, PROBLEMS, grade, mixFor, problemById, scoreEstimate, verdictFor } from '../src';
import { deriveFlows, isWriteFlow } from '@scalelab/model';
import { resolveArchetype } from '@scalelab/catalog';

const answers = (id: string) => Object.fromEntries(problemById.get(id)!.estimates.map((e) => [e.id, e.answer]));
const conceptIds = new Set(CONCEPTS.map((c) => c.id));

describe('coverage', () => {
  it('has unique concept and problem ids', () => {
    expect(conceptIds.size).toBe(CONCEPTS.length);
    expect(new Set(PROBLEMS.map((p) => p.id)).size).toBe(PROBLEMS.length);
  });

  it('practices every concept in at least one problem', () => {
    const practiced = new Set(PROBLEMS.flatMap((p) => p.concepts));
    const missing = CONCEPTS.filter((c) => !practiced.has(c.id)).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it('only refers to concepts that exist, and lists every concept a problem touches', () => {
    for (const p of PROBLEMS) {
      const used = [...p.checks.flatMap((c) => c.concepts), ...(p.simChecks ?? []).flatMap((c) => c.concepts), ...p.followUps.flatMap((f) => f.concepts)];
      for (const c of [...used, ...p.concepts]) expect(conceptIds.has(c), `${p.id}: ${c}`).toBe(true);
      for (const c of used) expect(p.concepts, `${p.id} should list ${c}`).toContain(c);
    }
  });

  it('gives every problem requirements, estimates, checks, follow-ups and a model answer', () => {
    for (const p of PROBLEMS) {
      expect(p.functional.length, p.id).toBeGreaterThanOrEqual(2);
      expect(p.nonFunctional.length, p.id).toBeGreaterThanOrEqual(2);
      expect(p.estimates.length, p.id).toBeGreaterThanOrEqual(3);
      expect(p.checks.filter((c) => c.kind === 'must').length, p.id).toBeGreaterThanOrEqual(4);
      expect(p.followUps.length, p.id).toBeGreaterThanOrEqual(3);
      expect(p.api.length + p.dataModel.length, p.id).toBeGreaterThanOrEqual(2);
      expect(p.targets.peakRps, p.id).toBeLessThanOrEqual(10_000); // keeps grading fast in the browser
    }
  });
});

describe('model answers', () => {
  for (const p of PROBLEMS) {
    it(`${p.title}: the model answer earns a strong hire`, () => {
      const r = grade({ problem: p, design: p.reference(), estimates: answers(p.id) });
      expect(r.sections.design.checks.filter((c) => c.kind !== 'nice' && !c.passed).map((c) => c.id)).toEqual([]);
      expect(r.sections.performance.score).toBe(25);
      expect(r.sections.resilience.score).toBe(15);
      expect(r.score).toBeGreaterThanOrEqual(95);
      expect(r.verdict).toBe('Strong hire');
    });
  }
});

describe('grading weak designs', () => {
  const naive = () =>
    buildDesign(
      'naive',
      '',
      [
        { id: 'users', tech: 'mobile-app', label: 'Users', x: 0, y: 0 },
        { id: 'api', tech: 'express', label: 'API', x: 0, y: 0, config: { instances: 1 } },
        { id: 'db', tech: 'postgresql', label: 'DB', x: 0, y: 0 },
      ],
      [
        ['users', 'api'],
        ['api', 'db'],
      ],
    );

  it('fails a one-server, one-database photo app on what matters, with fixes', () => {
    const p = problemById.get('instagram')!;
    const r = grade({ problem: p, design: naive(), estimates: {} });
    const failed = r.sections.design.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failed).toEqual(expect.arrayContaining(['entry', 'redundant', 'media', 'cache', 'replicated', 'async']));
    expect(r.sections.estimation.score).toBe(0);
    expect(r.sections.resilience.score).toBe(0);
    expect(r.sections.resilience.notes.join(' ')).toMatch(/API had a single instance/);
    expect(r.score).toBeLessThan(30);
    expect(r.verdict).toBe('No hire');
    expect(r.improvements[0]).toMatch(/: Put an AWS ALB/);
    expect(r.conceptsToReview).toEqual(expect.arrayContaining(['cdn', 'caching', 'async']));
  });

  it('notices when a rate limiter is missing even if the backend copes', () => {
    const p = problemById.get('rate-limiter')!;
    const big = buildDesign(
      'big',
      '',
      [
        { id: 'users', tech: 'web-browser', label: 'Clients', x: 0, y: 0 },
        { id: 'lb', tech: 'aws-alb', label: 'LB', x: 0, y: 0 },
        { id: 'api', tech: 'go-gin', label: 'API', x: 0, y: 0, config: { instances: 4 } },
        { id: 'redis', tech: 'redis', label: 'Redis', x: 0, y: 0 },
      ],
      [
        ['users', 'lb'],
        ['lb', 'api'],
        ['api', 'redis'],
      ],
    );
    const r = grade({ problem: p, design: big, estimates: answers(p.id) });
    expect(r.sections.design.checks.find((c) => c.id === 'rate-limit')!.passed).toBe(false);
    expect(r.sections.design.checks.find((c) => c.id === 'limited')!.passed).toBe(false);
    expect(r.sections.performance.score).toBeLessThan(25);
  });

  it('scores an empty canvas without crashing', () => {
    const p = problemById.get('url-shortener')!;
    const r = grade({ problem: p, design: { nodes: [], edges: [] }, estimates: answers(p.id) });
    expect(r.sections.estimation.score).toBe(15);
    expect(r.sections.performance.peak.ran).toBe(false);
    expect(r.sections.performance.notes[0]).toMatch(/client|Connect/);
    expect(r.score).toBe(15);
  });

  it('is deterministic', () => {
    const p = problemById.get('chat')!;
    const a = grade({ problem: p, design: p.reference(), estimates: {} });
    const b = grade({ problem: p, design: p.reference(), estimates: {} });
    expect(a).toEqual(b);
  });

  it('reports progress while grading', () => {
    const p = problemById.get('pastebin')!;
    const steps: string[] = [];
    grade({ problem: p, design: p.reference(), estimates: {} }, (m) => steps.push(m));
    expect(steps[0]).toMatch(/estimates/);
    expect(steps.some((s) => /Sending 2,000 requests per second/.test(s))).toBe(true);
    expect(steps.some((s) => /Breaking things/.test(s))).toBe(true);
  });
});

describe('scoring rules', () => {
  it('gives full marks within 2×, half within 4×', () => {
    expect(scoreEstimate(1000, 1160, 5).points).toBe(5);
    expect(scoreEstimate(2300, 1160, 5).points).toBe(5);
    expect(scoreEstimate(4000, 1160, 5)).toEqual({ points: 2.5, closeness: 'near' });
    expect(scoreEstimate(100, 1160, 5)).toEqual({ points: 0, closeness: 'off' });
    expect(scoreEstimate(undefined, 1160, 5).closeness).toBe('missing');
  });

  it('maps scores to verdicts', () => {
    expect(verdictFor(90)).toBe('Strong hire');
    expect(verdictFor(72)).toBe('Hire');
    expect(verdictFor(55)).toBe('Lean no hire');
    expect(verdictFor(20)).toBe('No hire');
  });

  it('weights the traffic mix to the problem’s write share', () => {
    const d = problemById.get('instagram')!.reference();
    const { flows } = deriveFlows(d.nodes, d.edges, resolveArchetype);
    const mix = mixFor(flows, 0.02);
    const total = mix.reduce((s, m) => s + m.weight, 0);
    const writes = mix.filter((m) => isWriteFlow(m.flowId)).reduce((s, m) => s + m.weight, 0);
    expect(total).toBeCloseTo(1);
    expect(writes).toBeCloseTo(0.02);
  });
});
