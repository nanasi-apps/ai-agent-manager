export * from "./router.js";
export * from "./agent-manager.js";
export * from "./projects.js";
export { store, type Conversation, type Message } from "./store.js";

export const sharedParam = "test";

// Legacy interface - keeping for compatibility, prefer AgentConfig from projects.ts
export interface IAgentManagerAPI {
	// 環境情報の取得
	getPlatform(): Promise<"electron" | "web">;

	// エージェント操作（共通）
	startAgent(config: { name: string; model: string }): Promise<void>;
	stopAgent(id: string): Promise<void>;
}
