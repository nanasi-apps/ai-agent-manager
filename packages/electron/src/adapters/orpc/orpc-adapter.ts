/**
 * oRPC Adapter - Handles oRPC protocol setup for Electron
 *
 * This adapter connects the oRPC router to:
 * - Electron MessagePort (for renderer process communication)
 * - WebSocket (for external/web access)
 * - HTTP server attachment (for Hono integration)
 *
 * Split from the original server/orpc-server.ts for better layer separation.
 */

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { onError } from "@orpc/server";
import { RPCHandler as MessagePortRPCHandler } from "@orpc/server/message-port";
import { RPCHandler as WSRPCHandler } from "@orpc/server/ws";
import { ipcMain } from "electron";
import { WebSocketServer } from "ws";

import type { AppRouter } from "@agent-manager/shared";

/**
 * Server type that supports WebSocket upgrade.
 * This is a minimal interface that works with both HTTP and HTTP/2 servers.
 */
interface UpgradableServer {
    on(
        event: "upgrade",
        listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void,
    ): this;
}

const ORPC_WS_PATH = "/ws";

/**
 * Creates a WebSocket RPC handler for the given router.
 */
function createWsHandler(router: AppRouter) {
    return new WSRPCHandler(router, {
        interceptors: [
            onError((error) => {
                console.error("[ORPC] WebSocket error:", error);
            }),
        ],
    });
}

/**
 * Set up oRPC handlers for Electron IPC (MessagePort).
 *
 * This enables type-safe RPC between the main process and renderer.
 *
 * @param router - The oRPC router created by createRouter(ctx)
 */
export function setupElectronOrpc(router: AppRouter) {
    const handler = new MessagePortRPCHandler(router);

    ipcMain.on("start-orpc-server", (event) => {
        const [serverPort] = event.ports;
        handler.upgrade(serverPort);
        serverPort.start();
    });
}

/**
 * Attach oRPC WebSocket handling to an existing HTTP server.
 *
 * This is used by the Hono web server for external access.
 *
 * @param server - The HTTP server to attach to (supports HTTP and HTTP/2)
 * @param router - The oRPC router
 * @returns The WebSocket server instance
 */
export function attachOrpcToServer(
    server: UpgradableServer,
    router: AppRouter,
) {
    const wss = new WebSocketServer({ noServer: true });
    console.log("[ORPC] WebSocket attached to HTTP server");
    const handler = createWsHandler(router);

    server.on(
        "upgrade",
        (request: IncomingMessage, socket: Duplex, head: Buffer) => {
            const requestUrl = request?.url ?? "";
            const path = requestUrl.split("?")[0];
            if (path !== ORPC_WS_PATH) {
                socket.destroy();
                return;
            }

            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit("connection", ws, request);
            });
        },
    );

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

/**
 * Start a standalone oRPC WebSocket server.
 *
 * @param router - The oRPC router
 * @param port - Port to listen on (default: 3002)
 * @returns The WebSocket server instance
 */
export function startOrpcWsServer(
    router: AppRouter,
    port: number = 3002,
) {
    const wss = new WebSocketServer({ port, path: ORPC_WS_PATH });
    console.log(
        `[ORPC] WebSocket server started on port ${port} (path: ${ORPC_WS_PATH})`,
    );

    const handler = createWsHandler(router);

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
