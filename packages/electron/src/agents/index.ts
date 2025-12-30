// Agent manager interface and proxy

export type { IAgentManager } from "./agent-manager";
export {
	agentManager,
	getAgentManager,
	setAgentManager,
} from "./agent-manager";
export type { AgentTypeDetection } from "./agent-type-utils";
export {
	detectAgentType,
	isAgentType,
	supportsMcpIntegration,
} from "./agent-type-utils";
// Utilities
export { AGENT_TYPES, MCP_SERVER_URL } from "./constants";
// Agent implementations
export {
	OneShotAgentManager,
	oneShotAgentManager,
} from "./oneshot-agent-manager";
export type { ParsedLog, ParsedLogMetadata } from "./output-parser";
// Output parser
export { AgentOutputParser } from "./output-parser";
export {
	UnifiedAgentManager,
	unifiedAgentManager,
} from "./unified-agent-manager";
