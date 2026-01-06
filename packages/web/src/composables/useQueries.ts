import { useQuery } from "@tanstack/vue-query";
import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { orpcQuery } from "@/services/orpc";

/**
 * Hook to fetch and cache model templates
 * Use this in components that need the model template list
 */
export function useModelTemplates() {
	return useQuery(
		orpcQuery.listModelTemplates.queryOptions({
			input: {},
			staleTime: 5 * 60 * 1000, // 5 minutes
			gcTime: 30 * 60 * 1000, // 30 minutes
		}),
	);
}

/**
 * Hook to fetch and cache the list of projects
 */
export function useProjects() {
	return useQuery(
		orpcQuery.listProjects.queryOptions({
			input: {},
			staleTime: 30 * 1000, // 30 seconds
		}),
	);
}

/**
 * Hook to fetch and cache all conversations
 */
export function useConversations() {
	return useQuery(
		orpcQuery.listConversations.queryOptions({
			input: {},
			staleTime: 10 * 1000, // 10 seconds - conversations update frequently
		}),
	);
}

/**
 * Hook to fetch a single conversation's messages
 */
export function useConversationMessages(sessionId: MaybeRefOrGetter<string>) {
	return useQuery(
		computed(() =>
			orpcQuery.getMessages.queryOptions({
				input: { sessionId: toValue(sessionId) },
				enabled: toValue(sessionId) !== "new" && !!toValue(sessionId),
				staleTime: 0, // Always refetch messages when needed
			}),
		),
	);
}

/**
 * Hook to fetch a single conversation's metadata
 */
export function useConversation(sessionId: MaybeRefOrGetter<string>) {
	return useQuery(
		computed(() =>
			orpcQuery.getConversation.queryOptions({
				input: { sessionId: toValue(sessionId) },
				enabled: toValue(sessionId) !== "new" && !!toValue(sessionId),
				staleTime: 5000,
			}),
		),
	);
}

/**
 * Hook to check if an agent is currently running
 */
export function useIsAgentRunning(sessionId: MaybeRefOrGetter<string>) {
	return useQuery(
		computed(() =>
			orpcQuery.isAgentRunning.queryOptions({
				input: { sessionId: toValue(sessionId) },
				enabled: toValue(sessionId) !== "new" && !!toValue(sessionId),
				staleTime: 0,
				refetchInterval: 5000, // Poll every 5 seconds
			}),
		),
	);
}

/**
 * Hook to fetch approvals list
 */
export function useApprovals() {
	return useQuery(
		orpcQuery.listApprovals.queryOptions({
			input: {},
			staleTime: 30 * 1000, // 30 seconds
		}),
	);
}
