import { appRouter } from "@agent-manager/shared";
import { RPCHandler } from "@orpc/server/message-port";
import { ipcMain } from "electron";

export function setupIpc() {
    // Setup ORPC handler
    ipcMain.on("start-orpc-server", (event) => {
        const [serverPort] = event.ports;
        if (serverPort) {
            console.log("Main: Received ORPC port");
            const handler = new RPCHandler(appRouter);
            handler.upgrade(serverPort);
            serverPort.start();
        }
    });
}
