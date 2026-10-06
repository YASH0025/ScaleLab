import type { SimulationResult } from '@scalelab/engine';
import type { Design } from '@scalelab/model';
import type { Graph } from './graph';

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

/** A back-of-the-envelope question with its worked answer. */
export interface Estimate {
  id: string;
  question: string;
  unit: string;
  answer: number;
  /** The math, shown after grading. */
  working: string;
}

/** Something a good design has, checked on the canvas. */
export interface Check {
  id: string;
  /** What we look for, in plain words: "Reads go through a cache". */
  label: string;
  /** Must-haves decide the design score; nice-to-haves add a little on top. */
  kind: 'must' | 'nice';
  concepts: string[];
  /** Why it matters for this problem. */
  why: string;
  /** How to add it on the canvas. */
  fix: string;
  test: (g: Graph) => boolean;
}

/** A check on the simulation results, for problems where the outcome itself is the lesson. */
export interface SimCheck {
  id: string;
  label: string;
  concepts: string[];
  why: string;
  fix: string;
  test: (result: SimulationResult, g: Graph) => boolean;
}

export interface FollowUp {
  question: string;
  answer: string;
  concepts: string[];
}

export interface Problem {
  id: string;
  title: string;
  /** One line under the title. */
  tagline: string;
  difficulty: Difficulty;
  minutes: number;
  /** The interviewer's prompt. */
  brief: string;
  functional: string[];
  nonFunctional: string[];
  /** The scale, in numbers the estimates are built from. */
  scale: string[];
  estimates: Estimate[];
  targets: {
    /** Requests per second at peak, simulated against the design. */
    peakRps: number;
    /** Share of requests that are writes (posting, uploading, sending). */
    writeShare: number;
    p95Ms: number;
    /** Share of requests allowed to fail at peak. */
    maxErrorRate: number;
  };
  checks: Check[];
  simChecks?: SimCheck[];
  followUps: FollowUp[];
  /** Every concept this problem practices: its checks, follow-ups and estimates. */
  concepts: string[];
  /** A strong answer, and why it's built that way. */
  reference: () => Design;
  referenceNotes: string[];
  /** Suggested API and data model, part of the model answer. */
  api: string[];
  dataModel: string[];
}

export type GradeInput = {
  problem: Problem;
  design: Pick<Design, 'nodes' | 'edges'>;
  /** Estimate answers by id. */
  estimates: Record<string, number | undefined>;
};
