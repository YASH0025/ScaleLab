import { check } from '../checks';
import { QUEUES, WORKERS } from '../graph';
import { referenceDesign } from '../reference';
import type { Problem } from '../types';

export const notifications: Problem = {
  id: 'notification-system',
  title: 'Notification system',
  tagline: 'Push, email and SMS for every product team',
  difficulty: 'Medium',
  minutes: 40,
  brief:
    'Design a notification service other teams call to reach users by push, email or SMS. Most notifications are triggered one by one, but marketing campaigns send to millions at once.',
  functional: ['Send a notification to a user on one or more channels', 'Respect user preferences and quiet hours', 'Retry failed sends; never send the same notification twice', 'Track delivery status'],
  nonFunctional: ['Accepting a send request takes under 200 ms (p95)', 'A campaign must not delay urgent notifications (like login codes)', 'Survive a provider outage without losing notifications'],
  scale: ['10 million notifications a day', 'Campaign peaks of 1,000 send requests per second', 'Each provider call takes 150–300 ms', 'Logs kept 30 days, about 1 KB each'],
  estimates: [
    { id: 'avg', question: 'Notifications per second (average)', unit: 'per second', answer: 116, working: '10,000,000 ÷ 86,400 ≈ 116 per second.' },
    { id: 'concurrency', question: 'Sends in flight at peak (1,000/s × 0.25 s)', unit: 'at once', answer: 250, working: '1,000 per second × 0.25 s per provider call ≈ 250 calls in flight: workers must run many in parallel.' },
    { id: 'logs', question: 'Log storage for 30 days', unit: 'GB', answer: 300, working: '10 M × 1 KB × 30 = 300 GB.' },
  ],
  targets: { peakRps: 1000, writeShare: 0.9, p95Ms: 200, maxErrorRate: 0.001 },
  checks: [
    check.entry(),
    check.redundant(),
    check.async({ label: 'Sends go through a queue to workers', why: 'Provider calls are slow and fail sometimes; the API should accept the request and let workers deliver.' }),
    check.tech(['firebase-cloud-messaging', 'sendgrid', 'twilio'], {
      id: 'providers',
      label: 'Workers deliver through push, email or SMS providers',
      concepts: ['notifications'],
      why: 'You don’t run mail servers or SMS gateways; providers do.',
      fix: 'Connect workers to Push notifications, SendGrid or Twilio.',
    }),
    {
      id: 'per-channel',
      kind: 'nice',
      label: 'Each channel has its own queue and workers',
      concepts: ['async', 'redundancy'],
      why: 'If the SMS provider is down, email and push should keep flowing.',
      fix: 'Use a separate queue and worker for each channel.',
      test: (g) => g.of(...QUEUES).filter((q) => g.targets(q.id).some((t) => WORKERS.includes(t.archetype))).length >= 2,
    },
    check.rateLimit({ kind: 'nice', why: 'A buggy caller shouldn’t be able to spam every user.' }),
    check.cache({ kind: 'nice', label: 'Preferences are cached', why: 'Every send checks the user’s preferences; caching them keeps the database calm during campaigns.' }),
    check.monitoring(),
  ],
  followUps: [
    {
      question: 'A provider call fails. What now?',
      answer:
        'Retry with exponential backoff and jitter, a few times. After that, move the message to a dead-letter queue so it doesn’t block others, and alert. Optionally fall back to another channel.',
      concepts: ['retries', 'dead-letter'],
    },
    {
      question: 'How do you avoid sending the same notification twice?',
      answer:
        'Callers pass a notification ID; workers record it (with a unique constraint or Redis SETNX) before sending and skip IDs already sent. Queues deliver at least once, so this deduplication is required.',
      concepts: ['idempotency'],
    },
    {
      question: 'How do login codes stay fast during a 10-million-user campaign?',
      answer:
        'Separate queues by priority: urgent notifications get their own queue and workers, so a campaign backlog never delays them.',
      concepts: ['async'],
    },
    {
      question: 'Could the workers be serverless functions?',
      answer:
        'Yes: SQS can trigger AWS Lambda directly, which scales with the backlog and costs nothing between campaigns. Watch the account’s concurrency limit (it caps parallel sends) and per-request pricing if volume stays high all day.',
      concepts: ['serverless'],
    },
  ],
  concepts: ['requirements', 'estimation', 'async', 'notifications', 'retries', 'dead-letter', 'idempotency', 'rate-limiting', 'caching', 'load-balancing', 'redundancy', 'observability', 'latency', 'failover', 'cost', 'horizontal-scaling', 'serverless'],
  reference: () =>
    referenceDesign(
      'Notification system',
      [
        { id: 'callers', tech: 'web-browser', label: 'Product services' },
        { id: 'gw', tech: 'aws-api-gateway', label: 'API gateway', config: { rateLimitRps: 2000 } },
        { id: 'api', tech: 'go-gin', label: 'Notification API', config: { instances: 2 } },
        { id: 'prefs', tech: 'redis', label: 'Preferences cache', config: { hitRatio: 0.95 } },
        { id: 'db', tech: 'postgresql', label: 'Notification log', config: { readReplicas: 1 } },
        { id: 'pushq', tech: 'aws-sqs', label: 'Push queue' },
        { id: 'emailq', tech: 'aws-sqs', label: 'Email queue' },
        { id: 'pushw', tech: 'background-worker', label: 'Push workers', config: { instances: 3, workersPerInstance: 100 } },
        { id: 'emailw', tech: 'background-worker', label: 'Email workers', config: { instances: 3, workersPerInstance: 100 } },
        { id: 'fcm', tech: 'firebase-cloud-messaging', label: 'Push notifications' },
        { id: 'sendgrid', tech: 'sendgrid', label: 'SendGrid' },
        { id: 'metrics', tech: 'prometheus', label: 'Monitoring' },
      ],
      [
        ['callers', 'gw'],
        ['gw', 'api'],
        ['api', 'prefs'],
        ['api', 'db'],
        ['api', 'pushq'],
        ['api', 'emailq'],
        ['pushq', 'pushw'],
        ['pushw', 'fcm'],
        ['emailq', 'emailw'],
        ['emailw', 'sendgrid'],
        ['api', 'metrics'],
      ],
    ),
  referenceNotes: [
    'The API checks preferences in Redis, logs the request and queues it per channel, then answers.',
    'Push and email have separate queues and workers, so one provider’s outage never blocks the other.',
    'Workers run 100 sends each in parallel because providers take a few hundred milliseconds per call.',
  ],
  api: ['POST /notifications { id, userId, channels[], template, data, priority } → 202 Accepted', 'GET /notifications/{id} → { status per channel }'],
  dataModel: ['notifications(id PK, user_id, channel, status, attempts, created_at)', 'preferences(user_id PK, channels, quiet_hours)'],
};
