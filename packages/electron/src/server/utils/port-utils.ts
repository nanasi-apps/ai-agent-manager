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
		// Use a random port from the start, as requested
		let port = await getPort();

		// Ensure we don't allocate the same port twice within this session
		while (usedPorts.has(port)) {
			port = await getPort();
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
