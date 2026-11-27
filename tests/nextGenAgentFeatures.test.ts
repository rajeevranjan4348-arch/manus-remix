import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { issueGuestSessionToken } from '../server/guestSessionAuth';
import { InMemoryCollectionStore } from '../server/infrastructure/durableCollectionStore';
import {
  InMemoryDurableStore,
  type DurableRequestContext,
} from '../server/sandbox/durableStore';
import { PermissionsGatewayService } from '../server/permissionsGateway';
import { BackgroundTaskEngine } from '../server/queue/backgroundTaskEngine';
import {
  SemanticRagEngine,
  chunkDocumentContent,
  cosineSimilarity,
  detectDocumentFormat,
  extractTextFromPdfPayload,
  l2Normalize,
  type EmbeddingProvider,
} from '../server/rag/semanticRagEngine';
import {
  WebhookEngine,
  renderWebhookTemplate,
  verifyInboundSignature,
} from '../server/webhooks/webhookEngine';
import { McpHttpClient } from '../server/mcp/mcpClient';
import { McpBridgeService } from '../server/mcp/mcpBridgeService';
import { LiveSyncHub, type LiveSyncEvent } from '../server/realtime/liveSyncHub';
import {
  buildExtractiveCompactionSummary,
  compactConversationMessages,
  estimateTextTokens,
  type CompactableMessage,
} from '../server/contextCompaction';
import { handleRagRequest } from '../netlify/functions/rag';
import { handleWebhooksRequest } from '../netlify/functions/webhooks';
import { handleMcpRequest } from '../netlify/functions/mcp';
import { handleSyncRequest } from '../netlify/functions/sync';
import { modelRouter } from '../src/lib/modelRouter';
import { LiveSyncClient } from '../src/lib/liveSyncClient';
import { toolRegistry } from '../src/lib/toolFramework';

const TEST_POLICY_SECRET = 'test_policy_gateway_secret_value_0123456789abcdef';

/**
 * Deterministic semantic embedding provider for unit/integration tests.
 * Maps domain concept buckets to orthogonal dimensions so semantically related
 * queries without exact lexical overlap rank accurately via cosine similarity.
 */
function createDeterministicEmbeddingProvider(): EmbeddingProvider {
  const concepts: Array<[string[], number]> = [
    [['kubernetes', 'k8s', 'pod', 'deployment', 'cluster', 'container', 'orchestration'], 0],
    [['postgres', 'postgresql', 'sql', 'database', 'migration', 'schema', 'index'], 1],
    [['invoice', 'billing', 'stripe', 'payment', 'subscription', 'revenue'], 2],
    [['react', 'typescript', 'vite', 'component', 'frontend', 'hook'], 3],
    [['security', 'oauth', 'hmac', 'signature', 'encryption', 'token'], 4],
    [['travel', 'flight', 'hotel', 'itinerary', 'tokyo', 'passport'], 5],
  ];

  const embedOne = (text: string): number[] => {
    const lower = text.toLowerCase();
    const vec = new Array<number>(concepts.length + 2).fill(0.01);
    for (const [keywords, dim] of concepts) {
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) score += 1;
      }
      vec[dim] += score;
    }
    vec[concepts.length] = Math.min(1, lower.length / 500);
    vec[concepts.length + 1] = 0.25;
    return l2Normalize(vec);
  };

  return {
    modelName: 'gemini-embedding-2',
    isConfigured: () => true,
    async embedTexts(texts: string[]) {
      return {
        vectors: texts.map(embedOne),
        mode: 'gemini-embedding-2',
        model: 'gemini-embedding-2',
      };
    },
  };
}

function makeAuthHeaders(): { headers: Record<string, string>; ctx: DurableRequestContext } {
  const session = issueGuestSessionToken();
  return {
    headers: {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    },
    ctx: { userId: session.uid },
  };
}

