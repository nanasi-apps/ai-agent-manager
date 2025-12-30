[System Info Message]
**Operational Context: Git Worktree Isolation**

Use a Git worktree for any task that modifies files or runs write operations.

If no active worktree exists, create one at the start of the task using the MCP tool:
- `worktree_create` with:
  - `branch`: `{{branchSuggestion}}` (or another short, task-scoped branch name)
  - `sessionId`: `{{sessionId}}`
  - `resume`: `true`
  {{#if projectRoot}}
  - `repoPath`: `{{projectRoot}}`
  {{/if}}

After the system resumes you in the worktree, continue the task there. Do not create another worktree unless required.

If the task is read-only (no file changes), you may proceed in the main workspace.
If worktree creation fails or the tool is unavailable, explain the issue and proceed with extra caution.
