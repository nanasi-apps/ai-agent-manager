import type { SessionEvent } from "@agent-manager/shared";
import { BrowserWindow } from "electron";
import { unifiedAgentManager } from "../../application/sessions";
import { store } from "../store/file-store";

export function setupAgentLogs() {
	// Agent Log Setup - forward logs to renderer
	unifiedAgentManager.on("session-event", (event: SessionEvent) => {
		// Adapt to legacy string format for Store and Legacy UI
		let content = "";
		let role: "system" | "agent" | "user" = "agent";
		let logType = "text";
		let raw: unknown;

		switch (event.type) {
			case "log":
				content = event.payload.data;
				logType = event.payload.type || "text";
				role = logType === "system" ? "system" : "agent";
				raw = event.payload.raw;
				break;
			case "tool-call":
				content = `\n[Tool: ${event.payload.toolName}]\n${JSON.stringify(event.payload.arguments, null, 2)}\n`;
				logType = "tool_call";
				break;
			case "tool-result": {
				const res = event.payload.result;
				const text =
					typeof res === "string" ? res : JSON.stringify(res, null, 2);
				content = `[Result]\n${text}\n`;
				logType = "tool_result";
				break;
			}
			case "thinking":
				content = `[Thinking] ${event.payload.content}\n`;
				logType = "thinking";
				break;
			case "error":
				content = `[Error] ${event.payload.message}\n`;
				logType = "error";
				raw = event.payload.details;
				break;
			case "session-lifecycle":
				// Usually treated as system log or ignored in content
				if (event.payload.action === "started") {
					content = `[Session started]\n`;
					logType = "system";
					role = "system";
				} else if (event.payload.action === "stopped") {
					content = `\n[Generation stopped by user]\n`;
					logType = "system";
					role = "system";
				}
				break;
		}

		// Save agent message to store for persistence (requires string content)
		if (content) {
			store.addMessage(event.sessionId, {
				id: event.id,
				role,
				content,
				timestamp: new Date(event.timestamp).getTime(),
				logType: logType as any,
			});
		}

		BrowserWindow.getAllWindows().forEach((win) => {
			// Emit typed event (replaces legacy agent-log)
			win.webContents.send("agent-event", event);
		});
	});
}
