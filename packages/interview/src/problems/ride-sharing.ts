import { check } from '../checks';
import { SERVICES } from '../graph';
import { referenceDesign } from '../reference';
import type { Problem } from '../types';

export const rideSharing: Problem = {
  id: 'ride-sharing',
  title: 'Ride sharing',
  tagline: 'Like Uber or Ola',
  difficulty: 'Hard',
  minutes: 45,
  brief:
    'Design the core of a ride-hailing app. Drivers send their location every few seconds; riders ask for a ride and get matched with a nearby driver. Focus on the hot path: location updates and finding nearby drivers.',
  functional: ['Drivers send their location every 4 seconds', 'Riders see nearby drivers and request a ride', 'Match a rider with a close, available driver', 'Notify both sides about trip updates'],
  nonFunctional: ['Location updates and nearby searches under 200 ms (p95)', 'A driver is never matched to two riders', 'The system keeps working if one server fails'],
  scale: ['20,000 drivers online at peak, sending a location every 4 seconds', 'Riders search nearby drivers about as often in total', '200,000 trips a day', 'Peak is 2.5× the average'],
  estimates: [
    { id: 'updates', question: 'Location updates per second at peak', unit: 'per second', answer: 5000, working: '20,000 drivers ÷ 4 seconds = 5,000 per second.' },
    { id: 'trips', question: 'Trips started per second (average)', unit: 'per second', answer: 2.3, working: '200,000 ÷ 86,400 ≈ 2.3 per second.' },
    { id: 'memory', question: 'Memory for all live locations', unit: 'MB', answer: 2, working: '20,000 drivers × about 100 bytes ≈ 2 MB: it fits in memory easily.' },
  ],
  targets: { peakRps: 4000, writeShare: 0.5, p95Ms: 200, maxErrorRate: 0.001 },
  checks: [
    check.entry(),
    check.redundant(),
    {
      id: 'geo-index',
      label: 'Live locations are kept in an in-memory geo index',
      kind: 'must',
      concepts: ['geo', 'caching'],
      why: '5,000 updates a second of data that is stale after 4 seconds belongs in memory (Redis GEO), not in a database.',
      fix: 'Connect the location service to Redis.',
      test: (g) => g.linked(SERVICES, ['cache']),
    },
    check.store(['relational-db'], {
      id: 'trips-db',
      label: 'Trips are stored in a transactional database',
      concepts: ['transactions', 'data-model'],
      why: 'Assigning a driver must be all-or-nothing so one driver never gets two riders.',
      fix: 'Connect the trip service to PostgreSQL.',
    }),
    check.async({ label: 'Trip events are processed in the background', concepts: ['async', 'pub-sub'], why: 'Notifications, receipts and analytics shouldn’t slow down matching.' }),
    check.tech(['firebase-cloud-messaging'], {
      id: 'push',
      kind: 'nice',
      label: 'Riders and drivers get push notifications',
      concepts: ['notifications'],
      why: '“Your driver is here” must reach a phone that isn’t on the app screen.',
      fix: 'Have a worker send through Push notifications (FCM / APNs).',
    }),
    check.rateLimit({ kind: 'nice', why: 'A buggy app version sending updates every 100 ms shouldn’t take the system down.' }),
    check.monitoring(),
  ],
  followUps: [
    {
      question: 'How do you find drivers within 2 km quickly?',
      answer:
        'Index locations with a geohash (nearby points share a prefix) or a quadtree, or use Redis GEO, which does this for you. Search the rider’s cell and its neighbours instead of every driver.',
      concepts: ['geo'],
    },
    {
      question: 'Two riders request the same driver at once. How do you avoid double booking?',
      answer:
        'Make the assignment atomic: a conditional update (set rider only if the driver is still available) or a short lock with expiry. The loser gets the next closest driver.',
      concepts: ['transactions', 'consistency'],
    },
    {
      question: 'How do you scale to many cities?',
      answer:
        'Partition by region: each city’s locations and matching live on their own shard, since a rider in Mumbai never needs drivers in Delhi.',
      concepts: ['sharding'],
    },
    {
      question: 'How is the rider charged?',
      answer:
        'At trip end, a background worker calls the payment provider with an idempotency key (the trip ID), retrying safely if it times out.',
      concepts: ['idempotency', 'retries'],
    },
  ],
  concepts: ['requirements', 'estimation', 'geo', 'caching', 'transactions', 'data-model', 'async', 'pub-sub', 'notifications', 'consistency', 'sharding', 'idempotency', 'retries', 'rate-limiting', 'load-balancing', 'redundancy', 'observability', 'latency', 'failover', 'cost', 'horizontal-scaling'],
  reference: () =>
    referenceDesign(
      'Ride sharing',
      [
        { id: 'apps', tech: 'mobile-app', label: 'Rider and driver apps' },
        { id: 'gw', tech: 'aws-api-gateway', label: 'API gateway', config: { rateLimitRps: 8000 } },
        { id: 'location', tech: 'go-gin', label: 'Location service', config: { instances: 3 } },
        { id: 'geo', tech: 'redis', label: 'Live locations (GEO)', config: { hitRatio: 1 } },
        { id: 'trips', tech: 'spring-boot', label: 'Trip service', config: { instances: 3 } },
        { id: 'db', tech: 'postgresql', label: 'Trips DB', config: { readReplicas: 1, shards: 4, connectionPool: 150 } },
        { id: 'events', tech: 'aws-sqs', label: 'Trip events' },
        { id: 'notifier', tech: 'background-worker', label: 'Notifier', config: { instances: 4, workersPerInstance: 80 } },
        { id: 'push', tech: 'firebase-cloud-messaging', label: 'Push notifications' },
        { id: 'metrics', tech: 'prometheus', label: 'Monitoring' },
      ],
      [
        ['apps', 'gw'],
        ['gw', 'location'],
        ['location', 'geo'],
        ['gw', 'trips'],
        ['trips', 'db'],
        ['trips', 'events'],
        ['events', 'notifier'],
        ['notifier', 'push'],
        ['location', 'metrics'],
      ],
    ),
  referenceNotes: [
    'Location updates and nearby searches go to a Go service backed by Redis GEO; nothing touches a database.',
    'Trips are written to PostgreSQL (sharded by city, with a replica) inside a transaction.',
    'Trip events queue notifications so matching never waits on Apple or Google.',
  ],
  api: ['PUT /drivers/me/location { lat, lng } (every 4 s)', 'GET /drivers/nearby?lat=&lng=', 'POST /trips { pickup, dropoff } → { tripId, driver }', 'WebSocket/push: trip status updates'],
  dataModel: ['Redis GEO: drivers:{city} → (driverId, lat, lng)', 'trips(id PK, rider_id, driver_id, status, fare, created_at) sharded by city'],
};
