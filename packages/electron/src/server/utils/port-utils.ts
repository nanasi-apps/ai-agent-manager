import getPort, { portNumbers } from "get-port";

/**
 * Check if a port is available
 * Uses get-port to verify if the specific port can be bound
 */
export async function isPortAvailable(port: number): Promise<boolean> {
    const availablePort = await getPort({ port });
    return availablePort === port;
}

/**
 * Find an available port starting from the given port
 * Will try up to maxAttempts ports starting from basePort
 */
export async function findAvailablePort(
    basePort: number,
    maxAttempts: number = 100,
): Promise<number> {
    return await getPort({
        port: portNumbers(basePort, basePort + maxAttempts - 1),
    });
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
        // We use isPortAvailable loop here because we need to ensure it doesn't conflict
        // with other ports we just allocated in this function (usedPorts)
        while (usedPorts.has(port) || !(await isPortAvailable(port))) {
            const reason = usedPorts.has(port)
                ? "already allocated in this session"
                : "in use by another process";
            console.log(
                `[PortUtils] Port ${port} for ${envVar} is ${reason}, trying ${port + 1}`,
            );
            port++;
            // Safety limit to avoid infinite loop
            if (port > defaultPort + 1000) {
                throw new Error(
                    `Could not find available port for ${envVar} starting from ${defaultPort}`,
                );
            }
        }

        if (port !== defaultPort) {
            console.log(
                `[PortUtils] Allocated port ${port} for ${envVar} (default was ${defaultPort})`,
            );
        }

        allocatedPorts[envVar] = port;
        usedPorts.add(port);
    }

    return allocatedPorts;
}

