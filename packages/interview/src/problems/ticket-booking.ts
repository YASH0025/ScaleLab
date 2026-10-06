import { check } from '../checks';
import { referenceDesign } from '../reference';
import type { Problem } from '../types';

export const ticketBooking: Problem = {
  id: 'ticket-booking',
  title: 'Ticket booking',
  tagline: 'Like Ticketmaster or BookMyShow',
  difficulty: 'Hard',
  minutes: 45,
  brief:
    'Design ticket sales for a stadium concert. When sales open, a huge crowd arrives at once for 50,000 seats. Each seat must be sold exactly once, and people who pick a seat get a few minutes to pay for it.',
  functional: ['Browse events and see a seat map', 'Hold chosen seats for 10 minutes', 'Pay and confirm the booking', 'Release held seats that aren’t paid for'],
  nonFunctional: ['Pages and seat maps in under 300 ms (p95)', 'No seat is ever sold twice', 'Fair under a rush: bots don’t win'],
  scale: ['2 million fans in the first 10 minutes', '6,000 requests per second at the peak', 'About 1.2% of requests try to hold or buy seats', 'The payment provider allows 100 calls per second'],
  estimates: [
    { id: 'arrivals', question: 'Fans arriving per second in the first 10 minutes', unit: 'per second', answer: 3300, working: '2,000,000 ÷ 600 s ≈ 3,300 per second.' },
    { id: 'bookings', question: 'Booking attempts per second at peak', unit: 'per second', answer: 72, working: '6,000 × 1.2% = 72 per second.' },
    { id: 'sellout', question: 'Minutes to sell out at that rate', unit: 'minutes', answer: 12, working: '50,000 seats ÷ 72 per second ≈ 700 s ≈ 12 minutes.' },
  ],
  targets: { peakRps: 6000, writeShare: 0.012, p95Ms: 300, maxErrorRate: 0.002 },
  checks: [
    check.rateLimit({ why: 'Bots and refresh storms would otherwise take every seat and every server.' }),
    check.cdn({ why: 'Event pages are the same for everyone and can be served from the edge.' }),
    check.entry(),
    check.redundant(),
    check.cache({ why: 'Seat maps are read thousands of times per second; Redis keeps them off the database.' }),
    check.store(['relational-db'], {
      id: 'transactions',
      label: 'Bookings are written to a transactional database',
      concepts: ['transactions', 'consistency'],
      why: 'Selling a seat exactly once needs transactions and row locks (or a unique constraint), which relational databases do well.',
      fix: 'Connect the booking service to PostgreSQL or MySQL.',
    }),
    check.replicated({ why: 'Bookings are money and promises; the database must survive a failure.' }),
    check.async({ label: 'Payments are processed through a queue', why: 'Pacing payment calls keeps them under the provider’s limit during the rush.' }),
    check.tech(['stripe', 'paypal', 'razorpay'], {
      id: 'payments',
      label: 'Payments go through a payment provider',
      concepts: ['idempotency'],
      why: 'Card data stays with the provider.',
      fix: 'Add Stripe, Razorpay or PayPal behind the payment worker.',
    }),
    check.monitoring(),
  ],
  followUps: [
    {
      question: 'Two fans click the same seat at the same moment. Who gets it?',
      answer:
        'The database decides: UPDATE seats SET held_by = ?, held_until = now() + 10 min WHERE id = ? AND (held_by IS NULL OR held_until < now()). Exactly one update succeeds; the other fan is told the seat is taken. Optimistic locking with a version column works the same way.',
      concepts: ['transactions', 'consistency'],
    },
    {
      question: 'Consistency or availability for seat booking?',
      answer:
        'Consistency. It’s better to refuse a booking during a failure than to sell the same seat twice. Event pages, on the other hand, can be served stale from the CDN.',
      concepts: ['consistency'],
    },
    {
      question: 'How do you keep it fair when 2 million people arrive at once?',
      answer:
        'A virtual waiting room admits fans in arrival order at the rate the booking system can handle; combined with per-user limits and bot detection at the gateway.',
      concepts: ['rate-limiting'],
    },
    {
      question: 'What happens to seats held but not paid?',
      answer:
        'Holds expire on their own (the held_until check); a background job also sweeps expired holds back to available so the seat map stays accurate.',
      concepts: ['async'],
    },
  ],
  concepts: ['requirements', 'estimation', 'rate-limiting', 'cdn', 'caching', 'transactions', 'consistency', 'replication', 'async', 'idempotency', 'load-balancing', 'redundancy', 'observability', 'latency', 'failover', 'cost', 'horizontal-scaling'],
  reference: () =>
    referenceDesign(
      'Ticket booking',
      [
        { id: 'fans', tech: 'web-browser', label: 'Fans' },
        { id: 'cdn', tech: 'aws-cloudfront', label: 'CDN', config: { hitRatio: 0.8 } },
        { id: 'room', tech: 'rate-limiter', label: 'Waiting room', config: { rateLimitRps: 8000 } },
        { id: 'lb', tech: 'aws-alb', label: 'Load balancer' },
        { id: 'booking', tech: 'spring-boot', label: 'Booking service', config: { instances: 3 } },
        { id: 'cache', tech: 'redis', label: 'Seat map cache', config: { hitRatio: 0.9 } },
        { id: 'db', tech: 'postgresql', label: 'Bookings DB', config: { readReplicas: 2 } },
        { id: 'payq', tech: 'aws-sqs', label: 'Payment queue' },
        { id: 'payer', tech: 'background-worker', label: 'Payment worker', config: { instances: 3, workersPerInstance: 20 } },
        { id: 'stripe', tech: 'stripe', label: 'Stripe' },
        { id: 'metrics', tech: 'datadog', label: 'Monitoring' },
      ],
      [
        ['fans', 'cdn'],
        ['cdn', 'room'],
        ['room', 'lb'],
        ['lb', 'booking'],
        ['booking', 'cache'],
        ['booking', 'db'],
        ['booking', 'payq'],
        ['payq', 'payer'],
        ['payer', 'stripe'],
        ['payer', 'db'],
        ['booking', 'metrics'],
      ],
    ),
  referenceNotes: [
    'Event pages come from the CDN; a waiting room caps what reaches the booking service.',
    'Seat holds are conditional updates in PostgreSQL, so each seat goes to exactly one fan.',
    'Payments are queued and charged at a steady pace with the booking ID as the idempotency key.',
  ],
  api: ['GET /events/{id}/seats', 'POST /holds { eventId, seatIds[] } → { holdId, expiresAt }', 'POST /bookings { holdId } (Idempotency-Key) → { bookingId, status }'],
  dataModel: ['seats(event_id, seat_id, status, held_by, held_until, version)', 'bookings(id PK, user_id, event_id, seat_ids, status)'],
};
