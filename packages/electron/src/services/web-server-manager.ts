import type {
	IWebServerService,
	IWebServerStatus,
} from "@agent-manager/shared";
import { getLogger } from "@agent-manager/shared";
import getPort from "get-port";
import { networkInterfaces } from "os";
import { startWebServer } from "../server/web-server";

const logger = getLogger(["electron", "web-server-manager"]);

class WebServerManager implements IWebServerService {
	private server: any | null = null;
	private status: IWebServerStatus = {
		isRunning: false,
	};

	async start(options?: {
		port?: number;
		host?: string;
	}): Promise<IWebServerStatus> {
		if (this.server) {
			logger.warn("Web Server is already running. Stopping it first.");
			await this.stop();
		}

		const host = options?.host || "0.0.0.0";
		let port = options?.port;

		if (!port) {
			port = await getPort();
			logger.info("No port specified. Using random available port: {port}", {
				port,
			});
		} else {
			// Verify if port is available, or find next available
			// But user asked to use specified port OR random if not specified.
			// If specified port is busy, startWebServer (Hono/Node) might fail or we should check it.
			// Hono's serve might fail if port used.
			// Let's rely on standard binding behavior or check it.
			// If user explicitly asks for port X, we try X.
		}

		try {
			this.server = startWebServer(port, host);

			const localUrl = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;

			// Get Network IP
			let networkUrl: string | undefined;
			const nets = networkInterfaces();
			for (const name of Object.keys(nets)) {
				for (const net of nets[name]!) {
					// Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
					// 'IPv4' is in Node <= 17, from 18 it's a number 4 or string family 'IPv4'
					const familyV4Value = typeof net.family === "string" ? "IPv4" : 4;
					if (net.family === familyV4Value && !net.internal) {
						networkUrl = `http://${net.address}:${port}`;
					}
				}
			}

			this.status = {
				isRunning: true,
				port,
				localUrl,
				networkUrl,
			};

			logger.info(
				"Web Server started successfully at {localUrl}, {networkUrl}",
				{ localUrl, networkUrl },
			);
		} catch (error) {
			logger.error("Failed to start Web Server: {error}", { error });
			this.status = { isRunning: false };
			throw error;
		}

		return this.status;
	}

	async stop(): Promise<boolean> {
		if (!this.server) {
			return false;
		}

		try {
			// Hono serve returns an object with .close()
			if (typeof this.server.close === "function") {
				this.server.close();
			} else {
				// Fallback if structure changes
				logger.warn("Server object does not have close method.");
			}

			this.server = null;
			this.status = { isRunning: false };
			logger.info("Web Server stopped.");
			return true;
		} catch (error) {
			logger.error("Failed to stop Web Server: {error}", { error });
			return false;
		}
	}

	async getStatus(): Promise<IWebServerStatus> {
		return this.status;
	}
}

export const webServerManager = new WebServerManager();
