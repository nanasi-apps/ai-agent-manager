/**
 * Chat message
 */
export interface Message {
    id: string;
    role: 'user' | 'agent' | 'system';
    content: string;
    timestamp: number;
    logType?: 'text' | 'tool_call' | 'tool_result' | 'thinking' | 'error' | 'system';
}

/**
 * Conversation session
 */
export interface Conversation {
    id: string;
    projectId: string;
    title: string;
    initialMessage: string;
    createdAt: number;
    updatedAt: number;
    geminiSessionName?: string;
    messages: Message[];
    agentType?: string;
}

/**
 * Project entity
 */
export interface Project {
    id: string;
    name: string;
    description?: string;
    createdAt: number;
    updatedAt: number;
}

/**
 * Interface for store implementations
 */
export interface IStore {
    // Data path
    setDataPath(dirPath: string): void;

    // Conversation methods
    addConversation(conversation: Conversation): void;
    getConversation(id: string): Conversation | undefined;
    listConversations(projectId?: string): Conversation[];
    updateConversation(id: string, updates: Partial<Conversation>): void;
    deleteConversation(id: string): void;

    // Message methods
    addMessage(conversationId: string, message: Message): void;
    getMessages(conversationId: string): Message[];

    // Project methods
    addProject(project: Project): void;
    getProject(id: string): Project | undefined;
    listProjects(): Project[];
    deleteProject(id: string): void;
}
