import { check } from '../checks';
import { SERVICES } from '../graph';
import { referenceDesign } from '../reference';
import type { Problem } from '../types';

export const chat: Problem = {
  id: 'chat',
  title: 'Chat app',
  tagline: 'Like WhatsApp or Messenger',
  difficulty: 'Hard',
  minutes: 45,
  brief:
    'Design a one-to-one and small-group chat app. Messages appear instantly for people who are online, reach people who are offline as a push notification, and the history is kept.',
  functional: ['Send and receive messages in real time', 'Delivered and read receipts', 'Push notifications for offline users', 'Message history on every device', 'Online / last-seen status'],
  nonFunctional: ['A message reaches an online recipient in under 200 ms (p95)', 'No message is ever lost', 'Messages in a conversation stay in order'],
  scale: ['1 million daily active users', '40 messages sent per user per day', 'About 20% of users online at peak', 'Messages are about 100 bytes', 'Peak is 3× the average'],
  estimates: [
    { id: 'messages', question: 'Messages per second (average)', unit: 'per second', answer: 460, working: '1 M × 40 = 40 M a day ÷ 86,400 ≈ 460 per second.' },
    { id: 'peak', question: 'Messages per second at peak', unit: 'per second', answer: 1400, working: '460 × 3 ≈ 1,400 per second.' },
    { id: 'connections', question: 'Open connections at peak', unit: 'connections', answer: 200000, working: '20% of 1 M users online = 200,000 WebSockets.' },
    { id: 'storage', question: 'Message storage per year', unit: 'GB', answer: 1460, working: '40 M × 100 bytes = 4 GB a day × 365 ≈ 1.5 TB.' },
  ],
  targets: { peakRps: 3000, writeShare: 0.5, p95Ms: 200, maxErrorRate: 0.001 },
  checks: [
    check.usersReach(['realtime-server'], {
      id: 'websockets',
      label: 'Users stay connected to WebSocket servers',
      concepts: ['realtime'],
      why: 'Polling every second for 200,000 users wastes requests and adds delay; a live connection lets the server push instantly.',
      fix: 'Add a WebSocket server and connect users (through a load balancer) to it.',
    }),
    check.redundant({ why: 'Losing the only connection server would disconnect everyone at once.' }),
    {
      id: 'presence',
      label: 'Who is online (and on which server) lives in Redis',
      kind: 'must',
      concepts: ['caching', 'realtime'],
      why: 'Connection servers need to find the server holding the recipient’s connection, fast.',
      fix: 'Connect the WebSocket servers to Redis.',
      test: (g) => g.linked(SERVICES, ['cache']),
    },
    check.store(['wide-column-db'], {
      id: 'messages-store',
      label: 'Messages are stored in a write-friendly, partitioned store',
      concepts: ['nosql', 'sharding', 'data-model'],
      why: 'Chat is write-heavy and read by conversation; Cassandra or DynamoDB partitioned by conversation ID fits exactly.',
      fix: 'Connect the chat servers to Cassandra or DynamoDB.',
    }),
    check.async({ label: 'Delivery and notifications run in the background', concepts: ['async', 'pub-sub'], why: 'Sending a push through Apple or Google takes hundreds of milliseconds; the sender shouldn’t wait.' }),
    check.tech(['firebase-cloud-messaging'], {
      id: 'push',
      label: 'Offline users get push notifications',
      concepts: ['notifications'],
      why: 'An offline phone has no open connection; only APNs or FCM can wake it.',
      fix: 'Have a worker send through Push notifications (FCM / APNs).',
    }),
    check.media({ kind: 'nice', why: 'Photos and voice notes belong in object storage, delivered through a CDN.' }),
    check.monitoring(),
  ],
  followUps: [
    {
      question: 'How do messages stay in order?',
      answer:
        'Order within a conversation, not globally: give each message a per-conversation sequence number and partition the stream and the store by conversation ID, so one partition sees one conversation’s messages in order.',
      concepts: ['pub-sub', 'consistency'],
    },
    {
      question: 'User A is on server 3 and user B is on server 7. How does A’s message reach B?',
      answer:
        'Server 3 looks up B in the presence store (Redis: user → server), then forwards to server 7 directly or through pub/sub. If B isn’t connected anywhere, the message is stored and a push notification goes out.',
      concepts: ['realtime', 'caching'],
    },
    {
      question: 'How do you guarantee no message is lost?',
      answer:
        'Write the message to the durable store before acknowledging the sender, give it a client-generated ID so retries don’t duplicate it, and deliver from the store until the recipient acknowledges.',
      concepts: ['idempotency', 'retries'],
    },
    {
      question: 'What changes for group chats of 500 people?',
      answer:
        'One message fans out to 500 recipients. Store it once and fan out message IDs (or deliver through a per-group channel); very large groups move toward fan-out on read.',
      concepts: ['fan-out'],
    },
  ],
  concepts: ['requirements', 'estimation', 'realtime', 'caching', 'nosql', 'sharding', 'data-model', 'async', 'pub-sub', 'notifications', 'object-storage', 'cdn', 'consistency', 'idempotency', 'retries', 'fan-out', 'redundancy', 'horizontal-scaling', 'observability', 'latency', 'failover', 'cost'],
  reference: () =>
    referenceDesign(
      'Chat app',
      [
        { id: 'users', tech: 'mobile-app', label: 'App users' },
        { id: 'lb', tech: 'aws-alb', label: 'Load balancer' },
        { id: 'ws', tech: 'websocket-server', label: 'Chat servers', config: { instances: 3 } },
        { id: 'presence', tech: 'redis', label: 'Presence', config: { hitRatio: 0.95 } },
        { id: 'messages', tech: 'cassandra', label: 'Messages' },
        { id: 'events', tech: 'aws-sqs', label: 'Delivery queue' },
        { id: 'delivery', tech: 'background-worker', label: 'Delivery workers', config: { instances: 4, workersPerInstance: 100 } },
        { id: 'push', tech: 'firebase-cloud-messaging', label: 'Push notifications' },
        { id: 'metrics', tech: 'prometheus', label: 'Monitoring' },
      ],
      [
        ['users', 'lb'],
        ['lb', 'ws'],
        ['ws', 'presence'],
        ['ws', 'messages'],
        ['ws', 'events'],
        ['events', 'delivery'],
        ['delivery', 'push'],
        ['ws', 'metrics'],
      ],
    ),
  referenceNotes: [
    'Three WebSocket servers hold live connections; Redis records who is online and where.',
    'Each message is written to Cassandra, then queued; delivery workers push it to offline users through FCM / APNs.',
    'Workers wait on Apple and Google for about 150 ms per push, so they run many sends in parallel.',
  ],
  api: ['WebSocket: send { conversationId, clientMsgId, text }', 'WebSocket: receive { message }, ack { messageId }', 'GET /conversations/{id}/messages?before='],
  dataModel: ['messages(conversation_id, seq, sender_id, text, sent_at) partitioned by conversation_id', 'Redis: presence:{userId} → server, last_seen'],
};
