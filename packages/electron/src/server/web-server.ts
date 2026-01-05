import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import path from "node:path";
import { attachOrpcToServer } from "./orpc-server";

export function startWebServer(
    port: number,
    host = "0.0.0.0",
) {
    const app = new Hono();

    app.get("/ws", (c) => c.text("WebSocket endpoint", 426));

    const isDev =
        process.env.NODE_ENV === "development" ||
        process.env.ELECTRON_IS_DEV === "1" ||
        process.env.ELECTRON_IS_DEV === "true";

    // In production (bundled), __dirname is 'dist'. renderer is at 'dist/renderer'.
    // In dev, serve the web package build output.
    // Note: __dirname defaults to the directory of the entry point (dist/main.js)
    const staticRoot = isDev
        ? path.resolve(__dirname, "../../web/dist")
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
            console.error(`[WebServer] Failed to serve index.html from ${staticRoot}`, e);
            return c.text("Not Found", 404);
        }
    });

    console.log(`[WebServer] Starting Web Server on http://${host}:${port}`);

    const server = serve({
        fetch: app.fetch,
        port,
        hostname: host,
    });

    attachOrpcToServer(server);

    return server;
}
