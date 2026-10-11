import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Octokit } from "@octokit/rest";
import { z } from "zod";

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("Missing GITHUB_TOKEN. Set it in the MCP client's environment.");
  process.exit(1);
}

const allowedRepos = new Set(
  (process.env.GITHUB_ALLOWED_REPOS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

const octokit = new Octokit({ auth: token, userAgent: "standalone-github-mcp/1.0" });
const server = new McpServer({
  name: "standalone-github-mcp",
  version: "1.0.0",
});

function assertRepo(owner: string, repo: string) {
  const fullName = `${owner}/${repo}`.toLowerCase();
  if (allowedRepos.size > 0 && !allowedRepos.has(fullName)) {
    throw new Error(`Repository ${owner}/${repo} is outside GITHUB_ALLOWED_REPOS.`);
  }
  return fullName;
}

function approvalPhrase(operation: string, owner: string, repo: string, target: string) {
  return `APPROVE ${operation} ${owner}/${repo}${target}`;
}

function requireApproval(
  provided: string,
  operation: string,
  owner: string,
  repo: string,
  target: string,
) {
  const expected = approvalPhrase(operation, owner, repo, target);
  if (provided !== expected) {
    throw new Error(
      `Explicit approval required. Show the user the exact target and change, obtain their approval, then retry with approvalPhrase exactly equal to: "${expected}".`,
    );
  }
}

function asText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const repoArgs = {
  owner: z.string().min(1).describe("GitHub repository owner/login."),
  repo: z.string().min(1).describe("Repository name."),
};

server.registerTool(
  "github_get_repository",
  {
    title: "Get repository",
    description: "Read repository metadata. Read-only; no approval required.",
    inputSchema: repoArgs,
  },
  async ({ owner, repo }) => {
    assertRepo(owner, repo);
    const { data } = await octokit.rest.repos.get({ owner, repo });
    return asText({
      full_name: data.full_name,
      description: data.description,
      private: data.private,
      default_branch: data.default_branch,
      html_url: data.html_url,
      pushed_at: data.pushed_at,
    });
  },
);

server.registerTool(
  "github_list_files",
  {
    title: "List repository files",
    description: "List files in a repository directory. Read-only; no approval required.",
    inputSchema: {
      ...repoArgs,
      path: z.string().default("").describe("Directory path; empty string means repository root."),
      ref: z.string().optional().describe("Branch, tag, or commit; defaults to repository default branch."),
    },
  },
  async ({ owner, repo, path, ref }) => {
    assertRepo(owner, repo);
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ...(ref ? { ref } : {}) });
    const items = Array.isArray(data) ? data : [data];
    return asText(items.map((item) => ({
      name: item.name,
      path: item.path,
      type: item.type,
      size: item.type === "file" ? item.size : undefined,
      html_url: item.html_url,
    })));
  },
);

server.registerTool(
  "github_read_file",
  {
    title: "Read file",
    description: "Read UTF-8 text from a repository file. Read-only; no approval required. Binary files are not supported.",
    inputSchema: {
      ...repoArgs,
      path: z.string().min(1),
      ref: z.string().optional(),
    },
  },
  async ({ owner, repo, path, ref }) => {
    assertRepo(owner, repo);
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ...(ref ? { ref } : {}) });
    if (Array.isArray(data) || data.type !== "file") throw new Error("The requested path is not a single file.");
    if (data.encoding !== "base64" || !data.content) throw new Error("GitHub did not return base64 file content.");
    const decoded = Buffer.from(data.content, "base64");
    if (decoded.includes(0)) throw new Error("Binary files are not supported by this text-reading tool.");
    return asText({ path, sha: data.sha, content: decoded.toString("utf8") });
  },
);

server.registerTool(
  "github_search_code",
  {
    title: "Search code",
    description: "Search code in repositories the token can access. GitHub may require code-search access and indexing.",
    inputSchema: {
      query: z.string().min(1).max(256),
      owner: z.string().optional(),
      repository: z.string().optional().describe("Optional exact owner/repo filter. Required when GITHUB_ALLOWED_REPOS is configured."),
      perPage: z.number().int().min(1).max(30).default(10),
    },
  },
  async ({ query, owner, repository, perPage }) => {
    if (allowedRepos.size > 0) {
      if (!repository || !allowedRepos.has(repository.toLowerCase())) {
        throw new Error("When GITHUB_ALLOWED_REPOS is configured, repository must name one allowed owner/repo.");
      }
    }
    if (repository && !/^[^/]+\/[^/]+$/.test(repository)) {
      throw new Error("repository must use owner/repo format.");
    }
    const scopedQuery = repository ? `${query} repo:${repository}` : owner ? `${query} org:${owner}` : query;
    const { data } = await octokit.rest.search.code({
      q: scopedQuery,
      per_page: perPage,
    });
    return asText(data.items.map((item) => ({
      name: item.name,
      path: item.path,
      repository: item.repository.full_name,
      html_url: item.html_url,
    })));
  },
);

