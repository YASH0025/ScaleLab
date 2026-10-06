import { check } from '../checks';
import { referenceDesign } from '../reference';
import type { Problem } from '../types';

export const flashSale: Problem = {
  id: 'flash-sale',
  title: 'Flash sale',
  tagline: 'An online store on its biggest sale day',
  difficulty: 'Medium',
  minutes: 40,
  brief:
    'An online store runs a one-day mega sale. At 12:00 sharp, traffic jumps to 20× normal: millions browse deals, and a small share check out and pay. Design the store so it stays fast, never oversells, and takes every payment safely.',
  functional: ['Browse products and deals', 'Add to cart and check out', 'Pay through a payment provider', 'Order confirmation by email or push'],
  nonFunctional: ['Pages in under 300 ms (p95) at peak', 'Never sell more items than are in stock', 'Never charge a customer twice', 'Bots must not crowd out real customers'],
  scale: ['6,000 requests per second at the peak (20× a normal day)', 'About 1.5% of requests are checkouts', 'The payment provider allows 100 calls per second', 'Product pages change rarely during the sale'],
  estimates: [
    { id: 'orders', question: 'Checkouts per second at peak', unit: 'per second', answer: 90, working: '6,000 × 1.5% = 90 per second.' },
    { id: 'normal', question: 'Requests per second on a normal day', unit: 'per second', answer: 300, working: '6,000 ÷ 20 = 300 per second.' },
    { id: 'headroom', question: 'Payment calls left under the provider’s limit at peak', unit: 'per second', answer: 10, working: '100 allowed − 90 needed = 10 per second of headroom: payments must be paced, never bursted.' },
  ],
  targets: { peakRps: 6000, writeShare: 0.015, p95Ms: 300, maxErrorRate: 0.002 },
  checks: [
    check.cdn({ why: 'Most of the sale traffic is the same product pages; the edge can answer it.' }),
    check.entry(),
    check.redundant(),
    check.cache({ why: 'Product and stock lookups hit the same few hot items; the database can’t take 6,000 reads a second alone.' }),
    check.rateLimit({ why: 'Bots hammer flash sales; a limit at the door keeps capacity for real customers.' }),
    check.async({ label: 'Payments are processed in the background through a queue', why: 'The provider allows 100 calls a second; a queue paces payments so a burst never gets 429s or blocks checkout.' }),
    check.tech(['stripe', 'paypal', 'razorpay'], {
      id: 'payments',
      label: 'Payments go through a payment provider',
      concepts: ['idempotency'],
      why: 'Card data never touches your servers; the provider handles it.',
      fix: 'Add Stripe, Razorpay or PayPal behind the payment worker.',
    }),
    check.replicated({ why: 'Orders are money; the database must survive a machine failure.' }),
    check.monitoring(),
  ],
  followUps: [
    {
      question: 'How do you stop overselling the last 100 units?',
      answer:
        'Decrement stock atomically: UPDATE stock SET qty = qty - 1 WHERE id = ? AND qty > 0 (a row lock), or a Redis DECR that refuses below zero, then confirm in the database. Hold reserved items for 10 minutes and release them if payment doesn’t finish.',
      concepts: ['transactions', 'consistency'],
    },
    {
      question: 'The payment call times out. Did the customer pay?',
      answer:
        'You can’t know, so retry with the same idempotency key (the order ID). The provider returns the original result instead of charging again.',
      concepts: ['idempotency', 'retries'],
    },
    {
      question: 'At 12:00 the cache is empty and everyone asks for the same deal page. What happens?',
      answer:
        'A cache stampede: thousands of misses hit the database at once. Pre-warm the cache before the sale, and let only one request rebuild a missing entry while others wait (request coalescing).',
      concepts: ['caching', 'hot-keys'],
    },
    {
      question: 'Demand is 10× what you can serve. What then?',
      answer:
        'A virtual waiting room: admit users at the rate the system can handle, give everyone else a place in line. Fairer than random errors.',
      concepts: ['rate-limiting'],
    },
  ],
  concepts: ['requirements', 'estimation', 'cdn', 'caching', 'rate-limiting', 'async', 'idempotency', 'retries', 'transactions', 'consistency', 'hot-keys', 'replication', 'load-balancing', 'redundancy', 'observability', 'latency', 'failover', 'cost', 'horizontal-scaling'],
  reference: () =>
    referenceDesign(
      'Flash sale',
      [
        { id: 'shoppers', tech: 'web-browser', label: 'Shoppers' },
        { id: 'cdn', tech: 'cloudflare-cdn', label: 'CDN', config: { hitRatio: 0.8 } },
        { id: 'limiter', tech: 'rate-limiter', label: 'Bot limiter', config: { rateLimitRps: 9000 } },
        { id: 'lb', tech: 'aws-alb', label: 'Load balancer' },
        { id: 'shop', tech: 'spring-boot', label: 'Shop service', config: { instances: 3 } },
        { id: 'cache', tech: 'redis', label: 'Product and stock cache', config: { hitRatio: 0.9 } },
        { id: 'db', tech: 'postgresql', label: 'Orders DB', config: { readReplicas: 2 } },
        { id: 'payq', tech: 'aws-sqs', label: 'Payment queue' },
        { id: 'payer', tech: 'background-worker', label: 'Payment worker', config: { instances: 3, workersPerInstance: 20 } },
        { id: 'stripe', tech: 'stripe', label: 'Stripe' },
        { id: 'metrics', tech: 'datadog', label: 'Monitoring' },
      ],
      [
        ['shoppers', 'cdn'],
        ['cdn', 'limiter'],
        ['limiter', 'lb'],
        ['lb', 'shop'],
        ['shop', 'cache'],
        ['shop', 'db'],
        ['shop', 'payq'],
        ['payq', 'payer'],
        ['payer', 'stripe'],
        ['payer', 'db'],
        ['shop', 'metrics'],
      ],
    ),
  referenceNotes: [
    'The CDN answers 80% of page views; a limiter turns away bot floods above 9,000 per second.',
    'Redis carries product and stock reads; PostgreSQL has two replicas.',
    'Checkout saves the order and queues the payment; a worker charges Stripe at a pace under its limit.',
  ],
  api: ['GET /deals, GET /products/{id}', 'POST /cart/items', 'POST /orders (Idempotency-Key) → { orderId, status: "pending" }', 'GET /orders/{id}'],
  dataModel: ['stock(product_id PK, qty, version)', 'orders(id PK, user_id, status, total, idempotency_key UNIQUE)', 'Redis: product:{id}, stock:{id}'],
};
