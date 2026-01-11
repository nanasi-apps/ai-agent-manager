/**
 * Electron API Router - oRPC procedures for Electron-specific functionality
 *
 * This router provides type-safe RPC for features that were previously
 * exposed via contextBridge.exposeInMainWorld.
 *
 * Key features:
 * - Theme management (get/set dark mode)
 * - Branch name prompting (list, submit, generate)
 * - Agent event subscriptions (session events, state changes)
 *
 * All procedures use the port interfaces, allowing the electron package
 * to provide the actual implementations.
 */

import { eventIterator, os } from "@orpc/server";
import { z } from "zod";
import type { SessionEvent } from "../contracts/events";
import type { BranchNameEvent, ThemeChangeEvent } from "../ports";
import type { AgentStatePayload } from "../types/agent";
import type { RouterContext } from "./createRouter";

// Zod schemas for output validation
const themeChangeEventSchema = z.object({
	isDark: z.boolean(),
});

const branchNameRequestSchema = z.object({
	id: z.string(),
	repoPath: z.string(),
	projectId: z.string().optional(),
	sessionId: z.string().optional(),
	suggestedBranch: z.string().optional(),
	summary: z.string().optional(),
	createdAt: z.number(),
	status: z.enum(["pending", "resolved", "cancelled"]),
});

const branchNameEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("request"),
		payload: branchNameRequestSchema,
	}),
	z.object({
		type: z.literal("open"),
		payload: z.object({ requestId: z.string() }),
	}),
	z.object({
		type: z.literal("resolved"),
		payload: z.object({
			requestId: z.string(),
			branchName: z.string().optional(),
			cancelled: z.boolean().optional(),
		}),
	}),
]);

const operationResultSchema = z.object({
	success: z.boolean(),
	error: z.string().optional(),
	request: branchNameRequestSchema.optional(),
	suggestion: z.string().optional(),
});



/**
 * Creates the Electron API router with theme, branchName, and agent procedures
 */
export function createElectronApiRouter(ctx: RouterContext) {
	return {
		electron: os.router({
			// ============================================================
			// Theme Management
			// ============================================================
			theme: os.router({
				/**
				 * Get the current theme (dark/light)
				 */
				get: os.output(z.boolean()).handler(async () => {
					if (!ctx.themeService) {
						return false; // Default to light theme in non-Electron context
					}
					return ctx.themeService.isDark();
				}),

				/**
				 * Set the theme source
				 */
				set: os
					.input(z.enum(["system", "light", "dark"]))
					.output(z.boolean())
					.handler(async ({ input }) => {
						if (!ctx.themeService) {
							return false;
						}
						return ctx.themeService.setSource(input);
					}),

				/**
				 * Subscribe to theme changes via event iterator
				 */
				subscribe: os
					.output(eventIterator(themeChangeEventSchema))
					.handler(async function* ({ signal }) {
						if (!ctx.themeService) {
							return;
						}

						let unsubscribe = () => { };
						const stream = new ReadableStream<ThemeChangeEvent>({
							start(controller) {
								unsubscribe = ctx.themeService!.subscribe((event) => {
									controller.enqueue(event);
								});
							},
							cancel() {
								unsubscribe();
							},
						});

						if (signal) {
							signal.addEventListener("abort", () => unsubscribe());
						}

						const reader = stream.getReader();
						try {
							while (true) {
								const { done, value } = await reader.read();
								if (done) break;
								yield value;
							}
						} finally {
							reader.releaseLock();
						}
					}),
			}),

			// ============================================================
			// Branch Name Management
			// ============================================================
			branchName: os.router({
				/**
				 * List all pending branch name requests
				 */
				list: os.output(z.array(branchNameRequestSchema)).handler(async () => {
					if (!ctx.branchNameService) {
						return [];
					}
					return ctx.branchNameService.listPending();
				}),

				/**
				 * Submit a branch name for a request
				 */
				submit: os
					.input(
						z.object({
							requestId: z.string(),
							branchName: z.string(),
						}),
					)
					.output(operationResultSchema)
					.handler(async ({ input }) => {
						if (!ctx.branchNameService) {
							return { success: false, error: "Not in Electron context" };
						}
						return ctx.branchNameService.submitBranchName(
							input.requestId,
							input.branchName,
						);
					}),

				/**
				 * Generate a branch name suggestion
				 */
				generate: os
					.input(z.object({ requestId: z.string() }))
					.output(operationResultSchema)
					.handler(async ({ input }) => {
						if (!ctx.branchNameService) {
							return { success: false, error: "Not in Electron context" };
						}
						return ctx.branchNameService.generateSuggestion(input.requestId);
					}),

				/**
				 * Subscribe to branch name events via event iterator
				 */
				subscribe: os
					.output(eventIterator(branchNameEventSchema))
					.handler(async function* ({ signal }) {
						if (!ctx.branchNameService) {
							return;
						}

						let unsubscribe = () => { };
						const stream = new ReadableStream<BranchNameEvent>({
							start(controller) {
								unsubscribe = ctx.branchNameService!.subscribe((event) => {
									controller.enqueue(event);
								});
							},
							cancel() {
								unsubscribe();
							},
						});

						if (signal) {
							signal.addEventListener("abort", () => unsubscribe());
						}

						const reader = stream.getReader();
						try {
							while (true) {
								const { done, value } = await reader.read();
								if (done) break;
								yield value as z.infer<typeof branchNameEventSchema>;
							}
						} finally {
							reader.releaseLock();
						}
					}),
			}),

			// ============================================================
			// Agent Event Subscriptions
			// ============================================================
			agent: os.router({
				/**
				 * Subscribe to session events
				 */
				subscribeEvents: os
					.input(z.object({ sessionId: z.string().optional() }))
					.handler(async function* ({ input, signal }) {
						if (!ctx.agentEventService) {
							return;
						}

						let unsubscribe = () => { };
						const stream = new ReadableStream<SessionEvent>({
							start(controller) {
								unsubscribe = ctx.agentEventService!.subscribeEvents(
									(event) => {
										controller.enqueue(event);
									},
									input.sessionId,
								);
							},
							cancel() {
								unsubscribe();
							},
						});

						if (signal) {
							signal.addEventListener("abort", () => unsubscribe());
						}

						const reader = stream.getReader();
						try {
							while (true) {
								const { done, value } = await reader.read();
								if (done) break;
								yield value;
							}
						} finally {
							reader.releaseLock();
						}
					}),

				/**
				 * Subscribe to agent state changes
				 */
				subscribeState: os
					.input(z.object({ sessionId: z.string().optional() }))
					.handler(async function* ({ input, signal }) {
						if (!ctx.agentEventService) {
							return;
						}

						let unsubscribe = () => { };
						const stream = new ReadableStream<AgentStatePayload>({
							start(controller) {
								unsubscribe = ctx.agentEventService!.subscribeState(
									(event) => {
										controller.enqueue(event);
									},
									input.sessionId,
								);
							},
							cancel() {
								unsubscribe();
							},
						});

						if (signal) {
							signal.addEventListener("abort", () => unsubscribe());
						}

						const reader = stream.getReader();
						try {
							while (true) {
								const { done, value } = await reader.read();
								if (done) break;
								yield value;
							}
						} finally {
							reader.releaseLock();
						}
					}),
			}),
		}),
	};
}
