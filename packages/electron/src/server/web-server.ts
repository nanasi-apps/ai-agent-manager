import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppRouter, AppRouterFromFactory } from "@agent-manager/shared";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { attachOrpcToServer } from "../adapters/orpc";

/**
 * Union type accepting both legacy AppRouter and factory-created router.
 */
type AnyAppRouter = AppRouter | AppRouterFromFactory;

export function startWebServer(
	port: number,
	host = "0.0.0.0",
	router?: AnyAppRouter,
) {
	const app = new Hono();

	app.get("/ws", (c) => c.text("WebSocket endpoint", 426));

	const isDev =
		process.env.NODE_ENV === "development" ||
		process.env.ELECTRON_IS_DEV === "1" ||
		process.env.ELECTRON_IS_DEV === "true";

	// In production (bundled), __dirname is 'dist'. renderer is at 'dist/renderer'.
	// In dev, serve the web package build output.
	// In dev, serve the web package build output.
	// Note: __dirname is '.../dist/server', so we need to go up 3 levels to reach 'packages'
	const staticRoot = isDev
		? path.resolve(__dirname, "../../../web/dist")
		: path.resolve(__dirname, "renderer");

	console.log(`[WebServer] Static Root: ${staticRoot}`);

	app.use(
		"/*",
		serveStatic({
			root: staticRoot,
		}),
	);

	// Fallback for SPA routing
	app.get("*", async (c) => {
		try {
			const indexPath = path.join(staticRoot, "index.html");
			const content = await readFile(indexPath, "utf-8");
			return c.html(content);
		} catch (e) {
			console.error(
				`[WebServer] Failed to serve index.html from ${staticRoot}`,
				e,
			);
			return c.text("Not Found", 404);
		}
	});

	console.log(`[WebServer] Starting Web Server on http://${host}:${port}`);

	const server = serve({
		fetch: app.fetch,
		port,
		hostname: host,
	});

	// Only attach oRPC if router is provided
	if (router) {
		// Cast is safe - both AppRouter and AppRouterFromFactory are structurally compatible
		attachOrpcToServer(server, router as AppRouter);
	}

	return server;
}
