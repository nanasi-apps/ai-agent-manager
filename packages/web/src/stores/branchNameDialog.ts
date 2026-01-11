import { type BranchNameRequest } from "@agent-manager/shared";
import { defineStore } from "pinia";
import { orpc } from "@/services/orpc";
import { computed, ref } from "vue";

type GenerationState = "idle" | "generating" | "regenerating" | "ready";

export const useBranchNameDialogStore = defineStore("branchNameDialog", () => {
	const requests = ref<Map<string, BranchNameRequest>>(new Map());
	const activeRequestId = ref<string | null>(null);
	const isOpen = ref(false);
	const inputValue = ref("");
	const errorMessage = ref<string | null>(null);
	const isSubmitting = ref(false);
	const generationState = ref<GenerationState>("idle");
	const listenersReady = ref(false);

	const activeRequest = computed(() =>
		activeRequestId.value
			? (requests.value.get(activeRequestId.value) ?? null)
			: null,
	);

	// Check minimal Electron flag


	const isGenerating = computed(
		() =>
			generationState.value === "generating" ||
			generationState.value === "regenerating",
	);

	const canSubmit = computed(
		() =>
			!!activeRequest.value &&
			!!inputValue.value.trim() &&
			!isSubmitting.value &&
			!isGenerating.value,
	);

	function upsertRequest(
		request: BranchNameRequest,
		openDialog: boolean = false,
	) {
		requests.value.set(request.id, request);
		if (!activeRequestId.value) {
			activeRequestId.value = request.id;
		}
		if (openDialog) {
			open(request.id);
		}
	}

	function removeRequest(requestId: string) {
		requests.value.delete(requestId);
		if (activeRequestId.value === requestId) {
			activeRequestId.value = requests.value.keys().next().value ?? null;
		}
		if (!activeRequestId.value) {
			close();
		}
	}

	function open(requestId?: string) {
		const targetId =
			requestId ??
			activeRequestId.value ??
			requests.value.keys().next().value ??
			null;
		if (!targetId) return;
		const didChange = activeRequestId.value !== targetId;
		activeRequestId.value = targetId;
		if (didChange) {
			const target = requests.value.get(targetId);
			inputValue.value = target?.suggestedBranch ?? "";
			generationState.value = "idle";
			errorMessage.value = null;
		}
		isOpen.value = true;
	}

	function close() {
		isOpen.value = false;
		errorMessage.value = null;
		isSubmitting.value = false;
		generationState.value = "idle";
	}

	async function syncPending() {
		try {
			// Dynamic import
			const pending = await orpc.electron.branchName.list();
			if (pending) {
				for (const req of pending) {
					upsertRequest(req);
				}
				if (pending.length > 0) {
					open(pending[0]?.id);
				}
			}
		} catch (error) {
			console.error("Failed to load pending branch name requests", error);
		}
	}

	async function submit() {
		if (!activeRequest.value) return;
		errorMessage.value = null;
		isSubmitting.value = true;
		try {
			const result = await orpc.electron.branchName.submit({
				requestId: activeRequest.value.id,
				branchName: inputValue.value.trim(),
			});
			if (!result?.success) {
				throw new Error(result?.error || "Failed to submit branch name");
			}
			removeRequest(activeRequest.value.id);
			close();
		} catch (error: unknown) {
			console.error("Failed to submit branch name", error);
			errorMessage.value =
				error instanceof Error ? error.message : "Failed to submit branch name";
		} finally {
			isSubmitting.value = false;
		}
	}

	async function generateSuggestion() {
		if (!activeRequest.value) return;
		errorMessage.value = null;
		generationState.value =
			generationState.value === "idle" ? "generating" : "regenerating";
		try {
			const result = await orpc.electron.branchName.generate({
				requestId: activeRequest.value.id,
			});
			if (!result?.success || !result.suggestion) {
				throw new Error(result?.error || "Failed to generate branch name");
			}
			inputValue.value = result.suggestion;
			generationState.value = "ready";
		} catch (error: unknown) {
			console.error("Failed to generate branch name", error);
			errorMessage.value =
				error instanceof Error
					? error.message
					: "Failed to generate branch name suggestion";
			generationState.value = "idle";
		}
	}

	function markResolved(payload: {
		requestId: string;
		branchName?: string;
		cancelled?: boolean;
	}) {
		removeRequest(payload.requestId);
		if (payload.cancelled) {
			errorMessage.value = "Branch name request was cancelled.";
		}
	}

	async function setupListeners() {
		if (listenersReady.value) return;
		listenersReady.value = true;

		try {
			// Sync existing pending requests
			await syncPending();

			// Subscribe to events
			const iterator = await orpc.electron.branchName.subscribe();

			// Process events in background
			(async () => {
				try {
					for await (const event of iterator) {
						if (event.type === "request") {
							upsertRequest(event.payload);
							open(event.payload.id);
						} else if (event.type === "open") {
							if (event.payload.requestId) {
								open(event.payload.requestId);
							}
						} else if (event.type === "resolved") {
							markResolved(event.payload);
						}
					}
				} catch (err) {
					console.error("Branch name event subscription error:", err);
				}
			})();
		} catch (err) {
			console.error("Failed to setup branch name listeners:", err);
		}
	}

	return {
		activeRequest,
		activeRequestId,
		canSubmit,
		errorMessage,
		generationState,
		inputValue,
		isGenerating,
		isOpen,
		isSubmitting,
		close,
		generateSuggestion,
		open,
		setupListeners,
		submit,
		syncPending,
	};
});