describe('Feature 1 — Semantic Vector Memory & Document RAG', () => {
  it('detects formats, extracts PDF text streams, and chunks Markdown/code/PDF accurately', () => {
    expect(detectDocumentFormat('# Title', 'README.md')).toBe('markdown');
    expect(detectDocumentFormat('export function run() {}', 'worker.ts')).toBe('code');
    expect(detectDocumentFormat('%PDF-1.7\n(Quarterly Revenue Report) Tj', 'report.pdf')).toBe('pdf');

    const extracted = extractTextFromPdfPayload('%PDF-1.4\nBT (Quarterly Revenue grew 42 percent) Tj ET\n%%EOF');
    expect(extracted).toContain('Quarterly Revenue grew 42 percent');

    const mdChunked = chunkDocumentContent({
      title: 'Architecture.md',
      format: 'markdown',
      content: [
        '# Overview',
        'High level system design for distributed tasks and queues.',
        '',
        '## Database Layer',
        'PostgreSQL handles relational tables with strict migration checks and indexes.',
        '',
        '## Deployment',
        'Kubernetes cluster deploys containerized pods across multiple availability zones.',
      ].join('\n'),
      maxChunkChars: 180,
    });
    expect(mdChunked.chunks.length).toBeGreaterThanOrEqual(2);
    expect(mdChunked.chunks.some((c) => c.heading?.includes('Database Layer'))).toBe(true);

    const codeChunked = chunkDocumentContent({
      title: 'router.ts',
      format: 'code',
      content: [
        'export function calculateCosine(a: number[], b: number[]) {',
        '  return a.reduce((acc, v, i) => acc + v * (b[i] || 0), 0);',
        '}',
        '',
        'export class VectorStore {',
        '  async upsert(id: string, vector: number[]) {',
        '    return { id, dims: vector.length };',
        '  }',
        '}',
      ].join('\n'),
      maxChunkChars: 160,
    });
    expect(codeChunked.chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('indexes documents with dense embeddings, isolates per user, and performs hybrid semantic+BM25 RRF search', async () => {
    const store = new InMemoryCollectionStore();
    const syncHub = new LiveSyncHub(store);
    const engine = new SemanticRagEngine({
      store,
      syncHub,
      embeddingProvider: createDeterministicEmbeddingProvider(),
    });

    const alice: DurableRequestContext = { userId: 'alice_rag' };
    const bob: DurableRequestContext = { userId: 'bob_rag' };

    const indexedK8s = await engine.indexDocument(alice, {
      documentId: 'doc_k8s_guide',
      title: 'Cluster Operations.md',
      sourceType: 'document',
      format: 'markdown',
      content: '# Cluster Guide\nDeploy container pods to the Kubernetes cluster with zero-downtime rollouts.',
    });
    expect(indexedK8s.document.embeddingMode).toBe('gemini-embedding-2');
    expect(indexedK8s.chunksIndexed).toBeGreaterThanOrEqual(1);

    await engine.indexDocument(alice, {
      documentId: 'doc_db_guide',
      title: 'Database Migrations.md',
      sourceType: 'document',
      format: 'markdown',
      content: '# Schema Notes\nPostgreSQL schema migrations require explicit composite indexes for fast SQL queries.',
    });

    await engine.indexDocument(bob, {
      documentId: 'doc_bob_secret',
      title: 'Bob Private Secret.md',
      sourceType: 'memory',
      content: 'Kubernetes orchestration secret key owned exclusively by Bob.',
    });

    // Semantic query ("k8s orchestration") matches Alice's Kubernetes doc even without exact token overlap
    const searchRes = await engine.hybridSearch(alice, { query: 'k8s orchestration', limit: 3 });
    expect(searchRes.hits.length).toBeGreaterThanOrEqual(1);
    expect(searchRes.hits[0].chunk.documentId).toBe('doc_k8s_guide');
    expect(searchRes.hits.every((h) => h.chunk.userId === 'alice_rag')).toBe(true);
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 5);

    // Delete removes document and all its chunks
    const deleted = await engine.deleteDocument(alice, 'doc_k8s_guide');
    expect(deleted.deleted).toBe(true);
    expect(deleted.chunksRemoved).toBeGreaterThanOrEqual(1);
    const remainingDocs = await engine.listDocuments(alice);
    expect(remainingDocs.map((d) => d.documentId)).toEqual(['doc_db_guide']);
  });

  it('enforces Bearer auth on /api/rag/* and supports index/search/delete over Netlify Function handler', async () => {
    const store = new InMemoryCollectionStore();
    const syncHub = new LiveSyncHub(store);
    const engine = new SemanticRagEngine({
      store,
      syncHub,
      embeddingProvider: createDeterministicEmbeddingProvider(),
    });

    // Unauthenticated request rejected
    const unauthRes = await handleRagRequest(new Request('http://localhost:3000/api/rag/documents'), engine);
    expect(unauthRes.status).toBe(401);

    const { headers } = makeAuthHeaders();

    const idxRes = await handleRagRequest(
      new Request('http://localhost:3000/api/rag/index', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: 'Billing SOP.md',
          content: '# Billing\nHandle Stripe invoice and subscription payment retries automatically.',
          sourceType: 'document',
        }),
      }),
      engine,
    );
    expect(idxRes.status).toBe(201);
    const idxBody = (await idxRes.json()) as any;
    expect(idxBody.ok).toBe(true);
    const docId = idxBody.document.documentId;

    const searchRes = await handleRagRequest(
      new Request('http://localhost:3000/api/rag/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: 'revenue billing payment', limit: 3 }),
      }),
      engine,
    );
    expect(searchRes.status).toBe(200);
    const searchBody = (await searchRes.json()) as any;
    expect(searchBody.ok).toBe(true);
    expect(searchBody.hits.length).toBeGreaterThanOrEqual(1);
    expect(searchBody.hits[0].citation.documentId).toBe(docId);

    const delRes = await handleRagRequest(
      new Request('http://localhost:3000/api/rag/delete', {
        method: 'POST',
        headers,
        body: JSON.stringify({ documentId: docId }),
      }),
      engine,
    );
    expect(delRes.status).toBe(200);
  });
});

