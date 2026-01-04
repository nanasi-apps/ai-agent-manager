import type { AppRouter } from "@agent-manager/shared";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { ContractRouterClient } from "@orpc/contract";

// Initialize the ORPC client
export const createClient = () => {
	const orpcPort =
		typeof window !== "undefined" && window.electronAPI?.getOrpcPort
			? window.electronAPI.getOrpcPort()
			: Number(import.meta.env.VITE_ORPC_PORT) || 3002;
	const hostname =
		typeof window !== "undefined" && window.location.hostname
			? window.location.hostname
			: "localhost";
	const wsUrl = `ws://${hostname}:${orpcPort}`;
	console.log(`Web: Connecting to ORPC via WebSocket (${wsUrl})...`);

	// Create WebSocket instance
	const websocket = new WebSocket(wsUrl);

	websocket.onopen = () => {
		console.log("Web: WebSocket connected");
	};

	websocket.onclose = () => {
		console.log("Web: WebSocket disconnected");
	};

	websocket.onerror = (err) => {
		console.error("Web: WebSocket error", err);
	};

	const link = new RPCLink({
		websocket,
	});

	return createORPCClient<ContractRouterClient<AppRouter>>(link);
};

export const orpc = createClient();
