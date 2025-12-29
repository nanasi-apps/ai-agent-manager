import { appRouter } from "@agent-manager/shared";
import { RPCHandler } from "@orpc/server/ws";
import { WebSocketServer } from "ws";

export function startOrpcServer(port: number = 3002) {
	const wss = new WebSocketServer({ port });
	console.log(`[ORPC] WebSocket server started on port ${port}`);

	const handler = new RPCHandler(appRouter);

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