describe('Feature 2 — Webhook & Event-Driven Agent Triggers', () => {
  it('verifies GitHub, Stripe (with replay check), Slack, and generic HMAC signatures safely', () => {
    const secret = 'whsec_super_secret_key_for_testing_12345';
    const rawBody = JSON.stringify({ action: 'opened', pull_request: { title: 'Fix bug' } });

    // GitHub
    const ghSig = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    expect(
      verifyInboundSignature({
        provider: 'github',
        secret,
        rawBody,
        headers: new Headers({ 'x-hub-signature-256': ghSig }),
      }).valid,
    ).toBe(true);
    expect(
      verifyInboundSignature({
        provider: 'github',
        secret,
        rawBody,
        headers: new Headers({ 'x-hub-signature-256': 'sha256=deadbeef' }),
      }).valid,
    ).toBe(false);

    // Stripe valid + expired replay
    const nowSec = Math.floor(Date.now() / 1000);
    const stripeSig = crypto.createHmac('sha256', secret).update(`${nowSec}.${rawBody}`).digest('hex');
    expect(
      verifyInboundSignature({
        provider: 'stripe',
        secret,
        rawBody,
        headers: new Headers({ 'stripe-signature': `t=${nowSec},v1=${stripeSig}` }),
      }).valid,
    ).toBe(true);

    const staleSec = nowSec - 600;
    const staleSig = crypto.createHmac('sha256', secret).update(`${staleSec}.${rawBody}`).digest('hex');
    expect(
      verifyInboundSignature({
        provider: 'stripe',
        secret,
        rawBody,
        headers: new Headers({ 'stripe-signature': `t=${staleSec},v1=${staleSig}` }),
      }).valid,
    ).toBe(false);

    // Slack
    const slackBase = `v0:${nowSec}:${rawBody}`;
    const slackSig = `v0=${crypto.createHmac('sha256', secret).update(slackBase).digest('hex')}`;
    expect(
      verifyInboundSignature({
        provider: 'slack',
        secret,
        rawBody,
        headers: new Headers({
          'x-slack-request-timestamp': String(nowSec),
          'x-slack-signature': slackSig,
        }),
      }).valid,
    ).toBe(true);

    // Generic
    const genSig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    expect(
      verifyInboundSignature({
        provider: 'generic',
        secret,
        rawBody,
        headers: new Headers({ 'x-webhook-signature': genSig }),
      }).valid,
    ).toBe(true);
  });

  it('safely renders webhook templates without prototype traversal', () => {
    const rendered = renderWebhookTemplate(
      'Review PR {{payload.pull_request.title}} on {{event}} [{{payload.__proto__.polluted}}]',
      {
        event: 'pull_request',
        payload: { pull_request: { title: 'Add Vector Search' } },
      },
    );
    expect(rendered).toBe('Review PR Add Vector Search on pull_request []');
  });

  it('ingests signed inbound webhooks into durable BackgroundTaskEngine with dedup & filtering', async () => {
    const store = new InMemoryCollectionStore();
    const auditStore = new InMemoryDurableStore();
    const permissions = new PermissionsGatewayService({
      signingSecret: TEST_POLICY_SECRET,
      collectionStore: store,
    });
    const syncHub = new LiveSyncHub(store);
    const taskEngine = new BackgroundTaskEngine({ store, syncHub });
    const webhookEngine = new WebhookEngine({ store, auditStore, permissions, taskEngine, syncHub, skipDnsLookup: true });

    const ctx: DurableRequestContext = { userId: 'wh_user_1' };
    const created = await webhookEngine.createInboundWebhook(ctx, {
      name: 'GitHub PR Reviewer',
      provider: 'github',
      allowedEvents: ['pull_request'],
      titleTemplate: 'PR: {{payload.pull_request.title}}',
      promptTemplate: 'Review repository {{payload.repository.full_name}} PR #{{payload.number}}',
      taskType: 'coding',
      priority: 'high',
    });
    expect(created.signingSecret.length).toBeGreaterThanOrEqual(32);

    const payloadObj = {
      number: 42,
      repository: { full_name: 'acme/deku' },
      pull_request: { title: 'Upgrade RAG Engine' },
    };
    const rawBody = JSON.stringify(payloadObj);
    const ghSig = `sha256=${crypto.createHmac('sha256', created.signingSecret).update(rawBody).digest('hex')}`;

    // 1. Valid ingestion enqueues background task
    const ingest1 = await webhookEngine.handleInboundEvent({
      webhookId: created.webhook.webhookId,
      rawBody,
      headers: new Headers({
        'x-github-event': 'pull_request',
        'x-github-delivery': 'gh_deliv_001',
        'x-hub-signature-256': ghSig,
      }),
    });
    expect(ingest1.status).toBe('enqueued');
    expect(ingest1.taskId).toBeTruthy();

    const queuedTask = await taskEngine.getTask(ctx, ingest1.taskId!);
    expect(queuedTask?.title).toBe('PR: Upgrade RAG Engine');
    expect(queuedTask?.prompt).toContain('acme/deku');

    // 2. Duplicate delivery ID is deduplicated
    const ingestDup = await webhookEngine.handleInboundEvent({
      webhookId: created.webhook.webhookId,
      rawBody,
      headers: new Headers({
        'x-github-event': 'pull_request',
        'x-github-delivery': 'gh_deliv_001',
        'x-hub-signature-256': ghSig,
      }),
    });
    expect(ingestDup.status).toBe('deduplicated');
    expect(ingestDup.taskId).toBe(ingest1.taskId);

    // 3. Disallowed event is ignored cleanly
    const ingestIgnored = await webhookEngine.handleInboundEvent({
      webhookId: created.webhook.webhookId,
      rawBody,
      headers: new Headers({
        'x-github-event': 'star',
        'x-github-delivery': 'gh_deliv_002',
        'x-hub-signature-256': ghSig,
      }),
    });
    expect(ingestIgnored.status).toBe('ignored');

    // 4. Invalid signature rejected with 401
    await expect(
      webhookEngine.handleInboundEvent({
        webhookId: created.webhook.webhookId,
        rawBody,
        headers: new Headers({
          'x-github-event': 'pull_request',
          'x-hub-signature-256': 'sha256=invalid',
        }),
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('blocks SSRF targets on outbound webhooks and delivers signed Slack/generic payloads with retry', async () => {
    const store = new InMemoryCollectionStore();
    const auditStore = new InMemoryDurableStore();
    const permissions = new PermissionsGatewayService({
      signingSecret: TEST_POLICY_SECRET,
      collectionStore: store,
    });
    const syncHub = new LiveSyncHub(store);
    const taskEngine = new BackgroundTaskEngine({ store, syncHub });

    const deliveredRequests: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    let attempt = 0;
    const mockFetch: typeof fetch = async (input, init) => {
      attempt += 1;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const headers = (init?.headers || {}) as Record<string, string>;
      const body = String(init?.body || '');
      deliveredRequests.push({ url, headers, body });
      if (attempt === 1) {
        return new Response('temporary upstream 503', { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const webhookEngine = new WebhookEngine({
      store,
      auditStore,
      permissions,
      taskEngine,
      syncHub,
      fetchImpl: mockFetch,
      skipDnsLookup: true,
    });

    const ctx: DurableRequestContext = { userId: 'wh_out_user' };

    // SSRF targets must be rejected
    await expect(
      webhookEngine.createOutboundWebhook(ctx, {
        name: 'Metadata Attack',
        url: 'http://169.254.169.254/latest/meta-data/',
        events: ['task.completed'],
      }),
    ).rejects.toThrow();

    await expect(
      webhookEngine.createOutboundWebhook(ctx, {
        name: 'Localhost Attack',
        url: 'http://127.0.0.1:8080/internal',
        events: ['task.completed'],
      }),
    ).rejects.toThrow();

    // Register legitimate Slack outbound webhook
    const sub = await webhookEngine.createOutboundWebhook(ctx, {
      name: 'Team Slack Alerts',
      url: 'https://hooks.example.com/services/T000/B000/XXX',
      format: 'slack',
      events: ['task.completed'],
    });

    const deliveries = await webhookEngine.dispatchOutboundEvent(ctx, 'task.completed', {
      title: 'Build Finished',
      summary: 'All 42 unit tests passed.',
      taskId: 'task_99',
    });

    expect(deliveries.length).toBe(1);
    expect(deliveries[0].status).toBe('succeeded');
    expect(deliveries[0].attempts).toBe(2);
    expect(deliveredRequests.length).toBe(2); // 1 transient 503 + 1 retry 200
    const finalReq = deliveredRequests[1];
    const parsedSlack = JSON.parse(finalReq.body);
    expect(parsedSlack.text).toContain('Build Finished');

    // Verify X-Deku-Signature HMAC matches signingSecret
    const expectedSig = `sha256=${crypto.createHmac('sha256', sub.signingSecret).update(finalReq.body).digest('hex')}`;
    expect(finalReq.headers['X-Deku-Signature']).toBe(expectedSig);

    // Check Netlify handler rejects unauthenticated management calls
    const unauth = await handleWebhooksRequest(new Request('http://localhost:3000/api/webhooks/inbound'), webhookEngine);
    expect(unauth.status).toBe(401);
  });
});

describe('Feature 3 — MCP (Model Context Protocol) Connector Bridge', () => {
  it('communicates over JSON-RPC 2.0 Streamable HTTP & SSE and rejects SSRF endpoints', async () => {
    // SSRF endpoint rejected immediately
    const ssrfClient = new McpHttpClient({
      endpointUrl: 'http://127.0.0.1:9000/mcp',
      skipDnsLookup: true,
    });
    await expect(ssrfClient.initialize()).rejects.toThrow();

    // Real Streamable HTTP + SSE MCP mock server
    const receivedMethods: string[] = [];
    const mockFetch: typeof fetch = async (_url, init) => {
      const rpc = JSON.parse(String(init?.body || '{}'));
      receivedMethods.push(rpc.method);
      if (rpc.method === 'initialize') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              protocolVersion: '2025-03-26',
              serverInfo: { name: 'github-mcp', version: '1.2.0' },
              capabilities: { tools: {}, resources: {} },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess_mcp_1' } },
        );
      }
      if (rpc.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }
      if (rpc.method === 'tools/list') {
        // Test SSE response parsing
        const sse = `event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            tools: [
              {
                name: 'list_issues',
                description: 'List GitHub repository issues',
                inputSchema: { type: 'object', properties: { repo: { type: 'string' } }, required: ['repo'] },
              },
              {
                name: 'delete_branch',
                description: 'Delete a branch from the repository',
                inputSchema: { type: 'object', properties: { branch: { type: 'string' } }, required: ['branch'] },
              },
            ],
          },
        })}\n\n`;
        return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (rpc.method === 'tools/call') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              content: [{ type: 'text', text: `Executed ${rpc.params.name} for ${JSON.stringify(rpc.params.arguments)}` }],
              isError: false,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (rpc.method === 'resources/list') {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { resources: [{ uri: 'repo://readme', name: 'README' }] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (rpc.method === 'prompts/list') {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { prompts: [] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: {} }), { status: 200 });
    };

    const store = new InMemoryCollectionStore();
    const auditStore = new InMemoryDurableStore();
    const permissions = new PermissionsGatewayService({
      signingSecret: TEST_POLICY_SECRET,
      collectionStore: store,
    });
    const syncHub = new LiveSyncHub(store);
    const bridge = new McpBridgeService({
      store,
      auditStore,
      permissions,
      syncHub,
      fetchImpl: mockFetch,
      skipDnsLookup: true,
    });

    const { headers, ctx } = makeAuthHeaders();
    const regResult = await bridge.registerServer(ctx, {
      name: 'GitHub MCP',
      endpointUrl: 'https://mcp.example.com/github',
      authType: 'bearer',
      authToken: 'ghp_secret_test_token',
      autoDiscover: true,
    });

    // Public response hides raw secrets
    expect(regResult.discovered).toBe(true);
    expect((regResult.server as any).devAuthPayload).toBeUndefined();
    expect((regResult.server as any).encryptedAuthPayload).toBeUndefined();
    expect(regResult.server.hasAuthCredentials).toBe(true);
    expect(regResult.server.tools.length).toBe(2);
    expect(receivedMethods).toContain('initialize');
    expect(receivedMethods).toContain('tools/list');

    // Read-only tool executes immediately without approval challenge
    const readRes = await bridge.callServerTool(ctx, {
      serverId: regResult.server.serverId,
      toolName: 'list_issues',
      args: { repo: 'acme/deku' },
    });
    expect(readRes.ok).toBe(true);
    expect(readRes.textSummary).toContain('list_issues');

    // Destructive tool requires PermissionsGateway approval challenge
    const destructiveBlocked = await bridge.callServerTool(ctx, {
      serverId: regResult.server.serverId,
      toolName: 'delete_branch',
      args: { branch: 'old-feature' },
    });
    expect(destructiveBlocked.ok).toBe(false);
    expect(destructiveBlocked.requiresApproval).toBe(true);
    const challengeId = (destructiveBlocked.challenge as any)?.challengeId;
    expect(challengeId).toBeTruthy();

    // Approve single-use challenge and retry execution
    const approved = await permissions.resolveChallengeDurable(
      { challengeId, confirmed: true, userId: ctx.userId },
      ctx,
      auditStore,
    );
    expect(approved.approvalToken).toBeTruthy();

    const destructiveAllowed = await bridge.callServerTool(ctx, {
      serverId: regResult.server.serverId,
      toolName: 'delete_branch',
      args: { branch: 'old-feature' },
      approvalToken: approved.approvalToken,
    });
    expect(destructiveAllowed.ok).toBe(true);
    expect(destructiveAllowed.textSummary).toContain('delete_branch');

    // Check Netlify handler rejects unauthenticated calls & exposes /api/mcp/tools when authorized
    const unauthMcp = await handleMcpRequest(new Request('http://localhost:3000/api/mcp/servers'), bridge);
    expect(unauthMcp.status).toBe(401);

    const toolsRes = await handleMcpRequest(new Request('http://localhost:3000/api/mcp/tools', { headers }), bridge);
    expect(toolsRes.status).toBe(200);
    const toolsBody = (await toolsRes.json()) as any;
    expect(toolsBody.tools.some((t: any) => t.qualifiedName === 'mcp__github_mcp__list_issues' || t.qualifiedName === 'mcp__github-mcp__list_issues')).toBe(true);

    // Verify toolRegistry built-in tools include RAG, MCP, and Webhook tools
    expect(toolRegistry.getTool('rag_semantic_search')).toBeDefined();
    expect(toolRegistry.getTool('mcp_call_tool')).toBeDefined();
    expect(toolRegistry.getTool('webhook_create_outbound')).toBeDefined();
  });
});

describe('Feature 4 — Smart Context Compaction & Adaptive Model Routing', () => {
  it('skips short threads and compacts long threads while preserving system prompts, multimodal images, and recent turns', async () => {
    const shortMessages: CompactableMessage[] = [
      { role: 'user', content: 'Hello, what is 2+2?' },
      { role: 'assistant', content: '4' },
    ];
    const shortResult = await compactConversationMessages(shortMessages, '', { maxTokenBudget: 4000 });
    expect(shortResult.compacted).toBe(false);
    expect(shortResult.messages.length).toBe(2);

    const longMessages: CompactableMessage[] = [
      { role: 'system', content: 'You are an expert software architect.' },
    ];
    for (let i = 1; i <= 16; i += 1) {
      longMessages.push({
        role: 'user',
        content: `Step ${i}: Please design server/module_${i}.ts with detailed validation, error handling, and unit tests. ${
          i === 2 ? '[IMAGE_DATA_URL:data:image/png;base64,iVBORw0KGgo=] ' : ''
        }${'details '.repeat(50)}`,
      });
      longMessages.push({
        role: 'assistant',
        content: `Completed server/module_${i}.ts with TypeScript strict types and verified all test assertions. ${'output '.repeat(50)}`,
      });
    }

    // 1. Custom LLM summarizer path
    let summarizerCalled = false;
    const compactedLlm = await compactConversationMessages(longMessages, '', {
      maxTokenBudget: 1500,
      preserveRecentTurns: 4,
      summarizer: async () => {
        summarizerCalled = true;
        return '- User designed modules 1 through 14 with validation and TypeScript tests.\n- Diagram image was attached in Step 2.';
      },
    });

    expect(summarizerCalled).toBe(true);
    expect(compactedLlm.compacted).toBe(true);
    expect(compactedLlm.strategy).toBe('gemini-summary');
    expect(compactedLlm.summarizedMessageCount).toBeGreaterThan(0);
    expect(compactedLlm.compactedTokens).toBeLessThan(compactedLlm.originalTokens);
    // System message preserved first
    expect(compactedLlm.messages[0].role).toBe('system');
    // Compaction summary injected cleanly
    expect(
      compactedLlm.messages.some((m) => m.content.includes('COMPACTED EARLIER CONVERSATION CONTEXT')),
    ).toBe(true);
    // Recent messages preserved verbatim
    expect(compactedLlm.messages[compactedLlm.messages.length - 1].content).toContain('Completed server/module_16.ts');

    // 2. Extractive fallback when LLM summarizer throws
    const compactedFallback = await compactConversationMessages(longMessages, '', {
      maxTokenBudget: 1500,
      preserveRecentTurns: 4,
      summarizer: async () => {
        throw new Error('Upstream rate limited');
      },
    });
    expect(compactedFallback.compacted).toBe(true);
    expect(compactedFallback.strategy).toBe('extractive-fallback');
    expect(buildExtractiveCompactionSummary(longMessages.slice(1, 5))).toContain('[image attachment]');
    expect(estimateTextTokens('hello world')).toBeGreaterThan(0);
  });

  it('routes adaptively by complexity and fails over automatically when a model circuit breaker trips OPEN', () => {
    modelRouter.resetCircuit();

    const simple = modelRouter.analyzeComplexity('What is the capital of France?');
    expect(simple.level).toBe('low');

    const complex = modelRouter.analyzeComplexity(
      'Design a distributed multi-agent architecture with Postgres migrations, cryptographic HMAC verification, Kubernetes failover, and step by step security threat modeling.\n```ts\nexport async function orchestrate() {}\n```',
      { mode: 'work', thinkHarder: true, estimatedInputTokens: 24000 },
    );
    expect(complex.level).toBe('high');
    expect(complex.score).toBeGreaterThan(simple.score);

    const routeBefore = modelRouter.route('Write a quick summary of this paragraph', undefined, { mode: 'chat' });
    expect(routeBefore.circuitState).toBe('CLOSED');
    const primaryModel = routeBefore.selectedModel;

    // Trip primary model circuit breaker with 3 consecutive failures
    modelRouter.recordOutcome(primaryModel, { ok: false, statusCode: 429, error: 'rate limit' });
    modelRouter.recordOutcome(primaryModel, { ok: false, statusCode: 503, error: 'service unavailable' });
    modelRouter.recordOutcome(primaryModel, { ok: false, statusCode: 503, error: 'service unavailable' });

    const health = modelRouter.getModelHealth(primaryModel);
    expect(health.state).toBe('OPEN');

    // Next routing decision should fail over to a healthy alternative model
    const routeFailover = modelRouter.route('Write a quick summary of this paragraph', undefined, { mode: 'chat' });
    expect(routeFailover.selectedModel).not.toBe(primaryModel);
    expect(routeFailover.circuitState).toBe('CLOSED');

    // Reset circuit for clean state
    modelRouter.resetCircuit();
    expect(modelRouter.getModelHealth(primaryModel).state).toBe('CLOSED');
  });
});

describe('Feature 5 — Live Background Task Notifications & Cross-Device Sync', () => {
  it('broadcasts live events with monotonic sequences, catch-up replay, and SSE/snapshot/ack HTTP endpoints', async () => {
    const store = new InMemoryCollectionStore();
    const auditStore = new InMemoryDurableStore();
    const syncHub = new LiveSyncHub(store);
    const permissions = new PermissionsGatewayService({
      signingSecret: TEST_POLICY_SECRET,
      collectionStore: store,
      syncHub,
    });
    const taskEngine = new BackgroundTaskEngine({ store, syncHub });

    const { headers, ctx } = makeAuthHeaders();
    const receivedLive: LiveSyncEvent[] = [];
    const unsubscribe = syncHub.subscribe(ctx.userId, (evt) => receivedLive.push(evt));

    // Enqueueing a background task emits a live sync event
    const enqueued = await taskEngine.enqueueTask(ctx, {
      title: 'Nightly Security Audit',
      prompt: 'Audit dependencies and report findings',
      type: 'research',
      priority: 'high',
    });

    // Evaluating a destructive action creates a durable approval challenge and emits approval:required
    const evalRes = await permissions.evaluateActionDurable(
      {
        toolName: 'delete_file',
        args: { path: '/workspace/important.db' },
        userId: ctx.userId,
        target: '/workspace/important.db',
        forceConfirmation: true,
      },
      ctx,
      auditStore,
    );
    expect(evalRes.requiresApproval).toBe(true);
    const challengeId = evalRes.challenge?.challengeId;
    expect(challengeId).toBeTruthy();

    unsubscribe();

    expect(receivedLive.length).toBeGreaterThanOrEqual(2);
    expect(receivedLive.some((e) => e.type === 'task:queued' && e.taskId === enqueued.task.taskId)).toBe(true);
    expect(receivedLive.some((e) => e.type === 'approval:required' && e.challengeId === challengeId)).toBe(true);
    expect(receivedLive[1].seq).toBeGreaterThan(receivedLive[0].seq);

    // Unauthenticated sync requests rejected
    const unauthSync = await handleSyncRequest(new Request('http://localhost:3000/api/sync/snapshot'), {
      syncHub,
      taskEngine,
      permissions,
    });
    expect(unauthSync.status).toBe(401);

    // Catch-up via /api/sync/events?sinceSeq=...
    const firstSeq = receivedLive[0].seq;
    const eventsRes = await handleSyncRequest(
      new Request(`http://localhost:3000/api/sync/events?sinceSeq=${firstSeq}`, { headers }),
      { syncHub, taskEngine, permissions },
    );
    expect(eventsRes.status).toBe(200);
    const eventsBody = (await eventsRes.json()) as any;
    expect(eventsBody.ok).toBe(true);
    expect(eventsBody.events.every((e: LiveSyncEvent) => e.seq > firstSeq)).toBe(true);

    // Snapshot returns active tasks, pending approvals, notifications, and latestSeq
    const snapRes = await handleSyncRequest(
      new Request('http://localhost:3000/api/sync/snapshot', { headers }),
      { syncHub, taskEngine, permissions, auditStore },
    );
    expect(snapRes.status).toBe(200);
    const snapBody = (await snapRes.json()) as any;
    expect(snapBody.ok).toBe(true);
    expect(snapBody.activeTasks.length).toBeGreaterThanOrEqual(1);
    expect(snapBody.pendingApprovals.length).toBeGreaterThanOrEqual(1);
    expect(snapBody.latestSeq).toBeGreaterThanOrEqual(firstSeq);

    // Create notification and acknowledge it via /api/sync/ack
    const notif = await taskEngine.createNotification(ctx, {
      kind: 'task_completed',
      title: 'Audit Completed',
      body: 'All checks succeeded.',
      taskId: enqueued.task.taskId,
    });
    const ackRes = await handleSyncRequest(
      new Request('http://localhost:3000/api/sync/ack', {
        method: 'POST',
        headers,
        body: JSON.stringify({ notificationId: notif.notificationId }),
      }),
      { syncHub, taskEngine, permissions, auditStore },
    );
    expect(ackRes.status).toBe(200);
    const ackBody = (await ackRes.json()) as any;
    expect(ackBody.ok).toBe(true);
    expect(ackBody.acknowledged).toContain(notif.notificationId);

    // SSE stream returns text/event-stream with sync:connected + replay events
    const sseRes = await handleSyncRequest(
      new Request('http://localhost:3000/api/sync/stream?sinceSeq=0&durationMs=200', { headers }),
      { syncHub, taskEngine, permissions, auditStore, streamDurationMs: 200 },
    );
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get('Content-Type')).toContain('text/event-stream');
    const sseText = await sseRes.text();
    expect(sseText).toContain('event: sync:connected');
    expect(sseText).toContain('event: task:queued');

    // Cross-tab deduplication in LiveSyncClient prevents duplicate delivery of same eventId
    const client = new LiveSyncClient();
    expect(client.claimEventDelivery('evt_dedup_1')).toBe(true);
    expect(client.claimEventDelivery('evt_dedup_1')).toBe(false);
    expect(client.claimEventDelivery('evt_dedup_2')).toBe(true);
  });
});
