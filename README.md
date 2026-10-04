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
| `packages/planner` | Cost estimates from list prices, and a capacity planner that finds the cheapest setup meeting your targets |
| `packages/importer` | Reads a project's setup files (docker-compose, package.json, requirements.txt, pom.xml, go.mod, .csproj, .env…) and turns them into a design |
| `packages/templates` | Ready-to-run architectures: ShopSphere (e-commerce), ShopSphere microservices (services + Kafka + workers) and ShopSphere checkout (Auth0, Stripe, SendGrid and a Checkout journey) |
| `packages/config` | Shared TypeScript configuration |

What comes next is in [ROADMAP.md](ROADMAP.md): infrastructure import, trace calibration, a CI check, and "what will break" impact analysis.

## Run the playground

```bash
npm install
npm run dev -w @scalelab/web
```

Open http://localhost:3000, try the e-commerce example or the microservices + Kafka example, and press **Run**. Then delete Redis and run again to watch PostgreSQL become the bottleneck, or select the backend and kill an instance mid-run.

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

The engine simulates `client`, `load-balancer`, `compute-service`, `cache`, `relational-db`, `message-queue`, `event-stream` and `worker`. Other technologies can already be placed and connected, and show a "simulation coming soon" badge.

### Microservices and async messaging

- **Service-to-service calls**: a service can call other services. The callee takes a worker, does its own work and dependencies, then frees the worker and replies; the caller waits the whole time, so a slow or saturated downstream service slows everything above it.
- **Queues and streams**: producers wait only for the broker's acknowledgement. Messages wait in a backlog until a consumer is free. Streams (Kafka, Redpanda) give every consumer group every message, and partitions cap how many are processed at once; queues (RabbitMQ, SQS) make consumers share the work.
- **Failure behavior**: a full backlog rejects publishes; a broker outage fails the requests that publish; a consumer outage builds a backlog that drains when it returns; messages that keep failing are retried, then dead-lettered.

Flows are derived from the canvas: every service behind the entry point gets traffic, calls follow the arrows between services, and writes publish to the queues a service is connected to.

## Capacity planning and cost

- **Cost estimate**: every component has a list-price estimate (AWS us-east-1, on-demand, checked October 2026): backends per instance, databases sized by concurrent queries plus read replicas, caches, Kafka clusters, load balancer capacity units, and SQS per message. Storage, data transfer, frontend hosting and discounts are not included.
- **Plan capacity**: set a traffic level and targets (p95 latency, error rate, queue lag, and headroom: how busy any component may be). The planner simulates candidate setups the way an engineer would (scale the component closest to the root cause, keep the change that helps most per dollar) and then removes anything that isn't needed. It recommends the cheapest setup that meets every target, and applies it to the canvas in one click.
- It changes capacity only (instances, read replicas, database size, partitions). When only faster code or a cache would help, it says so instead.

## Import your project

Paste a public GitHub link (`github.com/owner/repo`, or a `/tree/branch/folder` link) or choose a folder from your computer. ScaleLab draws your architecture from your setup files and shows what it found before loading anything.

- **What it reads**: docker-compose (the main file and its override), package.json, requirements.txt, pyproject.toml, Pipfile, pom.xml, build.gradle, go.mod, .csproj, Dockerfiles (for the base image), Prisma schemas and .env examples. Never source code. `node_modules`, tests, examples and docs are skipped, and at most 200 files are read.
- **How it decides**:
  - Containers by image: `postgres:16` is PostgreSQL, `bitnami/kafka` is Kafka, `traefik` is modeled as Nginx. Dev tools (pgAdmin, MailHog, Kafka UI…) and ZooKeeper are skipped.
  - Apps by their dependencies: `@nestjs/core` is NestJS, `django` is Django, `spring-boot-starter-web` is Spring Boot, `github.com/gin-gonic/gin` is Gin. Similar frameworks are modeled as the closest one (Flask as FastAPI, Fastify as Express) and say so.
  - What apps talk to, from client packages (`pg`, `ioredis`, `kafkajs`, `stripe`…), connection strings in env (`postgres://…@db`) and `depends_on`.
  - Workers from compose commands (`celery … worker`) or from projects with no web framework that read a queue. Celery, BullMQ and Sidekiq jobs on Redis become a **Redis job queue**.
  - A full-stack Next.js app becomes the frontend plus its server code.
- **Review**: every component shows its evidence (like `kafkajs in api/package.json`). Inferences are marked "guess", and anything skipped is listed with the reason. Untick what's wrong, then load.
- **Privacy**: GitHub repos are read straight from GitHub by your browser. Folders are read in your browser and never uploaded. Private repos need GitHub sign-in, which comes later; until then, use the folder option.
- **Limits**: 60 GitHub API reads an hour without signing in, and one import uses 2 (files come from raw.githubusercontent.com, which is not counted). Calls between services are only known from compose `depends_on` and URLs in env, so for many independent services traffic starts at all of them. Kubernetes and Terraform come in version 2.

## Business journeys and failure paths

- **Outside services**: Stripe, PayPal, Razorpay, Twilio, SendGrid, OpenAI, Auth0, Clerk and a generic third-party API. Each has a response time, an error rate (fails before anything happens), a "slow, no reply" rate (the work is done, like a card being charged, but the caller times out) and a rate limit (429 above it). Break them live: outage or +2 s latency.
- **Side effects**: a write step records what it changed, like "saved to Orders DB", "Stripe call went through" or "sent to Order events".
- **Journeys**: users start a journey at a steady rate and go through its steps in order (1 s between steps). Each step calls one service as a read or a write, with 0–5 retries (0.5 s apart) and an optional idempotency key, which makes repeats of the same work count once.
- **Results**: how many users finished, a per-step funnel, and findings with fixes:
  - work that happened more than once ("Stripe call went through more than once"): send an idempotency key;
  - a step that failed after part of it was done ("Pay failed, but Stripe call went through anyway"): make it all-or-nothing, undo on failure, or retry with an idempotency key;
  - failures that left nothing behind on a step without retries: one retry would recover most of them.
- **Export as k6 test**: a k6 script with one constant-arrival-rate scenario per journey, the same steps, retries and Idempotency-Key headers. URLs are placeholders built from service names.
- Try it: open the checkout example (`/play?template=checkout`), run the Checkout journey, then tick "Idem. key" on Pay and run it again.

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
