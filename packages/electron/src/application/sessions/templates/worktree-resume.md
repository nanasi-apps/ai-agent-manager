[SYSTEM CONTEXT]
Worktree created and activated for this session.
Branch: {{branch}}
Worktree path: {{worktreePath}}

**NOTE: This is a fresh session process.** Context from the previous session state (memory/history) is reset.
Continue the original task from the worktree using the information below. Do not create another worktree unless needed.
Remember to commit at each logical task boundary after making changes (use `git_add` then `git_commit`).
{{#if originalMessage}}

Original request:
{{originalMessage}}
{{/if}}