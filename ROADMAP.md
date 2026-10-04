# ScaleLab roadmap

ScaleLab helps teams answer three questions before they build:

1. **Will it handle the load?**
2. **Will it work correctly when things fail?**
3. **What will it cost?**

All numbers ScaleLab shows are modeled estimates, never measurements of a real system.

## Done

- **Playground**: drag technologies onto a canvas, connect them, run simulated traffic, break things live, see the bottleneck explained.
- **Share by link**: a whole design in one URL, no account needed.
- **1. Microservices and async queues**: services calling services; RabbitMQ, SQS, Kafka and Redpanda with consumer lag, partitions, retries and dead letters.
- **2. Capacity planner and cost estimator**: monthly cost from AWS list prices, and a planner that finds the cheapest setup meeting latency, error, lag and headroom targets, then applies it in one click. Later: GCP and Azure prices, editable prices, reserved and spot discounts.
- **7. Business journeys and failure paths**: outside services (Stripe, PayPal, Razorpay, Twilio, SendGrid, OpenAI, Auth0, Clerk) with response time, errors, "slow, no reply" timeouts and rate limits. Journeys send users through steps in order with retries and idempotency keys, and show where they drop off, which steps failed halfway ("charged, but no order") and which work happened twice ("charged twice"), each with a fix. Journeys export as a k6 load test. Later: branches (payment failed → retry page), bad-data responses, and Playwright and Postman exports.

## Next

### 3. Infrastructure import
- Turn docker-compose, Kubernetes YAML or Terraform files into a ScaleLab design automatically.

### 4. Trace calibration
- Import traces from OpenTelemetry or Jaeger to replace guessed latencies and call patterns with measured ones.

### 5. Architecture as code and CI check
- A `scalelab.yaml` file that lives in the repository.
- A GitHub Action that runs the simulation and the business journeys on every pull request and fails it when a change breaks a latency budget or a journey.

### 6. Live changes and "What will break?"
- Change the architecture while traffic flows and watch the system react.
- Before applying a change, see its impact: the new bottleneck, how far the breaking point moves, which journeys fail, and how the cost changes.

## Build order

1. ~~Microservices and async queues~~
2. ~~Capacity planner and cost estimator~~
3. ~~Business journeys and failure paths (point 7)~~
4. Infrastructure import
5. Trace calibration
6. Architecture as code and CI check
7. Live changes and "What will break?"

The points keep their original numbers; the build order reflects what each feature depends on.
