# GitHub MCP tool catalog

The server exposes 33 tools when write tools are enabled. With the default `MCP_ENABLE_WRITE_TOOLS=false`, only the read-only tools are advertised. Inputs below are the stable tool names and core fields; pagination, bounds, and optional filters are described in each tool's MCP schema.

## Repositories

| Tool | Access | Core inputs |
|---|---|---|
| `github_search_repositories` | Read | `query`; optional `page`, `perPage` |
| `github_list_my_repositories` | Read | optional `visibility`, `affiliation`, `sort`, `direction`, `page`, `perPage` |
| `github_get_repository` | Read | `owner`, `repo` |
| `github_create_repository` | Write; confirmation | `name`; optional `description`, `visibility`, `autoInit` |
| `github_fork_repository` | Write; confirmation | `owner`, `repo`; optional target `organization` |
| `github_archive_repository` | Destructive write; confirmation | `owner`, `repo` |

## Files and code

| Tool | Access | Core inputs |
|---|---|---|
| `github_browse_repository` | Read | `owner`, `repo`; optional `path`, `ref`, `maxEntries` |
| `github_read_file` | Read | `owner`, `repo`, `path`; optional `ref`, `maxChars` |
| `github_search_code` | Read | `query`; optional exact `repository`, `page`, `perPage` |
| `github_create_file` | Write; confirmation | `owner`, `repo`, `path`, full `content`, commit `message`, `branch` |
| `github_update_file` | Write; confirmation | `owner`, `repo`, `path`, full new `content`, `message`, `branch`, current `existingSha` |
| `github_delete_file` | Destructive write; confirmation | `owner`, `repo`, `path`, `message`, `branch`, current `existingSha` |
| `github_compare_file_changes` | Read | `owner`, `repo`, `path`, `baseRef`, `headRef`; optional `maxDiffChars` |
| `github_analyze_repository_structure` | Read | `owner`, `repo`; optional `ref`, `maxEntries` |

## Branches and commits

| Tool | Access | Core inputs |
|---|---|---|
| `github_list_branches` | Read | `owner`, `repo`; optional `protectedOnly`, `page`, `perPage` |
| `github_create_branch` | Write; confirmation | `owner`, `repo`, `branchName`, `sourceRef` |
| `github_compare_branches` | Read | `owner`, `repo`, `baseRef`, `headRef`; optional `page`, `perPage` |
| `github_list_commits` | Read | `owner`, `repo`; optional `ref`, `path`, `page`, `perPage` |
| `github_get_commit` | Read | `owner`, `repo`, `ref`; optional `maxFiles` |

## Issues and pull requests

| Tool | Access | Core inputs |
|---|---|---|
| `github_list_issues` | Read | `owner`, `repo`; optional `state`, `labels`, `sort`, `direction`, `page`, `perPage` |
| `github_search_issues` | Read | `query`; optional exact `repository`, `state`, `page`, `perPage` |
| `github_create_issue` | Write; confirmation | `owner`, `repo`, `title`; optional `body`, `labels`, `assignees` |
| `github_get_issue` | Read | `owner`, `repo`, `issueNumber` |
| `github_list_issue_comments` | Read | `owner`, `repo`, `issueNumber`; optional `page`, `perPage` |
| `github_create_pull_request` | Write; confirmation | `owner`, `repo`, `title`, `head`, `base`; optional `body`, `draft`, `maintainerCanModify` |
| `github_review_pull_request` | Write; confirmation | `owner`, `repo`, `pullNumber`, `event`, optional `body` |
| `github_read_pull_request_diff` | Read | `owner`, `repo`, `pullNumber`; optional `page`, `perPage`, `maxPatchChars` |
| `github_add_review_comment` | Write; confirmation | `owner`, `repo`, `pullNumber`, `path`, `line`, `body`; optional `side`, `commitId` |

## GitHub Actions

| Tool | Access | Core inputs |
|---|---|---|
| `github_list_workflow_runs` | Read | `owner`, `repo`; optional `branch`, `event`, `status`, `workflowId`, `page`, `perPage` |
| `github_get_workflow_run` | Read | `owner`, `repo`, `runId` |
| `github_get_workflow_logs` | Read sensitive output | `owner`, `repo`, `runId`; optional archive and character bounds |
| `github_monitor_failed_workflows` | Read | `owner`, `repo`; optional `branch`, `page`, `perPage` |
| `github_trigger_workflow` | Executes selected repository workflow; confirmation | `owner`, `repo`, `workflowId`, `ref`; optional `inputs` |

## Approval and execution boundaries

Write tools are not registered unless `MCP_ENABLE_WRITE_TOOLS=true`. If enabled, the server asks the connected MCP client for a form elicitation that includes the exact operation, target, and arguments; any decline, timeout, unsupported client, invalid response, or oversized request stops before a GitHub write. The client is responsible for presenting a genuine user-facing approval UI. This project has not verified that Cue's current agent path handles elicitation or connects to this server, so hosted deployment should keep writes disabled until that integration is tested.

The server never checks out, interprets, or automatically executes repository code. The one explicit execution-capable operation is `github_trigger_workflow`; it can dispatch only a selected workflow and requires the above human confirmation when enabled. Do not expose this operation to an untrusted client or enable it without the necessary review and Actions permissions.
