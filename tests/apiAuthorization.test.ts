import { describe, expect, it } from 'vitest';
import agent from '../netlify/functions/agent';
import checkpoints from '../netlify/functions/checkpoints';
import permissions from '../netlify/functions/permissions';
import realtime from '../netlify/functions/realtime';
import webSearch from '../netlify/functions/web-search';
import imageGeneration from '../netlify/functions/image-generation';
import { encryptToken } from '../server/connectorsService';
import { permissionsGateway } from '../server/permissionsGateway';

const post = (url: string) => new Request(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
});

describe('API authentication boundaries', () => {
  it('does not encrypt connector credentials with a built-in fallback key', () => {
    const previous = process.env.TOKEN_ENCRYPTION_SECRET;
    delete process.env.TOKEN_ENCRYPTION_SECRET;
    try {
      expect(() => encryptToken('example-provider-token')).toThrow('TOKEN_ENCRYPTION_SECRET must be configured');
    } finally {
      if (previous === undefined) delete process.env.TOKEN_ENCRYPTION_SECRET;
      else process.env.TOKEN_ENCRYPTION_SECRET = previous;
    }
  });

  it('rejects unauthenticated checkpoint writes', async () => {
    const response = await checkpoints(post('https://app.test/api/checkpoints/save'));
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('UNAUTHENTICATED');
  });

  it('rejects unauthenticated permission audit reads', async () => {
    const response = await permissions(new Request('https://app.test/api/permissions/audit'));
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('UNAUTHENTICATED');
  });

  it('rejects unauthenticated web-search and agent requests', async () => {
    const [searchResponse, agentResponse] = await Promise.all([
      webSearch(post('https://app.test/api/web-search')),
      agent(post('https://app.test/api/gemini/stream')),
    ]);
    expect(searchResponse.status).toBe(401);
    expect(agentResponse.status).toBe(401);
  });

  it('rejects unauthenticated image-generation requests before provider work', async () => {
    const response = await imageGeneration(post('https://app.test/api/image-generation'));
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('UNAUTHENTICATED');
  });

  it('rejects unauthenticated realtime lookups before calling upstream services', async () => {
    const response = await realtime(new Request('https://app.test/api/realtime?q=latest%20news'));
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('UNAUTHENTICATED');
  });
});

describe('Permission challenge ownership', () => {
  it('prevents another user from approving or consuming an approval challenge', () => {
    const evaluation = permissionsGateway.evaluateAction({
      toolName: 'delete_file',
      args: { path: 'private.txt' },
      userId: `owner_${Date.now()}`,
    });
    const challenge = evaluation.challenge!;
    const strangerId = `${challenge.userId}_stranger`;

    const deniedApproval = permissionsGateway.resolveChallenge({
      challengeId: challenge.challengeId,
      confirmed: true,
      userId: strangerId,
    });
    expect(deniedApproval.success).toBe(false);
    expect(challenge.status).toBe('pending');

    const ownerApproval = permissionsGateway.resolveChallenge({
      challengeId: challenge.challengeId,
      confirmed: true,
      userId: challenge.userId,
    });
    expect(ownerApproval.success).toBe(true);

    const deniedExecution = permissionsGateway.verifyApprovalToken({
      approvalToken: ownerApproval.approvalToken!,
      toolName: 'delete_file',
      args: { path: 'private.txt' },
      userId: strangerId,
    });
    expect(deniedExecution.valid).toBe(false);

    const ownerExecution = permissionsGateway.verifyApprovalToken({
      approvalToken: ownerApproval.approvalToken!,
      toolName: 'delete_file',
      args: { path: 'private.txt' },
      userId: challenge.userId,
    });
    expect(ownerExecution.valid).toBe(true);
  });

  it('does not create permission challenges without an authenticated user ID', () => {
    const result = permissionsGateway.evaluateAction({ toolName: 'delete_file', args: { path: 'private.txt' } });
    expect(result.allowed).toBe(false);
    expect(result.challenge).toBeUndefined();
  });
});
