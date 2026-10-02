# ScaleLab

See how your system behaves before it goes live.

ScaleLab is a free, browser-based playground for application architecture. Drag technologies onto a canvas, attach the libraries they use, connect them, then run simulated traffic and watch requests flow, queues build up and bottlenecks appear.

> All numbers ScaleLab shows are **modeled estimates** from your configuration, not measurements of a real system.

## Status

Early development. This repository currently contains the foundation and the simulation engine:

| Package | What it does |
|---|---|
| `apps/web` | The playground: Next.js app with the canvas, component library, inspector, live simulation and metrics |
| `packages/model` | Shared architecture model: types and Zod schemas for nodes, edges, libraries, API flows, workloads and results; connection rules; design validation |
| `packages/catalog` | Technologies and libraries as data, with realistic default settings |
| `packages/engine` | Discrete-event simulation engine: traffic, queues, failures, retries, metrics and traces. Pure TypeScript, runs in a Web Worker or Node |
| `packages/templates` | Ready-to-run architectures, starting with ShopSphere (e-commerce) |
| `packages/config` | Shared TypeScript configuration |

Next up: sharing designs by link, request traces, and more simulated technologies.

## Run the playground

```bash
npm install
npm run dev -w @scalelab/web
```

Open http://localhost:3000, try the e-commerce example, and press **Run**. Then delete Redis and run again to watch PostgreSQL become the bottleneck, or select the backend and kill an instance mid-run.

Your design saves automatically in your browser.

## Try the engine

```bash
npm install
npm run demo -w @scalelab/engine
```

This runs the ShopSphere launch-day ramp (500 → 5,000 requests per second) with and without Redis. Without the cache, PostgreSQL saturates around 2,700 rps and errors climb; with it, the same traffic is served with no errors.

## How the engine works

Requests arrive as a Poisson stream that follows the chosen traffic pattern. Each request follows its API flow. Backend workers, database connections and cache connections are pools of slots with FIFO queues: when every slot is busy, requests wait, are rejected when the queue is full, or time out. A backend worker is held until the response is sent, so a slow database backs up the backends too. Nothing is scripted; bottlenecks emerge from these rules.

Runs are deterministic: the same design and seed give identical results on every machine.

## How the model works

Every technology maps to a **behavior archetype** the engine knows how to simulate. Spring Boot, NestJS and Django are all a `compute-service`; PostgreSQL and MySQL are both a `relational-db`. Only their default numbers differ. Adding a new technology or library is a catalog entry, not new engine code.

The MVP simulates five archetypes: `client`, `load-balancer`, `compute-service`, `cache` and `relational-db`. Other technologies can already be placed and connected, and show a "simulation coming soon" badge.

## Deploy to Vercel

The playground is a standard Next.js app inside an npm workspace.

1. On vercel.com, choose **Add New → Project** and import this GitHub repository.
2. Set **Root Directory** to `apps/web`. Vercel detects Next.js and installs the workspace from the repo root.
3. Leave the build settings on their defaults and click **Deploy**.

No environment variables are needed: everything runs in the visitor's browser.

## Development

Requirements: Node.js 20+ and npm 10.

```bash
npm install
npm run typecheck   # TypeScript across all packages
npm test            # Vitest across all packages
```

## Repository layout

```
apps/
  web/           # Next.js playground (API and collaboration server come later)
packages/
  config/        # shared tsconfig
  model/         # types, schemas, connection rules, validation
  catalog/       # technologies + libraries as data
  engine/        # discrete-event simulation engine
  templates/     # ready-made architectures
```
