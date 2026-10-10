import { createDecipheriv, createHash } from 'node:crypto';

const SESSION_COOKIE = 'manus_github_session';
const MAX_BODY = 32_000;
const MCP_URL = 'https://api.githubcopilot.com/mcp/';

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function secretKey() {
  const value = process.env.GITHUB_OAUTH_SECRET;
  if (!value || value.length < 32) throw new Error('GitHub connector is not configured');
  return createHash('sha256').update(value).digest();
}

function readCookie(req: Request, name: string) {
  return (req.headers.get('cookie') || '')
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(name + '='))
    ?.slice(name.length + 1) || '';
}

function readSession(req: Request): { accessToken: string; expiresAt: number } | null {
  try {
    const raw = Buffer.from(readCookie(req, SESSION_COOKIE), 'base64url');
    if (raw.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', secretKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const session = JSON.parse(
      Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'),
    ) as { accessToken?: string; expiresAt?: number };
    if (!session.accessToken || !session.expiresAt || session.expiresAt < Date.now()) return null;
    return { accessToken: session.accessToken, expiresAt: session.expiresAt };
  } catch {
    return null;
  }
}

// Read-only tools may execute without an extra confirmation. Unknown tools default to
// write-protected, so newly added remote tools do not silently gain write access.
function isReadOnlyTool(name: string) {
  return /^(get_|list_|search_|fetch_|find_|read_|view_|lookup_|pull_request_read$|issue_read$|repository_read$|actions_list_|actions_get_)/i.test(name);
}

function addConfirmationSchema(tool: any) {
  if (isReadOnlyTool(String(tool?.name || ''))) return tool;
  const schema = tool?.inputSchema;
  if (!schema || typeof schema !== 'object') return tool;
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  return {
    ...tool,
    description: [tool.description || '', 'Safety requirement: this operation changes GitHub state. Obtain explicit user approval, then pass confirm=true.'].filter(Boolean).join('\n\n'),
    inputSchema: {
      ...schema,
      properties: { ...properties, confirm: { type: 'boolean', description: 'Must be true only after the user explicitly approves this exact operation.' } },
      required: [...new Set([...required, 'confirm'])],
    },
  };
}

function rpcError(id: unknown, code: number, message: string) {
  return json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });

  const session = readSession(req);
  if (!session) return json({ error: 'GitHub is not connected or the session expired. Reconnect GitHub and try again.' }, 401);

  let body: any;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: 'Request body too large' }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'A valid JSON-RPC request is required' }, 400);
  }

  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return rpcError(body?.id, -32600, 'Invalid JSON-RPC request');
  }

  if (body.method === 'tools/call') {
    const name = body.params?.name;
    if (typeof name !== 'string' || !name) return rpcError(body.id, -32602, 'A tool name is required');
    const args = body.params?.arguments && typeof body.params.arguments === 'object' ? body.params.arguments : {};

    if (!isReadOnlyTool(name) && args.confirm !== true) {
      return rpcError(body.id, -32001, 'Confirmation required. Show the exact operation and its target to the user, obtain approval, then retry with confirm=true.');
    }

    if (Object.prototype.hasOwnProperty.call(args, 'confirm')) {
      const { confirm: _confirm, ...safeArgs } = args;
      body = { ...body, params: { ...body.params, arguments: safeArgs } };
    }
  }

  try {
    const upstream = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'X-MCP-Toolsets': 'default',
      },
      body: JSON.stringify(body),
    });

    const responseText = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'application/json';
    if (!upstream.ok) {
      return json({ error: 'GitHub MCP request failed', status: upstream.status, detail: responseText.slice(0, 1500) }, upstream.status);
    }

    // For tools/list, only return a JSON response after adding explicit confirmation
    // requirements to every non-read-only tool. Never pass through an uninspected tool list.
    if (body.method === 'tools/list') {
      if (!contentType.includes('application/json')) {
        return json({ error: 'GitHub MCP returned a streaming tool list that cannot be safely filtered by this proxy. Retry with a compatible JSON response mode.' }, 502);
      }
      let result: any;
      try { result = JSON.parse(responseText); } catch { return json({ error: 'Invalid tool-list response from GitHub MCP' }, 502); }
      if (Array.isArray(result?.result?.tools)) {
        result.result.tools = result.result.tools.map(addConfirmationSchema);
      }
      return json(result);
    }

    return new Response(responseText, {
      status: upstream.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return json({ error: 'Unable to reach GitHub MCP. Please retry.' }, 502);
  }
};
