export interface AgentDriverCommand {
    command: string;
    args: string[];
}

export interface AgentDriverContext {
    sessionId: string;
    messageCount: number;
    geminiSessionId?: string;
    codexThreadId?: string;
}

export interface AgentDriver {
    getCommand(context: AgentDriverContext, message: string): AgentDriverCommand;
}
