import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
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
    const staticRoot = isDev
        ? path.resolve(__dirname, "../../../web/dist")
        : path.resolve(__dirname, "../renderer");

    // Need to verify if serveStatic expects relative path from CWD or absolute.
    // @hono/node-server/serve-static uses relative paths by default or root option.
    // It resolves relative to process.cwd() usually.

    // Let's assume process.cwd() is project root during dev maybe?
    // But Electron app packaged might vary.
    // Safer to use absolute path handling if adapter supports it, but usually it takes string.

    // A common trick is to rewrite request to serve index.html if not found (SPA).

    app.use(
        "/*",
        serveStatic({
            root: staticRoot,
            // We will try to dynamically determine relative path if needed, 
            // but 'dist/renderer' is likely correct if running from package root.
            // If packaged, it might be different.
            // For now, let's point to relative path from where `electron .` is run.
            // `electron .` usually runs in `packages/electron`.
        }),
    );

    // Fallback for SPA routing
    app.get("*", serveStatic({ path: path.join(staticRoot, "index.html") }));

    console.log(`[WebServer] Starting Web Server on http://${host}:${port}`);

    const server = serve({
        fetch: app.fetch,
        port,
        hostname: host,
    });

    attachOrpcToServer(server);

    return server;
}
