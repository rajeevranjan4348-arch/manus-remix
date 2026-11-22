export default function Home() {
  return (
    <main style={{ maxWidth: 760, margin: '10vh auto', padding: '0 24px', lineHeight: 1.6 }}>
      <h1>Cue GitHub MCP Server</h1>
      <p>Authenticated, read-only GitHub repository, code, branch, issue, pull-request, and Actions tools.</p>
      <p>
        MCP endpoint: <code>/api/mcp</code>
      </p>
      <p>Write operations are disabled. Requests require an allowlisted Firebase identity.</p>
    </main>
  );
}
