import type { AgentConfig } from './agent';

/**
 * Project configuration template
 */
export interface ProjectConfig {
    id: string;
    name: string;
    agent: AgentConfig;
}

/**
 * Available agent templates
 */
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

/**
 * Get agent template by ID
 */
export function getAgentTemplate(id: string): ProjectConfig | undefined {
    return availableAgents.find(p => p.id === id);
}
