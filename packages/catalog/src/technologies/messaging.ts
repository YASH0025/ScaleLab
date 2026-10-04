import type { TechnologyDefinition } from '@scalelab/model';
import { computeConfig, logn, queueConfig } from '../defaults';
import { tech } from './clients';

/**
 * Message brokers and event streams. Producers publish and move on; consumers
 * work through the backlog at their own pace. When consumers fall behind, the
 * backlog and lag grow until the broker pushes back.
 */
export const messagingTechnologies: TechnologyDefinition[] = [
  tech({
    id: 'rabbitmq',
    name: 'RabbitMQ',
    category: 'message-queue',
    archetype: 'message-queue',
    icon: 'rabbitmq',
    brandColor: '#FF6600',
    description: 'Message broker for task queues. Consumers compete for messages.',
    tags: ['amqp', 'queue', 'broker'],
    defaults: queueConfig({ publishLatency: logn(1.5, 6), maxBacklog: 100_000 }),
  }),
  tech({
    id: 'aws-sqs',
    name: 'AWS SQS',
    category: 'message-queue',
    archetype: 'message-queue',
    icon: 'amazonsqs',
    brandColor: '#FF4F8B',
    description: 'Managed queue on AWS. Scales without limits; publishes are slower than a local broker.',
    tags: ['aws', 'queue', 'managed'],
    defaults: queueConfig({ publishLatency: logn(12, 45), maxBacklog: 10_000_000 }),
  }),
  tech({
    id: 'kafka',
    name: 'Apache Kafka',
    category: 'event-stream',
    archetype: 'event-stream',
    icon: 'apachekafka',
    brandColor: '#231F20',
    description: 'Event stream. Every consumer group gets every event; partitions cap parallelism.',
    tags: ['streaming', 'events', 'pubsub'],
    defaults: queueConfig({ publishLatency: logn(3, 12), maxBacklog: 1_000_000, partitions: 6, fanOut: true }),
  }),
  tech({
    id: 'redpanda',
    name: 'Redpanda',
    category: 'event-stream',
    archetype: 'event-stream',
    icon: 'redpanda',
    brandColor: '#E2401B',
    description: 'Kafka-compatible event stream with lower latency.',
    tags: ['streaming', 'events', 'kafka-compatible'],
    defaults: queueConfig({ publishLatency: logn(1.5, 6), maxBacklog: 1_000_000, partitions: 6, fanOut: true }),
  }),
];

/** Background workers that consume messages. They use the same settings as backends. */
export const workerTechnologies: TechnologyDefinition[] = [
  tech({
    id: 'background-worker',
    name: 'Background worker',
    category: 'worker',
    archetype: 'worker',
    icon: 'worker',
    brandColor: '#64748B',
    description: 'Any process that takes jobs from a queue: emails, image processing, reports.',
    tags: ['worker', 'jobs', 'consumer'],
    defaults: computeConfig({ instances: 2, workersPerInstance: 8, serviceTime: logn(40, 160) }),
  }),
  tech({
    id: 'celery',
    name: 'Celery',
    category: 'worker',
    archetype: 'worker',
    icon: 'celery',
    brandColor: '#37814A',
    description: 'Python task queue workers.',
    tags: ['python', 'worker', 'jobs'],
    defaults: computeConfig({ instances: 2, workersPerInstance: 4, serviceTime: logn(60, 240) }),
  }),
  tech({
    id: 'sidekiq',
    name: 'Sidekiq',
    category: 'worker',
    archetype: 'worker',
    icon: 'sidekiq',
    brandColor: '#B1003E',
    description: 'Ruby background jobs.',
    tags: ['ruby', 'worker', 'jobs'],
    defaults: computeConfig({ instances: 2, workersPerInstance: 10, serviceTime: logn(40, 160) }),
  }),
  tech({
    id: 'bullmq-worker',
    name: 'BullMQ worker',
    category: 'worker',
    archetype: 'worker',
    icon: 'bullmq',
    brandColor: '#E11D48',
    description: 'Node.js job workers backed by Redis.',
    tags: ['nodejs', 'worker', 'jobs'],
    defaults: computeConfig({ instances: 2, workersPerInstance: 10, serviceTime: logn(25, 100) }),
  }),
  tech({
    id: 'kafka-consumer',
    name: 'Kafka consumer',
    category: 'worker',
    archetype: 'worker',
    icon: 'apachekafka',
    brandColor: '#231F20',
    description: 'A service that reads events from a stream, like a Spring Kafka or KafkaJS consumer.',
    tags: ['kafka', 'worker', 'consumer', 'streaming'],
    defaults: computeConfig({ instances: 2, workersPerInstance: 3, serviceTime: logn(15, 60) }),
  }),
];
