import { getDeepMindCapabilities } from "../../server/deepmind/catalog";

export default async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const capabilities = getDeepMindCapabilities();
  return new Response(JSON.stringify({
    service: "manus-remix-deepmind-capabilities",
    status: "ok",
    uiChanged: false,
    capabilities,
    note: "Configured means required environment variables exist; it does not prove that a remote worker is reachable or healthy.",
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
