import { check } from '../checks';
import { referenceDesign } from '../reference';
import type { Problem } from '../types';

export const typeahead: Problem = {
  id: 'typeahead',
  title: 'Search autocomplete',
  tagline: 'Suggestions as you type',
  difficulty: 'Medium',
  minutes: 35,
  brief:
    'Design the suggestion box of a search engine: as someone types, show the 5 most popular searches that start with what they’ve typed. Suggestions must feel instant.',
  functional: ['Return the top 5 suggestions for a prefix', 'Rank by popularity, updated from what people search', 'Handle typos gracefully (nice to have)'],
  nonFunctional: ['Suggestions in under 100 ms (p95): every keystroke waits on them', 'Highly available', 'New trends appear within an hour'],
  scale: ['3 million daily users', '10 searches each, about 4 suggestion requests per search', '10 million distinct popular queries', 'Peak is 2.5× the average'],
  estimates: [
    { id: 'avg', question: 'Suggestion requests per second (average)', unit: 'per second', answer: 1390, working: '3 M × 10 × 4 = 120 M a day ÷ 86,400 ≈ 1,390 per second.' },
    { id: 'peak', question: 'Peak suggestion requests per second', unit: 'per second', answer: 3500, working: '1,390 × 2.5 ≈ 3,500 per second.' },
    { id: 'index', question: 'Size of the suggestion index', unit: 'MB', answer: 500, working: '10 M queries × about 50 bytes ≈ 500 MB: small enough for memory.' },
  ],
  targets: { peakRps: 3500, writeShare: 0.01, p95Ms: 100, maxErrorRate: 0.001 },
  checks: [
    check.entry(),
    check.redundant(),
    check.cache({ why: 'Popular prefixes (“a”, “ip”, “wea”) repeat constantly; Redis answers them in a millisecond.' }),
    check.store(['search-engine'], {
      id: 'index',
      label: 'Suggestions come from a prefix-friendly index',
      concepts: ['search'],
      why: 'A database LIKE "pre%" scan is too slow; an index built for prefixes (Elasticsearch completion, or a trie) answers in milliseconds.',
      fix: 'Connect the suggestion service to Elasticsearch.',
    }),
    check.stream({ label: 'Popularity is updated from search logs in the background', concepts: ['pub-sub', 'async'], why: 'Counting searches must never slow down typing; logs flow through a stream to an aggregator.' }),
    check.cdn({ kind: 'nice', why: 'The most common prefixes can be cached at the edge for everyone.' }),
    check.monitoring(),
  ],
  followUps: [
    {
      question: 'Trie or search engine?',
      answer:
        'A trie stores prefixes as a tree and can keep the top 5 completions at every node, so a lookup is just walking the prefix. It fits in memory at this size. Elasticsearch’s completion suggester gives the same without writing your own, plus typo tolerance.',
      concepts: ['search', 'data-model'],
    },
    {
      question: 'How do you keep 100 ms when the user types fast?',
      answer:
        'Debounce on the client (send after ~50 ms of no typing), cancel stale requests, cache recent prefixes in the browser, and answer popular prefixes from Redis or the CDN.',
      concepts: ['latency', 'caching'],
    },
    {
      question: 'How do new trends show up?',
      answer:
        'Search logs stream to an aggregator that counts queries per time window and rebuilds or patches the index every few minutes; trending terms can get a recency boost.',
      concepts: ['pub-sub'],
    },
  ],
  concepts: ['requirements', 'estimation', 'caching', 'search', 'pub-sub', 'async', 'cdn', 'data-model', 'latency', 'load-balancing', 'redundancy', 'observability', 'failover', 'cost', 'horizontal-scaling'],
  reference: () =>
    referenceDesign(
      'Search autocomplete',
      [
        { id: 'users', tech: 'web-browser', label: 'Searchers' },
        { id: 'cdn', tech: 'cloudflare-cdn', label: 'CDN', config: { hitRatio: 0.6 } },
        { id: 'lb', tech: 'aws-alb', label: 'Load balancer' },
        { id: 'api', tech: 'go-gin', label: 'Suggestion service', config: { instances: 3 } },
        { id: 'cache', tech: 'redis', label: 'Prefix cache', config: { hitRatio: 0.9 } },
        { id: 'index', tech: 'elasticsearch', label: 'Suggestion index', config: { readReplicas: 1, connectionPool: 100 } },
        { id: 'logs', tech: 'kafka', label: 'Search logs' },
        { id: 'aggregator', tech: 'kafka-consumer', label: 'Popularity aggregator', config: { instances: 2 } },
        { id: 'metrics', tech: 'prometheus', label: 'Monitoring' },
      ],
      [
        ['users', 'cdn'],
        ['cdn', 'lb'],
        ['lb', 'api'],
        ['api', 'cache'],
        ['api', 'index'],
        ['api', 'logs'],
        ['logs', 'aggregator'],
        ['aggregator', 'index'],
        ['api', 'metrics'],
      ],
    ),
  referenceNotes: [
    'The CDN and Redis answer most prefixes; misses go to an Elasticsearch completion index with a replica.',
    'Searches are logged to Kafka; an aggregator updates popularity in the index in the background.',
  ],
  api: ['GET /suggest?q=wea&limit=5 → ["weather", "weather tomorrow", …]', 'Cache-Control: max-age=300 for popular prefixes'],
  dataModel: ['Index: suggestion text, popularity, updated_at', 'Redis: suggest:{prefix} → top 5'],
};
