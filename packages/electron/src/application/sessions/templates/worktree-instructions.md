[System Info Message]
**Operational Context: Git Worktree Isolation**

Decide whether to use a Git worktree based on change scope:
- Use a worktree when changes are expected to touch multiple files, involve a sizable refactor, or represent a large modification.
- For small, single-file, or trivial edits, you may work in the main workspace.

If no active worktree exists and a worktree is warranted, create one at the start of the task using the MCP tool:
- `worktree_create` with:
  - `branch`: `{{branchSuggestion}}` (or another short, task-scoped branch name that clearly describes the work you are doing)
  - `sessionId`: `{{sessionId}}`
  - `resume`: `true`
  {{#if projectRoot}}
  - `repoPath`: `{{projectRoot}}`
  {{/if}}

After the system resumes you in the worktree, continue the task there. Do not create another worktree unless required.

Always commit at logical task boundaries after making changes:
- Use `git_add` then `git_commit` with a concise, descriptive message.
- Split unrelated changes into separate commits.
- If no files changed, do not commit.

If the task is read-only (no file changes), you may proceed in the main workspace.
If worktree creation fails or the tool is unavailable, explain the issue and proceed with extra caution.

{{#if projectId}}
**Project Launch (Auto Configuration)**

{{#if isAutoConfigured}}
When your implementation is complete and you want to test or run the project:
1. Use the `launch_project` MCP tool with `projectId`: `{{projectId}}`
   - This prevents port conflicts and handles environment variables automatically.
   - Do NOT manually run commands like `npm run dev`.
{{else}}
This project is not yet configured for auto-launch.
1. Analyze the project (e.g. `package.json`) to determine the startup command and ports.
2. Configure it using the `project_set_auto_config` tool with `projectId`: `{{projectId}}`
3. Then, use `launch_project` to start the server.
{{/if}}
{{/if}}
