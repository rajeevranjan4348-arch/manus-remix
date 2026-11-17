import type { IncomingMessage, ServerResponse } from 'http';
import { verifyBearerToken } from '../src/middleware/auth.ts';
import { getOrCreateUser } from '../src/db/users.ts';
import {
  deleteConversationInSql,
  deleteProjectInSql,
  getUserProfileWithCountsFromSql,
  listConversationMessagesFromSql,
  listUserConversationsFromSql,
  listUserProjectsFromSql,
  upsertConversationInSql,
  upsertMessageInSql,
  upsertProjectInSql,
} from '../src/db/queries.ts';

function readJsonBody(req: IncomingMessage): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    let bodyStr = '';
    req.on('data', (chunk) => {
      bodyStr += chunk;
    });
    req.on('end', () => {
      try {
        resolve(bodyStr ? JSON.parse(bodyStr) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export async function handleCloudSqlApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string
): Promise<boolean> {
  if (!urlPath.startsWith('/api/sql/')) {
    return false;
  }

  const decodedUser = await verifyBearerToken(req.headers.authorization);
  if (!decodedUser || !decodedUser.uid) {
    sendJson(res, 401, { error: 'Unauthorized: Missing or invalid token' });
    return true;
  }

  const uid = decodedUser.uid;
  const email = decodedUser.email || `${uid}@manus.user`;
  const displayName = decodedUser.name || null;

  try {
    // POST /api/sql/users/sync — Link & upsert Firebase Auth user into PostgreSQL
    if (urlPath === '/api/sql/users/sync' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const userRecord = await getOrCreateUser(
        uid,
        typeof body.email === 'string' && body.email ? body.email : email,
        typeof body.displayName === 'string' ? body.displayName : displayName
      );
      sendJson(res, 200, { ok: true, user: userRecord });
      return true;
    }

    // GET /api/sql/users/me — Get relational user profile & counts
    if (urlPath === '/api/sql/users/me' && req.method === 'GET') {
      await getOrCreateUser(uid, email, displayName);
      const profile = await getUserProfileWithCountsFromSql(uid);
      sendJson(res, 200, { ok: true, ...profile });
      return true;
    }

    // GET /api/sql/conversations — List user's conversations from Cloud SQL
    if (urlPath === '/api/sql/conversations' && req.method === 'GET') {
      const queryParams = new URLSearchParams(req.url?.split('?')[1] || '');
      const limit = Number(queryParams.get('limit') || '50') || 50;
      const rows = await listUserConversationsFromSql(uid, limit);
      sendJson(res, 200, { ok: true, conversations: rows });
      return true;
    }

    // POST /api/sql/conversations — Upsert a conversation in Cloud SQL
    if (urlPath === '/api/sql/conversations' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.id || typeof body.id !== 'string') {
        sendJson(res, 400, { error: 'Conversation id is required' });
        return true;
      }
      const saved = await upsertConversationInSql({
        uid,
        email,
        displayName,
        id: body.id,
        title: typeof body.title === 'string' ? body.title : 'New Conversation',
        mode: typeof body.mode === 'string' ? body.mode : 'chat',
        status: typeof body.status === 'string' ? body.status : 'idle',
        projectId: typeof body.projectId === 'string' ? body.projectId : null,
        summary: typeof body.summary === 'string' ? body.summary : undefined,
      });
      sendJson(res, 200, { ok: true, conversation: saved });
      return true;
    }

    // DELETE /api/sql/conversations — Delete a conversation and its messages
    if (urlPath === '/api/sql/conversations' && req.method === 'DELETE') {
      const queryParams = new URLSearchParams(req.url?.split('?')[1] || '');
      const body = await readJsonBody(req);
      const conversationId = String(body.id || queryParams.get('id') || '').trim();
      if (!conversationId) {
        sendJson(res, 400, { error: 'Conversation id is required' });
        return true;
      }
      const deleted = await deleteConversationInSql(uid, conversationId);
      sendJson(res, 200, { ok: true, deleted });
      return true;
    }

    // GET /api/sql/messages — List messages for a conversation owned by user
    if (urlPath === '/api/sql/messages' && req.method === 'GET') {
      const queryParams = new URLSearchParams(req.url?.split('?')[1] || '');
      const conversationId = String(queryParams.get('conversationId') || '').trim();
      if (!conversationId) {
        sendJson(res, 400, { error: 'conversationId query parameter is required' });
        return true;
      }
      const rows = await listConversationMessagesFromSql(uid, conversationId);
      sendJson(res, 200, { ok: true, messages: rows });
      return true;
    }

    // POST /api/sql/messages — Upsert a message in Cloud SQL
    if (urlPath === '/api/sql/messages' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.id || !body.conversationId || !body.role || typeof body.content !== 'string') {
        sendJson(res, 400, { error: 'id, conversationId, role, and content are required' });
        return true;
      }
      const saved = await upsertMessageInSql({
        uid,
        email,
        id: String(body.id),
        conversationId: String(body.conversationId),
        role: String(body.role),
        content: body.content,
        thought: typeof body.thought === 'string' ? body.thought : null,
        status: typeof body.status === 'string' ? body.status : 'success',
      });
      sendJson(res, 200, { ok: true, message: saved });
      return true;
    }

    // GET /api/sql/projects — List user's projects from Cloud SQL
    if (urlPath === '/api/sql/projects' && req.method === 'GET') {
      const rows = await listUserProjectsFromSql(uid);
      sendJson(res, 200, { ok: true, projects: rows });
      return true;
    }

    // POST /api/sql/projects — Upsert a project in Cloud SQL
    if (urlPath === '/api/sql/projects' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.id || !body.name) {
        sendJson(res, 400, { error: 'Project id and name are required' });
        return true;
      }
      const saved = await upsertProjectInSql({
        uid,
        email,
        id: String(body.id),
        name: String(body.name),
        description: typeof body.description === 'string' ? body.description : null,
        icon: typeof body.icon === 'string' ? body.icon : null,
        color: typeof body.color === 'string' ? body.color : null,
      });
      sendJson(res, 200, { ok: true, project: saved });
      return true;
    }

    // DELETE /api/sql/projects — Delete a project in Cloud SQL
    if (urlPath === '/api/sql/projects' && req.method === 'DELETE') {
      const queryParams = new URLSearchParams(req.url?.split('?')[1] || '');
      const body = await readJsonBody(req);
      const projectId = String(body.id || queryParams.get('id') || '').trim();
      if (!projectId) {
        sendJson(res, 400, { error: 'Project id is required' });
        return true;
      }
      const deleted = await deleteProjectInSql(uid, projectId);
      sendJson(res, 200, { ok: true, deleted });
      return true;
    }

    sendJson(res, 404, { error: 'SQL endpoint not found' });
    return true;
  } catch (error: any) {
    console.error('[Cloud SQL API] Request failed:', error);
    sendJson(res, 500, { error: error?.message || 'Database query failed. Please try again later.' });
    return true;
  }
}
