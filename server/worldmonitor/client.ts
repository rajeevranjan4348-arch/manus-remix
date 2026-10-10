/**
 * Server-side World Monitor MCP client.
 *
 * Uses the official hosted MCP endpoint; it does not embed the World Monitor
 * application or its UI. Call only from a trusted server/Netlify Function.
 */
export type WorldMonitorTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type McpEnvelope<T> = {
  jsonrpc?: string;
  id?: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

const DEFAULT_ENDPOINT = "https://worldmonitor.app/mcp";
const REQUEST_TIMEOUT_MS = 12_000;

function getConfig() {
  const endpoint = process.env.WORLDMONITOR_MCP_URL || DEFAULT_ENDPOINT;
  const apiKey = process.env.WORLDMONITOR_API_KEY;

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("WORLDMONITOR_MCP_URL must be a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error("World Monitor MCP endpoint must use HTTPS.");
  }
  return { endpoint: parsed.toString(), apiKey };
}

async function mcpRequest<T>(
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const { endpoint, apiKey } = getConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (apiKey) headers["X-WorldMonitor-Key"] = apiKey;

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        ...(params ? { params } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`World Monitor MCP returned HTTP ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") || "";
    const raw = await response.text();
    let envelope: McpEnvelope<T>;

    if (contentType.includes("text/event-stream")) {
      const dataLine = raw
        .split(/\r?\n/)
        .find((line) => line.startsWith("data:"));
      if (!dataLine) throw new Error("World Monitor MCP returned no data event.");
      envelope = JSON.parse(dataLine.slice(5).trim()) as McpEnvelope<T>;
    } else {
      envelope = JSON.parse(raw) as McpEnvelope<T>;
    }

    if (envelope.error) {
      throw new Error(`World Monitor MCP error: ${envelope.error.message}`);
    }
    if (envelope.result === undefined) {
      throw new Error("World Monitor MCP response did not contain a result.");
    }
    return envelope.result;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("World Monitor request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function listWorldMonitorTools(): Promise<WorldMonitorTool[]> {
  const result = await mcpRequest<{ tools?: WorldMonitorTool[] }>("tools/list");
  return Array.isArray(result.tools) ? result.tools : [];
}

/**
 * Invoke a tool discovered from tools/list. Callers should validate the tool
 * name and arguments against the discovered schema and require authentication
 * before exposing this through an API route.
 */
export async function callWorldMonitorTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(name)) {
    throw new Error("Invalid World Monitor tool name.");
  }
  const result = await mcpRequest<unknown>("tools/call", {
    name,
    arguments: args,
  });
  return result;
}
