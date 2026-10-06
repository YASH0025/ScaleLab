import { check } from '../checks';
import { WORKERS } from '../graph';
import { referenceDesign } from '../reference';
import type { Problem } from '../types';

export const webCrawler: Problem = {
  id: 'web-crawler',
  title: 'Web crawler',
  tagline: 'Crawl the web for a search engine',
  difficulty: 'Medium',
  minutes: 40,
  brief:
    'Design a crawler that downloads web pages for a search engine. It starts from seed URLs, fetches pages, stores them, and follows links to new URLs, without crawling the same page twice or overloading any website.',
  functional: ['Fetch pages from a frontier of URLs', 'Store page content for indexing', 'Skip URLs already crawled', 'Respect robots.txt and per-site politeness'],
  nonFunctional: ['Crawl about 2 billion pages a month', 'Keep going when websites are slow, broken or down', 'Never hit one website too hard'],
  scale: ['2 billion pages a month', 'Pages average 100 KB', 'Websites take about 300 ms to answer, and some fail'],
  estimates: [
    { id: 'rate', question: 'Pages per second', unit: 'per second', answer: 770, working: '2,000,000,000 ÷ (30 × 86,400 s) ≈ 770 per second.' },
    { id: 'storage', question: 'Storage per month', unit: 'TB', answer: 200, working: '2 B × 100 KB = 200 TB a month.' },
    { id: 'parallel', question: 'Fetches in flight at once', unit: 'at once', answer: 230, working: '770 per second × 0.3 s per fetch ≈ 230 at once: fetchers must run many requests in parallel.' },
  ],
  targets: { peakRps: 800, writeShare: 1, p95Ms: 200, maxErrorRate: 0.001 },
  checks: [
    check.async({ label: 'URLs wait in a frontier queue for fetchers', concepts: ['async'], why: 'The frontier decouples finding URLs from fetching them, and absorbs slow websites.' }),
    {
      id: 'fetchers-scale',
      label: 'Fetchers run on several machines',
      kind: 'must',
      concepts: ['horizontal-scaling', 'redundancy'],
      why: '230 fetches in flight, against websites that hang, needs many workers.',
      fix: 'Set Instances to 2 or more on the fetcher worker.',
      test: (g) => g.of(...WORKERS).some((w) => g.instances(w) >= 2),
    },
    check.objectStorage({ why: '200 TB a month of raw pages only fits in object storage.' }),
    check.store(['wide-column-db', 'document-db'], {
      id: 'seen-urls',
      label: 'Seen URLs are tracked in a NoSQL store',
      concepts: ['nosql', 'data-model'],
      why: 'Billions of “have we crawled this?” lookups by key are a perfect fit for DynamoDB or Cassandra.',
      fix: 'Connect the frontier API or the fetchers to DynamoDB or Cassandra.',
    }),
    check.redundant({ kind: 'nice', why: 'The frontier API should survive losing one instance.' }),
    check.monitoring(),
  ],
  followUps: [
    {
      question: 'How do you avoid hammering one website?',
      answer:
        'Politeness: route URLs into per-host queues and let each host be fetched by one worker at a time, with a delay between requests (and the crawl-delay from robots.txt). Effectively a rate limit per website.',
      concepts: ['rate-limiting'],
    },
    {
      question: 'How do you detect duplicates?',
      answer:
        'Normalize URLs (lowercase host, strip fragments and tracking parameters) and check a seen-set; a Bloom filter in memory answers most “seen?” checks without a lookup. For content duplicates on different URLs, compare a content hash or SimHash.',
      concepts: ['data-model'],
    },
    {
      question: 'DNS lookups are slow. What do you do?',
      answer:
        'Run a local caching DNS resolver for the crawler; with millions of pages per host, almost every lookup becomes a cache hit.',
      concepts: ['dns', 'caching'],
    },
    {
      question: 'A page fails to load. Then what?',
      answer:
        'Retry a few times with backoff; after that, park the URL in a dead-letter queue and try it again much later, so broken sites don’t clog the frontier.',
      concepts: ['retries', 'dead-letter'],
    },
  ],
  concepts: ['requirements', 'estimation', 'async', 'horizontal-scaling', 'redundancy', 'object-storage', 'nosql', 'data-model', 'rate-limiting', 'dns', 'caching', 'retries', 'dead-letter', 'observability', 'latency', 'failover', 'cost'],
  reference: () =>
    referenceDesign(
      'Web crawler',
      [
        { id: 'scheduler', tech: 'web-browser', label: 'Seed scheduler' },
        { id: 'api', tech: 'go-gin', label: 'Frontier API', config: { instances: 2 } },
        { id: 'seen', tech: 'dynamodb', label: 'Seen URLs' },
        { id: 'frontier', tech: 'aws-sqs', label: 'URL frontier' },
        { id: 'fetchers', tech: 'background-worker', label: 'Fetchers', config: { instances: 4, workersPerInstance: 100 } },
        { id: 'web', tech: 'third-party-api', label: 'The web', config: { latency: { kind: 'lognormal', meanMs: 300, p99Ms: 2000 }, errorRate: 0.02, timeoutRate: 0.01, timeoutMs: 5000 } },
        { id: 'pages', tech: 'aws-s3', label: 'Page store' },
        { id: 'metrics', tech: 'prometheus', label: 'Monitoring' },
      ],
      [
        ['scheduler', 'api'],
        ['api', 'seen'],
        ['api', 'frontier'],
        ['frontier', 'fetchers'],
        ['fetchers', 'web'],
        ['fetchers', 'pages'],
        ['api', 'metrics'],
      ],
    ),
  referenceNotes: [
    'The frontier API skips URLs already in DynamoDB and queues new ones.',
    '400 fetches run in parallel across 4 workers; broken pages are retried and then dead-lettered by the queue.',
    'Raw pages go to S3 for the indexer.',
  ],
  api: ['POST /urls { urls[] } (from seeds and from link extraction)', 'Worker: receive URL → fetch → store → report links'],
  dataModel: ['seen_urls(url_hash PK, last_crawled, status)', 'S3: pages/{yyyy-mm}/{url_hash}.html'],
};
