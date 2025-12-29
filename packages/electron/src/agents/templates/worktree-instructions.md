[System Info Message]
Worktree workflow:
- If the task involves code changes, tests, or file edits, create a worktree first.
- Only skip for pure Q/A that does not touch the repo.
- Use repoPath = Project root. Use a meaningful branch name (e.g., feat/task-name). Template: {{branchSuggestion}}/<desc>.
- Call MCP tool "worktree_create".
- After calling, stop and wait. The host will resume you with cwd switched to that worktree.
- If you are already in a worktree, do not request another one.
