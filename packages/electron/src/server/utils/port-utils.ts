import { createServer } from "node:net";

/**
 * Check if a port is available
 */
export function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = createServer();

        server.once("error", () => {
            resolve(false);
        });

        server.once("listening", () => {
            server.close(() => {
                resolve(true);
            });
        });

        server.listen(port, "127.0.0.1");
    });
}

/**
 * Find an available port starting from the given port
 * Will try up to maxAttempts ports starting from basePort
 */
export async function findAvailablePort(
    basePort: number,
    maxAttempts: number = 100,
): Promise<number> {
    for (let i = 0; i < maxAttempts; i++) {
        const port = basePort + i;
        if (await isPortAvailable(port)) {
            return port;
        }
    }
    throw new Error(
        `Could not find an available port in range ${basePort}-${basePort + maxAttempts - 1}`,
    );
}

/**
 * Allocate ports for all environment variables in the ports config
 * Returns a map of environment variable name to allocated port number
 */
export async function allocatePorts(
    portsConfig: Record<string, number>,
): Promise<Record<string, number>> {
    const allocatedPorts: Record<string, number> = {};
    const usedPorts = new Set<number>();

    for (const [envVar, defaultPort] of Object.entries(portsConfig)) {
        let port = defaultPort;

        // Find next available port that hasn't been allocated already
        while (usedPorts.has(port) || !(await isPortAvailable(port))) {
            port++;
            // Safety limit to avoid infinite loop
            if (port > defaultPort + 1000) {
                throw new Error(
                    `Could not find available port for ${envVar} starting from ${defaultPort}`,
                );
            }
        }

        allocatedPorts[envVar] = port;
        usedPorts.add(port);
    }

    return allocatedPorts;
}
