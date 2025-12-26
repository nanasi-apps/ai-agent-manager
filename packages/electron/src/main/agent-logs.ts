import { BrowserWindow } from "electron";
import { oneShotAgentManager } from "../agents";
import { store } from "../store";
import * as crypto from "node:crypto";

export function setupAgentLogs() {
    // Agent Log Setup - forward logs to renderer
    oneShotAgentManager.on("log", (data) => {
        // Save agent message to store for persistence
        if (data.data) {
            store.addMessage(data.sessionId, {
                id: crypto.randomUUID(),
                role: data.type === 'system' ? 'system' : 'agent',
                content: data.data,
                timestamp: Date.now(),
                logType: data.type,
            });
        }

        BrowserWindow.getAllWindows().forEach((win) => {
            win.webContents.send("agent-log", data);
        });
    });
}
