export const HANDOVER_SUMMARY_PROMPT = `
Please summarize the conversation so far based on the following points:
1. Purpose
2. Knowledge
3. Actions to take / Unclear points
`;

export function buildHandoverContext(
    previousAgentName: string,
    summary: string,
): string {
    return `[SYSTEM CONTEXT from previous agent]:
${summary}

[User's message follows]
`;
}
