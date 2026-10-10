/**
 * Server-only client for a separately deployed, authenticated scrcpy host bridge.
 *
 * This is an adapter contract, not a scrcpy daemon: upstream scrcpy does not
 * expose these HTTP endpoints. Never import this module into browser code.
 */
export type ScrcpyBridgeStatus = {
  connected: boolean;
  deviceName?: string;
  sessionId?: string;
};

export type ScrcpyInput =
  | { type: "key"; key: "HOME" | "BACK" | "ENTER" | "DPAD_UP" | "DPAD_DOWN" | "DPAD_LEFT" | "DPAD_RIGHT" }
  | { type: "tap"; x: number; y: number }
  | { type: "text"; text: string };

type BridgeConfig = { baseUrl: URL; token: string };

function getConfig(): BridgeConfig {
  const rawUrl = process.env.SCRCPY_BRIDGE_URL;
  const token = process.env.SCRCPY_BRIDGE_TOKEN;
  if (!rawUrl || !token) {
    throw new Error("Android control bridge is not configured.");
  }

  const baseUrl = new URL(rawUrl);
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname);
  if (baseUrl.protocol !== "https:" && !localHost) {
    throw new Error("Android control bridge must use HTTPS (HTTP is allowed only on localhost).");
  }
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error("Invalid Android control bridge URL.");
  }
  return { baseUrl, token };
}

function endpoint(base: URL, path: string): URL {
  const url = new URL(path, base.toString().endsWith("/") ? base : new URL(base.toString() + "/"));
  if (url.origin !== base.origin) throw new Error("Invalid bridge endpoint.");
  return url;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl, token } = getConfig();
  const url = endpoint(baseUrl, path);
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) {
    // Avoid returning upstream response bodies, which could contain sensitive data.
    throw new Error(`Android control bridge request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export async function getScrcpyBridgeStatus(): Promise<ScrcpyBridgeStatus> {
  return request<ScrcpyBridgeStatus>("/v1/status");
}

/** Call only after the authenticated app has recorded the user's explicit approval. */
export async function startScrcpySession(approvalGranted: boolean): Promise<{ sessionId: string }> {
  if (approvalGranted !== true) throw new Error("User approval is required to start device control.");
  return request<{ sessionId: string }>("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ requestedBy: "manus-remix" }),
  });
}

/** Call only after the authenticated app has recorded the user's explicit approval. */
export async function sendScrcpyInput(
  sessionId: string,
  input: ScrcpyInput,
  approvalGranted: boolean,
): Promise<{ accepted: boolean }> {
  if (approvalGranted !== true) throw new Error("User approval is required for device input.");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(sessionId)) throw new Error("Invalid session ID.");

  if (input.type === "tap") {
    if (!Number.isFinite(input.x) || !Number.isFinite(input.y) ||
        input.x < 0 || input.y < 0 || input.x > 10000 || input.y > 10000) {
      throw new Error("Invalid tap coordinates.");
    }
  } else if (input.type === "text") {
    if (input.text.length < 1 || input.text.length > 500) throw new Error("Text input is too long.");
  }

  return request<{ accepted: boolean }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/input`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function stopScrcpySession(sessionId: string): Promise<{ stopped: boolean }> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(sessionId)) throw new Error("Invalid session ID.");
  return request<{ stopped: boolean }>(
    `/v1/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
}
