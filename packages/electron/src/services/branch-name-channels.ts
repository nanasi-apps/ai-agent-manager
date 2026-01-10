import { ipcMain } from "electron";
import { branchNamePromptService } from "../services/branch-name-service";

export function setupBranchNameChannels() {
	ipcMain.handle("branch-name:list", async () => {
		return branchNamePromptService.listPending();
	});

	ipcMain.handle(
		"branch-name:submit",
		async (_event, payload: { requestId?: string; branchName?: string }) => {
			if (!payload?.requestId || !payload?.branchName) {
				return {
					success: false,
					error: "requestId and branchName are required",
				};
			}
			try {
				const resolved = branchNamePromptService.submitBranchName(
					payload.requestId,
					payload.branchName,
				);
				return { success: true, request: resolved };
			} catch (error: any) {
				return { success: false, error: error?.message || String(error) };
			}
		},
	);

	ipcMain.handle(
		"branch-name:generate",
		async (_event, payload: { requestId?: string }) => {
			if (!payload?.requestId) {
				return { success: false, error: "requestId is required" };
			}
			try {
				const suggestion = await branchNamePromptService.generateSuggestion(
					payload.requestId,
				);
				return { success: true, suggestion };
			} catch (error: any) {
				return { success: false, error: error?.message || String(error) };
			}
		},
	);
}
