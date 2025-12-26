// Agent manager interface and proxy
export { agentManager, setAgentManager, getAgentManager } from './agent-manager';
export type { IAgentManager } from './agent-manager';

// Agent implementations
export { OneShotAgentManager, oneShotAgentManager } from './oneshot-agent-manager';
export { PtyAgentManager, ptyAgentManager } from './pty-agent-manager';

// Output parser
export { AgentOutputParser } from './output-parser';
export type { ParsedLog, ParsedLogMetadata } from './output-parser';
