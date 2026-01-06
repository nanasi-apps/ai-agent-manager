import type { BranchNameRequest } from "@agent-manager/shared";
import { defineStore } from "pinia";
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

	const hasElectron = computed(
		() => typeof window !== "undefined" && !!window.electronAPI,
	);

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
		if (!hasElectron.value) return;
		try {
			const pending = await window.electronAPI?.listBranchNameRequests();
			pending.forEach((req) => upsertRequest(req));
			if (pending.length > 0) {
				open(pending[0]?.id);
			}
		} catch (error) {
			console.error("Failed to load pending branch name requests", error);
		}
	}

	async function submit() {
		if (!hasElectron.value || !activeRequest.value) return;
		errorMessage.value = null;
		isSubmitting.value = true;
		try {
			const result = await window.electronAPI?.submitBranchName(
				activeRequest.value.id,
				inputValue.value.trim(),
			);
			if (!result?.success) {
				throw new Error(result?.error || "Failed to submit branch name");
			}
			removeRequest(activeRequest.value.id);
			close();
		} catch (error: any) {
			console.error("Failed to submit branch name", error);
			errorMessage.value = error?.message || "Failed to submit branch name";
		} finally {
			isSubmitting.value = false;
		}
	}

	async function generateSuggestion() {
		if (!hasElectron.value || !activeRequest.value) return;
		errorMessage.value = null;
		generationState.value =
			generationState.value === "idle" ? "generating" : "regenerating";
		try {
			const result = await window.electronAPI?.generateBranchName(
				activeRequest.value.id,
			);
			if (!result?.success || !result.suggestion) {
				throw new Error(result?.error || "Failed to generate branch name");
			}
			inputValue.value = result.suggestion;
			generationState.value = "ready";
		} catch (error: any) {
			console.error("Failed to generate branch name", error);
			errorMessage.value =
				error?.message || "Failed to generate branch name suggestion";
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

	function setupListeners() {
		if (!hasElectron.value || listenersReady.value) return;
		listenersReady.value = true;

		void syncPending();

		window.electronAPI?.onBranchNameRequest((req) => {
			upsertRequest(req);
			open(req.id);
		});

		window.electronAPI?.onBranchNameOpen(({ requestId }) => {
			if (requestId) {
				open(requestId);
			}
		});

		window.electronAPI?.onBranchNameResolved((payload) => {
			markResolved(payload);
		});
	}

	return {
		activeRequest,
		activeRequestId,
		canSubmit,
		errorMessage,
		generationState,
		hasElectron,
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
