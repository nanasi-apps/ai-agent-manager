export * from "./router";

export const sharedParam = "test";

export interface AgentConfig {
	name: string;
	model: string;
}

export interface IAgentManagerAPI {
	// 環境情報の取得
	getPlatform(): Promise<"electron" | "web">;

	// エージェント操作（共通）
	startAgent(config: AgentConfig): Promise<void>;
	stopAgent(id: string): Promise<void>;
}
