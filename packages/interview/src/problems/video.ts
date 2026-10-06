import { check } from '../checks';
import { referenceDesign } from '../reference';
import type { Problem } from '../types';

export const video: Problem = {
  id: 'video-streaming',
  title: 'Video streaming',
  tagline: 'Like YouTube or Netflix',
  difficulty: 'Hard',
  minutes: 45,
  brief:
    'Design a video platform. Creators upload videos; viewers search, open and watch them smoothly on any connection. Watching is where almost all the traffic and bandwidth goes.',
  functional: ['Upload a video', 'Convert it into several qualities (240p to 1080p)', 'Watch with adaptive quality', 'Search videos by title'],
  nonFunctional: ['Playback starts fast and never stalls: video segments in under 300 ms (p95)', 'Uploads are never lost', 'Viewing stays up even if parts of the backend fail'],
  scale: [
    '500,000 daily viewers, 5 videos each',
    '20,000 people watching at once at peak',
    'Players fetch a 4-second segment at a time',
    '5,000 new videos a day, about 1 GB each after conversion',
    'Average stream about 5 Mbps',
  ],
  estimates: [
    { id: 'segments', question: 'Segment requests per second at peak', unit: 'per second', answer: 5000, working: '20,000 viewers ÷ 4 seconds per segment = 5,000 per second.' },
    { id: 'bandwidth', question: 'Bandwidth at peak', unit: 'Gbps', answer: 100, working: '20,000 × 5 Mbps = 100,000 Mbps = 100 Gbps.' },
    { id: 'storage', question: 'New storage per day', unit: 'GB', answer: 5000, working: '5,000 videos × 1 GB = 5 TB a day.' },
  ],
  targets: { peakRps: 5000, writeShare: 0.002, p95Ms: 300, maxErrorRate: 0.001 },
  checks: [
    check.media({ why: '100 Gbps can’t come from your servers; a CDN serves segments from the edge, and S3 holds the files.' }),
    check.entry(),
    check.redundant(),
    check.async({ label: 'Uploads are converted in the background', why: 'Converting a 1 GB video takes minutes; it must happen on workers fed by a queue.' }),
    check.store(['search-engine'], {
      id: 'search',
      label: 'Videos can be searched',
      concepts: ['search'],
      why: 'Searching titles and descriptions needs an inverted index.',
      fix: 'Connect the video API to Elasticsearch.',
    }),
    check.cache({ why: 'Video pages and metadata are read far more often than they change.' }),
    check.replicated({ why: 'Video metadata must survive a machine failure.' }),
    check.dns(),
    check.monitoring(),
  ],
  followUps: [
    {
      question: 'How does adaptive quality work?',
      answer:
        'Each video is converted into several qualities and cut into short segments (HLS or DASH), with a manifest listing them. The player measures its bandwidth and picks the best quality for each next segment, so it drops quality instead of stalling.',
      concepts: ['cdn', 'api-design'],
    },
    {
      question: 'Why does the CDN hit ratio matter so much here?',
      answer:
        'Every miss is a full segment fetched from S3 and paid for as origin bandwidth. Going from 90% to 99% hits cuts origin traffic tenfold. Popular videos can even be pushed to edges ahead of time.',
      concepts: ['cdn', 'cost'],
    },
    {
      question: 'How do large uploads survive a flaky connection?',
      answer:
        'Multipart, resumable uploads straight to S3 (pre-signed URLs per part): a dropped connection resumes from the last finished part. When all parts are in, an event queues the conversion job.',
      concepts: ['object-storage', 'async'],
    },
    {
      question: 'How do you count views for 5,000 requests a second?',
      answer:
        'Don’t write a row per view. Batch counts in memory or a stream and add them up periodically; view counts can lag a little.',
      concepts: ['consistency', 'hot-keys'],
    },
  ],
  concepts: ['requirements', 'estimation', 'cdn', 'object-storage', 'async', 'search', 'caching', 'replication', 'dns', 'load-balancing', 'redundancy', 'consistency', 'hot-keys', 'api-design', 'observability', 'latency', 'failover', 'cost', 'horizontal-scaling'],
  reference: () =>
    referenceDesign(
      'Video streaming',
      [
        { id: 'viewers', tech: 'web-browser', label: 'Viewers' },
        { id: 'dns', tech: 'aws-route53', label: 'DNS' },
        { id: 'cdn', tech: 'aws-cloudfront', label: 'Video CDN', config: { hitRatio: 0.97 } },
        { id: 'segments', tech: 'aws-s3', label: 'Video segments' },
        { id: 'lb', tech: 'aws-alb', label: 'Load balancer' },
        { id: 'api', tech: 'spring-boot', label: 'Video API', config: { instances: 3 } },
        { id: 'cache', tech: 'redis', label: 'Metadata cache', config: { hitRatio: 0.9 } },
        { id: 'db', tech: 'postgresql', label: 'Video metadata', config: { readReplicas: 1 } },
        { id: 'search', tech: 'elasticsearch', label: 'Video search', config: { readReplicas: 1 } },
        { id: 'raw', tech: 'aws-s3', label: 'Raw uploads' },
        { id: 'jobs', tech: 'aws-sqs', label: 'Conversion jobs' },
        { id: 'transcoder', tech: 'background-worker', label: 'Transcoders', config: { instances: 4 } },
        { id: 'metrics', tech: 'datadog', label: 'Monitoring' },
      ],
      [
        ['viewers', 'dns'],
        ['dns', 'cdn'],
        ['cdn', 'segments'],
        ['dns', 'lb'],
        ['lb', 'api'],
        ['api', 'cache'],
        ['api', 'db'],
        ['api', 'search'],
        ['api', 'raw'],
        ['api', 'jobs'],
        ['jobs', 'transcoder'],
        ['transcoder', 'segments'],
        ['transcoder', 'db'],
        ['api', 'metrics'],
      ],
    ),
  referenceNotes: [
    'Segments come from S3 through CloudFront; 97% are edge hits, so S3 sees about 150 requests a second.',
    'The API serves pages and search from Redis, PostgreSQL and Elasticsearch.',
    'Uploads land in a raw bucket and queue a conversion job; transcoders write the segments.',
  ],
  api: ['POST /videos/upload-url → { uploadId, partUrls[] }', 'GET /videos/{id} → { title, manifestUrl }', 'GET /search?q=', 'Player: GET {cdn}/videos/{id}/{quality}/seg-{n}.ts'],
  dataModel: ['videos(id PK, owner_id, title, status, duration, created_at)', 'S3: videos/{id}/{quality}/seg-{n}.ts and manifest.m3u8'],
};
