import { check } from '../checks';
import { referenceDesign } from '../reference';
import type { Problem } from '../types';

export const aiAssistant: Problem = {
  id: 'ai-assistant',
  title: 'AI assistant over your documents',
  tagline: 'A ChatGPT-style assistant with RAG',
  difficulty: 'Medium',
  minutes: 40,
  brief:
    'Design an AI assistant for a company: employees ask questions in a chat, and answers come from an LLM grounded in the company’s own documents. Documents are uploaded and indexed continuously.',
  functional: ['Ask a question and get an answer that cites company documents', 'Stream the answer as it’s generated', 'Upload documents, which become searchable within minutes'],
  nonFunctional: ['First words of the answer quickly; the full answer under 8 s (p95)', 'Control LLM spend: no one user can run up the bill', 'Keep working when the LLM provider has a bad minute'],
  scale: ['1 million daily users, 10 questions each', 'Peak is 2.5× the average', 'An LLM answer takes 1–3 seconds', 'About 1,500 tokens per question (context plus answer)'],
  estimates: [
    { id: 'avg', question: 'Questions per second (average)', unit: 'per second', answer: 116, working: '1 M × 10 = 10 M a day ÷ 86,400 ≈ 116 per second.' },
    { id: 'concurrent', question: 'LLM calls in flight at peak (300/s × 2 s)', unit: 'at once', answer: 600, working: '300 per second × 2 s each ≈ 600 calls in flight: servers must hold many slow calls at once.' },
    { id: 'tokens', question: 'Tokens per day', unit: 'million', answer: 15000, working: '10 M questions × 1,500 tokens = 15 billion = 15,000 million tokens a day.' },
  ],
  targets: { peakRps: 300, writeShare: 0.02, p95Ms: 8000, maxErrorRate: 0.02 },
  checks: [
    check.tech(['openai-api'], {
      id: 'llm',
      label: 'Answers come from an LLM',
      concepts: ['vector-search'],
      why: 'The model writes the answer from the retrieved context.',
      fix: 'Connect the chat service to the OpenAI API.',
    }),
    check.store(['vector-db'], {
      id: 'vectors',
      label: 'Documents are retrieved by meaning from a vector database',
      concepts: ['vector-search'],
      why: 'Retrieval-augmented generation finds the relevant passages by embedding similarity and gives them to the model.',
      fix: 'Connect the chat service to Pinecone.',
    }),
    check.rateLimit({ why: 'Every question costs money; per-user limits stop one script from running up a huge bill.' }),
    check.async({ label: 'Documents are indexed in the background', why: 'Chunking and embedding a 200-page PDF takes a while; uploads should return at once.' }),
    check.entry(),
    check.redundant(),
    check.usersReach(['realtime-server'], {
      id: 'streaming',
      kind: 'nice',
      label: 'Answers stream over a live connection',
      concepts: ['realtime'],
      why: 'Showing words as they’re generated makes a 3-second answer feel instant.',
      fix: 'Serve chat from a WebSocket server.',
    }),
    check.cache({ kind: 'nice', label: 'Repeated questions hit a cache', why: 'Common questions (“what’s the leave policy?”) can reuse earlier retrieval results.' }),
    check.monitoring(),
  ],
  followUps: [
    {
      question: 'How do you stream the answer?',
      answer:
        'Call the LLM with streaming on and forward tokens to the browser as they arrive, over server-sent events or a WebSocket. Time to first token drops from seconds to a few hundred milliseconds.',
      concepts: ['realtime', 'latency'],
    },
    {
      question: 'How do you keep LLM costs under control?',
      answer:
        'Per-user and per-team rate limits and budgets, a semantic cache for repeated questions, smaller models for simple questions, and trimming retrieved context to what’s relevant.',
      concepts: ['rate-limiting', 'cost', 'caching'],
    },
    {
      question: 'The LLM provider returns errors for a minute. What do users see?',
      answer:
        'Retry with backoff once or twice, fail over to a second provider or model if you have one, and show a clear “try again” message instead of hanging. Timeouts on every call keep servers from filling up with stuck requests.',
      concepts: ['retries', 'failover'],
    },
    {
      question: 'How are documents prepared for retrieval?',
      answer:
        'Split each document into overlapping chunks of a few hundred tokens, embed each chunk, and store the vectors with the document ID and permissions so answers only use what the asker may see.',
      concepts: ['vector-search', 'security'],
    },
  ],
  concepts: ['requirements', 'estimation', 'vector-search', 'rate-limiting', 'async', 'realtime', 'caching', 'retries', 'failover', 'security', 'cost', 'latency', 'load-balancing', 'redundancy', 'observability', 'horizontal-scaling'],
  reference: () =>
    referenceDesign(
      'AI assistant',
      [
        { id: 'users', tech: 'web-browser', label: 'Employees' },
        { id: 'gw', tech: 'aws-api-gateway', label: 'API gateway', config: { rateLimitRps: 400 } },
        { id: 'lb', tech: 'aws-alb', label: 'Load balancer' },
        { id: 'chat', tech: 'websocket-server', label: 'Chat service', config: { instances: 3, workersPerInstance: 500, serviceTime: { kind: 'lognormal', meanMs: 15, p99Ms: 60 } } },
        { id: 'cache', tech: 'redis', label: 'Retrieval cache', config: { hitRatio: 0.3 } },
        { id: 'vectors', tech: 'pinecone', label: 'Document vectors', config: { connectionPool: 200 } },
        { id: 'llm', tech: 'openai-api', label: 'OpenAI' },
        { id: 'ingestq', tech: 'aws-sqs', label: 'Ingestion jobs' },
        { id: 'embedder', tech: 'background-worker', label: 'Chunk and embed', config: { instances: 2, workersPerInstance: 20 } },
        { id: 'docs', tech: 'aws-s3', label: 'Documents' },
        { id: 'metrics', tech: 'datadog', label: 'Monitoring' },
      ],
      [
        ['users', 'gw'],
        ['gw', 'lb'],
        ['lb', 'chat'],
        ['chat', 'cache'],
        ['chat', 'vectors'],
        ['chat', 'llm'],
        ['chat', 'ingestq'],
        ['ingestq', 'embedder'],
        ['embedder', 'docs'],
        ['embedder', 'vectors'],
        ['chat', 'metrics'],
      ],
    ),
  referenceNotes: [
    'The gateway caps traffic at 400 questions a second; per-user budgets sit behind it.',
    'Chat servers hold many slow LLM calls at once (500 slots each) and stream tokens over WebSockets.',
    'Retrieval checks a cache, then Pinecone; uploads are chunked and embedded by background workers.',
  ],
  api: ['WebSocket: ask { conversationId, question } → stream { token } … { done, citations[] }', 'POST /documents → 202 { documentId }'],
  dataModel: ['Vectors: { id, embedding, documentId, chunkText, allowedGroups }', 'conversations(id, user_id, messages[])', 'S3: documents/{id}'],
};