server.registerTool(
  "github_list_issues",
  {
    title: "List issues",
    description: "List repository issues. Pull requests are excluded from the result.",
    inputSchema: {
      ...repoArgs,
      state: z.enum(["open", "closed", "all"]).default("open"),
      perPage: z.number().int().min(1).max(50).default(20),
    },
  },
  async ({ owner, repo, state, perPage }) => {
    assertRepo(owner, repo);
    const { data } = await octokit.rest.issues.listForRepo({ owner, repo, state, per_page: perPage });
    return asText(data.filter((item) => !item.pull_request).map((item) => ({
      number: item.number,
      title: item.title,
      state: item.state,
      html_url: item.html_url,
      created_at: item.created_at,
    })));
  },
);

server.registerTool(
  "github_create_issue",
  {
    title: "Create issue (approval required)",
    description: "Creates a GitHub issue. MUST show the exact repository, title, and body to the user and obtain explicit approval before calling. approvalPhrase must exactly match APPROVE create_issue owner/repo:<exact-title>.",
    inputSchema: {
      ...repoArgs,
      title: z.string().min(1).max(256),
      body: z.string().max(60000).default(""),
      approvalPhrase: z.string().describe("Exact approval phrase: APPROVE create_issue owner/repo:<exact-title>"),
    },
  },
  async ({ owner, repo, title, body, approvalPhrase: provided }) => {
    assertRepo(owner, repo);
    requireApproval(provided, "create_issue", owner, repo, `:${title}`);
    const { data } = await octokit.rest.issues.create({ owner, repo, title, body });
    return asText({ number: data.number, title: data.title, html_url: data.html_url, state: data.state });
  },
);

server.registerTool(
  "github_create_or_update_file",
  {
    title: "Create or update file (approval required)",
    description: "Creates or replaces a text file on a branch. MUST show repository, path, branch, and complete proposed content to the user and obtain explicit approval before calling. For an existing file, provide its current SHA. approvalPhrase must exactly match APPROVE write_file owner/repo:<path>@<branch>.",
    inputSchema: {
      ...repoArgs,
      path: z.string().min(1),
      content: z.string().max(100000),
      message: z.string().min(1).max(256),
      branch: z.string().min(1).default("main"),
      existingSha: z.string().optional().describe("Current file SHA when updating an existing file; omit only when creating a new file."),
      approvalPhrase: z.string().describe("Exact approval phrase: APPROVE write_file owner/repo:<path>@<branch>"),
    },
  },
  async ({ owner, repo, path, content, message, branch, existingSha, approvalPhrase: provided }) => {
    assertRepo(owner, repo);
    requireApproval(provided, "write_file", owner, repo, `:${path}@${branch}`);
    const result = await octokit.rest.repos.createOrUpdateFileContents({
      owner, repo, path, message, content: Buffer.from(content, "utf8").toString("base64"), branch,
      ...(existingSha ? { sha: existingSha } : {}),
    });
    return asText({
      path,
      branch,
      commit: result.data.commit.html_url,
      content_url: result.data.content?.html_url,
      operation: existingSha ? "updated" : "created",
    });
  },
);

server.registerTool(
  "github_create_pull_request",
  {
    title: "Create pull request (approval required)",
    description: "Opens a pull request. MUST show base/head branches, title, and body to the user and obtain explicit approval before calling. approvalPhrase must exactly match APPROVE create_pull_request owner/repo:<head>-><base>:<title>.",
    inputSchema: {
      ...repoArgs,
      title: z.string().min(1).max(256),
      head: z.string().min(1).describe("Source branch."),
      base: z.string().min(1).default("main").describe("Target branch."),
      body: z.string().max(60000).default(""),
      draft: z.boolean().default(true),
      approvalPhrase: z.string().describe("Exact approval phrase: APPROVE create_pull_request owner/repo:<head>-><base>:<title>"),
    },
  },
  async ({ owner, repo, title, head, base, body, draft, approvalPhrase: provided }) => {
    assertRepo(owner, repo);
    requireApproval(provided, "create_pull_request", owner, repo, `:${head}->${base}:${title}`);
    const { data } = await octokit.rest.pulls.create({ owner, repo, title, head, base, body, draft });
    return asText({ number: data.number, html_url: data.html_url, state: data.state, draft: data.draft });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Standalone GitHub MCP server started on stdio.");
