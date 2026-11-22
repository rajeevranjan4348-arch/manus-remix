# GitHub MCP tool catalog

The standalone server registers the following native MCP tools. Names use the `github_` prefix. Every repository-scoped operation checks `GITHUB_ALLOWED_REPOS` in hosted mode and relies on GitHub's own credential permissions as a second boundary.

| Group | Tool | Behavior | Writes / approval |
|---|---|---|---|
| Repository | `github_search_repositories` | Search repository metadata with pagination. | Read-only |
| Repository | `github_list_my_repositories` | List repositories visible to the configured GitHub identity. | Read-only |
| Repository | `github_get_repository` | Read repository metadata and permissions. | Read-only |
| Repository | `github_create_repository` | Create a repository for the PAT-authenticated user. | Approval required; PAT only |
| Repository | `github_fork_repository` | Fork an allowed source repository only to an exact allowlisted destination; PAT mode targets the authenticated user and App mode requires an allowlisted organization target. | Approval required |
| Repository | `github_archive_repository` | Archive an allowed repository. | Approval required; admin permission required |
| Files/code | `github_browse_repository` | List files/directories at a path/ref, bounded to a page. | Read-only |
| Files/code | `github_read_file` | Read bounded UTF-8 source text and return file SHA. | Read-only |
| Files/code | `github_search_code` | Search indexed code, optionally within one allowed repository. | Read-only |
| Files/code | `github_create_file` | Create a text file on a branch. | Approval required |
| Files/code | `github_update_file` | Update an existing file using its current SHA. | Approval required |
| Files/code | `github_delete_file` | Delete an existing file using its current SHA. | Approval required |
| Files/code | `github_compare_file_changes` | Return a unified diff for a file between two refs. | Read-only |
| Files/code | `github_analyze_repository_structure` | Analyze a bounded Git tree without executing project code (at most 500 entries, 32 tree requests, and depth 8). | Read-only |
| Branches/commits | `github_list_branches` | List repository branches with pagination. | Read-only |
| Branches/commits | `github_create_branch` | Create a branch from a validated source ref. | Approval required |
| Branches/commits | `github_compare_branches` | Compare commit ranges and changed files. | Read-only |
| Branches/commits | `github_list_commits` | List commits at a branch/ref/path. | Read-only |
| Branches/commits | `github_get_commit` | Inspect commit metadata and bounded file summaries. | Read-only |
| Issues | `github_list_issues` | List repository issues (pull requests excluded). | Read-only |
| Issues | `github_search_issues` | Search issues by query and optional repository scope. | Read-only |
| Issues | `github_create_issue` | Create an issue with optional labels/assignees. | Approval required |
| Issues | `github_get_issue` | Read issue details. | Read-only |
| Issues | `github_list_issue_comments` | Read issue comments. | Read-only |
| Pull requests | `github_create_pull_request` | Create a PR between branches. | Approval required |
| Pull requests | `github_review_pull_request` | Submit an approve/comment/request-changes review. | Approval required |
| Pull requests | `github_read_pull_request_diff` | Read changed files and bounded patches. | Read-only |
| Pull requests | `github_add_review_comment` | Add an inline review comment at a diff line. | Approval required |
| Actions | `github_list_workflow_runs` | List workflow runs, optionally filtered by status/branch. | Read-only |
| Actions | `github_get_workflow_run` | Inspect status, conclusion, timestamps, and failed jobs. | Read-only |
| Actions | `github_get_workflow_logs` | Download and read bounded logs with basic secret-pattern redaction. | Read-only, sensitive data |
| Actions | `github_monitor_failed_workflows` | List recent failed/cancelled workflow runs and failed jobs. | Read-only |
| Actions | `github_trigger_workflow` | Dispatch a workflow on a branch/ref with inputs. | Approval required; executes repository workflow code |

## Approval binding

For every write tool, `approvalPhrase` is computed from the exact normalized tool arguments, excluding only the phrase itself. If absent or mismatched, the tool returns an error with the expected phrase and makes no GitHub request. Because the phrase is deterministic and can be derived by a client, it is a protocol guard, not proof of human approval. A trusted Cue confirmation gate must obtain explicit approval and control retries before write tools are exposed to an agent; this server alone does not enforce that human decision.

## Bounds

Pagination is limited to 1–100 items per page. File reads cap at 100,000 characters by default and at 1 MB source size. Repository structure results cap at 500 entries, 32 Git-tree requests, and depth 8; truncated results report that fact. Pull request patches and Actions logs are bounded. Inputs are validated with Zod, and repository paths reject absolute paths, backslashes, traversal segments, and control characters.
