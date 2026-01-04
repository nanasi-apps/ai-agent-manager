import { appRouter } from "@agent-manager/shared";
import { onError } from "@orpc/server";
import { RPCHandler as MessagePortRPCHandler } from "@orpc/server/message-port";
import { RPCHandler as WSRPCHandler } from "@orpc/server/ws";
import { ipcMain } from "electron";
import { WebSocketServer } from "ws";

const ORPC_WS_PATH = "/ws";

const createWsHandler = () =>
	new WSRPCHandler(appRouter, {
		interceptors: [
			onError((error) => {
				console.error("[ORPC] WebSocket error:", error);
			}),
		],
	});

export function setupElectronOrpc() {
	const handler = new MessagePortRPCHandler(appRouter);

	ipcMain.on("start-orpc-server", (event) => {
		const [serverPort] = event.ports;
		handler.upgrade(serverPort);
		serverPort.start();
	});
}

export function attachOrpcToServer(server: any) {
	const wss = new WebSocketServer({ noServer: true });
	console.log("[ORPC] WebSocket attached to HTTP server");
	const handler = createWsHandler();

	server.on("upgrade", (request: any, socket: any, head: any) => {
		const requestUrl = request?.url ?? "";
		const path = requestUrl.split("?")[0];
		if (path !== ORPC_WS_PATH) {
			socket.destroy();
			return;
		}

		wss.handleUpgrade(request, socket, head, (ws) => {
			wss.emit("connection", ws, request);
		});
	});

	wss.on("connection", (ws) => {
		console.log("[ORPC] Client connected");

		handler.upgrade(ws);

		ws.on("close", () => {
			console.log("[ORPC] Client disconnected");
		});

		ws.on("error", (err) => {
			console.error("[ORPC] Client connection error:", err);
		});
	});

	return wss;
}

export function startOrpcWsServer(port: number = 3002) {
	const wss = new WebSocketServer({ port, path: ORPC_WS_PATH });
	console.log(
		`[ORPC] WebSocket server started on port ${port} (path: ${ORPC_WS_PATH})`,
	);

	const handler = createWsHandler();

	wss.on("connection", (ws) => {
		console.log("[ORPC] Client connected");

		handler.upgrade(ws);

		ws.on("close", () => {
			console.log("[ORPC] Client disconnected");
		});

		ws.on("error", (err) => {
			console.error("[ORPC] Client connection error:", err);
		});
	});

	return wss;
}
