import { z } from "zod";

export const ServiceConfigSchema = z
	.object({
		name: z.string().describe("Service name (e.g. 'App', 'API')"),
		// Support both 'envKey' and 'envVar' for backward compatibility
		envKey: z
			.string()
			.optional()
			.describe("Environment variable key for the port (e.g. 'PORT')"),
		envVar: z.string().optional().describe("Alias for envKey"),
		// Support both 'default' and 'port' for backward compatibility
		default: z.number().optional().describe("Default port number preference"),
		port: z.number().optional().describe("Alias for default port"),
		argument: z
			.string()
			.optional()
			.describe(
				"CLI argument flag to override port (e.g. '--port', '--api-port')",
			),
		ui: z
			.boolean()
			.default(false)
			.describe("Whether this service has a UI to open"),
	})
	.transform((data) => {
		// Normalize field names
		const envKey = data.envKey ?? data.envVar;
		const defaultPort = data.default ?? data.port;

		if (!envKey) {
			throw new Error("Service must have 'envKey' or 'envVar' defined");
		}
		if (defaultPort === undefined) {
			throw new Error("Service must have 'default' or 'port' defined");
		}

		return {
			name: data.name,
			envKey,
			default: defaultPort,
			argument: data.argument,
			ui: data.ui,
		};
	});

export const LaunchActionSchema = z.object({
	type: z.enum([
		"open_browser",
		"launch_process",
		"download_artifact",
		"interactive_log",
	]),
	targetService: z
		.string()
		.optional()
		.describe("Name of the service to target (e.g. for opening browser)"),
});

export const InteractionConfigSchema = z.object({
	method: z.enum(["stdin", "args"]),
});

export const AgentConfigSchema = z.object({
	name: z.string().optional(),
	// 'web' opens browser, 'process' and 'other' are for non-web apps
	type: z.enum(["web", "process", "other"]),
	startCommand: z.string(),
	services: z.array(ServiceConfigSchema).default([]),
	action: LaunchActionSchema.optional(),
	interaction: InteractionConfigSchema.optional(),
	readiness: z
		.object({
			logPattern: z.string().optional(),
			timeout: z.number().optional(),
		})
		.optional(),
});

export type AgentConfigJson = z.infer<typeof AgentConfigSchema>;
export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;
export type LaunchAction = z.infer<typeof LaunchActionSchema>;
