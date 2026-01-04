import type { AppRouter } from "@agent-manager/shared";
import { createORPCClient } from "@orpc/client";
import { RPCLink as MessagePortRPCLink } from "@orpc/client/message-port";
import { RPCLink as WSRPCLink } from "@orpc/client/websocket";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

// Initialize the ORPC client
export const createClient = () => {
	// 1. Electron Mode (MessagePort)
	if (typeof window !== "undefined" && window.electronAPI) {
		console.log("Web: Connecting to ORPC via Electron MessagePort...");
		const { port1: clientPort, port2: serverPort } = new MessageChannel();

		window.postMessage("start-orpc-client", "*", [serverPort]);

		const link = new MessagePortRPCLink({
			port: clientPort,
		});

		clientPort.start();

		return createORPCClient<ContractRouterClient<AppRouter>>(link);
	}

	// 2. Web Mode (WebSocket)
	const hostname =
		typeof window !== "undefined" && window.location.hostname
			? window.location.hostname
			: "localhost";
	const protocol =
		typeof window !== "undefined" && window.location.protocol === "https:"
			? "wss:"
			: "ws:";
	const envPort = Number(import.meta.env.VITE_ORPC_PORT) || undefined;
	const locationPort =
		typeof window !== "undefined" && window.location.port
			? Number(window.location.port)
			: undefined;

	const port = envPort || locationPort || 3002;
	const wsUrl = `${protocol}//${hostname}:${port}/ws`;
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

	const link = new WSRPCLink({
		websocket,
	});

	return createORPCClient<ContractRouterClient<AppRouter>>(link);
};

export const orpc = createClient();

// TanStack Query utilities for all ORPC procedures
export const orpcQuery = createTanstackQueryUtils(orpc);
