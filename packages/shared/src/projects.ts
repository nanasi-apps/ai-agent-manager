export type AgentType = 'gemini' | 'claude' | 'codex' | 'cat' | 'custom';

export interface AgentConfig {
    type: AgentType;
    command: string;
    // Working directory for the agent
    cwd?: string;
    // Environment variables to pass
    env?: Record<string, string>;
    // Whether to use stream-json output format (for clean message extraction)
    streamJson?: boolean;
    // Whether this agent uses one-shot mode (new process per message)
    oneShotMode?: boolean;
}

export interface ProjectConfig {
    id: string;
    name: string;
    agent: AgentConfig;
}

export const availableAgents: ProjectConfig[] = [
    {
        id: 'default',
        name: 'Default (Cat Echo)',
        agent: {
            type: 'cat',
            command: 'cat',
        }
    },
    {
        id: 'gemini',
        name: 'Gemini CLI',
        agent: {
            type: 'gemini',
            // Non-interactive mode with stream-json for clean output
            // First message: gemini -p "message" --output-format stream-json -y
            // Subsequent: gemini --resume latest -p "message" --output-format stream-json -y
            command: 'gemini -y --output-format stream-json',
            streamJson: true,
            oneShotMode: true,
        }
    },
    {
        id: 'claude',
        name: 'Claude Code',
        agent: {
            type: 'claude',
            // Print mode with stream-json for one-shot responses
            command: 'claude -p --output-format stream-json',
            streamJson: true,
            oneShotMode: true,
        }
    },
    {
        id: 'codex',
        name: 'OpenAI Codex',
        agent: {
            type: 'codex',
            // Codex exec with JSON streaming output for non-interactive use
            // First message: codex exec --json --full-auto "message"
            // Subsequent: codex exec resume --json <session_id> "message"
            command: 'codex exec --json --full-auto',
            streamJson: true,
            oneShotMode: true,
        }
    },

];

export function getAgentTemplate(id: string): ProjectConfig | undefined {
    return availableAgents.find(p => p.id === id);
}
