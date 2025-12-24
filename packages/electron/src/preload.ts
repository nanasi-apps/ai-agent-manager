import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
    ping: () => ipcRenderer.invoke("ping"),
});

window.addEventListener("message", (event) => {
    if (event.data === "start-orpc-client") {
        console.log("Preload: Received start-orpc-client message, forwarding to Main...");
        const [serverPort] = event.ports;
        ipcRenderer.postMessage("start-orpc-server", null, [serverPort]);
    }
});
