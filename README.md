# ScaleLab

See how your system behaves before it goes live.

ScaleLab is a free, browser-based playground for application architecture. Drag technologies onto a canvas, attach the libraries they use, connect them, then run simulated traffic and watch requests flow, queues build up and bottlenecks appear.

> All numbers ScaleLab shows are **modeled estimates** from your configuration, not measurements of a real system.

## Status

Early development. This repository currently contains the foundation:

| Package | What it does |
|---|---|
| `packages/model` | Shared architecture model: types and Zod schemas for nodes, edges, libraries, API flows, workloads and results; connection rules; design validation |
| `packages/catalog` | Technologies and libraries as data, with realistic default settings |
| `packages/config` | Shared TypeScript configuration |

Next up: the simulation engine (`packages/engine`), then the canvas app (`apps/web`).

## How the model works

Every technology maps to a **behavior archetype** the engine knows how to simulate. Spring Boot, NestJS and Django are all a `compute-service`; PostgreSQL and MySQL are both a `relational-db`. Only their default numbers differ. Adding a new technology or library is a catalog entry, not new engine code.

The MVP simulates five archetypes: `client`, `load-balancer`, `compute-service`, `cache` and `relational-db`. Other technologies can already be placed and connected, and show a "simulation coming soon" badge.

## Development

Requirements: Node.js 20+ and pnpm 10.

```bash
pnpm install
pnpm typecheck   # TypeScript across all packages
pnpm test        # Vitest across all packages
```

## Repository layout

```
apps/            # web app (Next.js), API (NestJS) and collaboration server, later
packages/
  config/        # shared tsconfig
  model/         # types, schemas, connection rules, validation
  catalog/       # technologies + libraries as data
```
