/**
 * IWebServerService - Port interface for the standalone web server
 *
 * This interface defines the contract for managing a web server
 * that exposes the agent manager's API over HTTP (Hono + oRPC).
 */

export interface IWebServerStatus {
	isRunning: boolean;
	port?: number;
	localUrl?: string;
	networkUrl?: string;
}

export interface IWebServerService {
	start(options?: { port?: number; host?: string }): Promise<IWebServerStatus>;

	stop(): Promise<boolean>;

	getStatus(): Promise<IWebServerStatus>;
}
