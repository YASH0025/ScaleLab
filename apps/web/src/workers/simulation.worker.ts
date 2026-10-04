/// <reference lib="webworker" />
import { getLibrary } from '@scalelab/catalog';
import { type Simulation, createSimulation } from '@scalelab/engine';
import type { FromWorker, ToWorker } from './protocol';

/**
 * Runs the simulation off the main thread so the canvas stays smooth.
 * Every frame it advances simulated time by (real time × speed) and posts
 * any new per-second samples.
 */
const FRAME_MS = 50;

let sim: Simulation | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let speed = 5;
let paused = false;
let targetMs = 0;
let sent = 0;

const post = (msg: FromWorker) => (self as unknown as Worker).postMessage(msg);

function stop() {
  if (timer) clearInterval(timer);
  timer = undefined;
  sim = undefined;
}

function frame() {
  if (!sim || paused) return;
  try {
    targetMs += FRAME_MS * speed;
    const finished = sim.runUntil(targetMs);
    const all = sim.samples;
    if (all.length > sent) {
      post({ type: 'tick', simTimeMs: Math.min(targetMs, sim.currentTimeMs || targetMs), samples: all.slice(sent) });
      sent = all.length;
    }
    if (finished) {
      const result = sim.result();
      post({
        type: 'done',
        totals: result.totals,
        nodes: result.nodes,
        warnings: result.warnings,
        ...(result.journeys ? { journeys: result.journeys } : {}),
      });
      stop();
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    stop();
  }
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'start':
      stop();
      try {
        sim = createSimulation(msg.design, msg.workload, {
          libraryEffect: (id) => getLibrary(id)?.effect,
          traceEvery: 500,
          maxTraces: 50,
        });
      } catch (err) {
        post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        return;
      }
      speed = msg.speed;
      paused = false;
      targetMs = 0;
      sent = 0;
      timer = setInterval(frame, FRAME_MS);
      break;
    case 'pause':
      paused = true;
      break;
    case 'resume':
      paused = false;
      break;
    case 'speed':
      speed = msg.speed;
      break;
    case 'inject':
      sim?.inject(msg.change);
      break;
    case 'stop':
      stop();
      break;
  }
};
