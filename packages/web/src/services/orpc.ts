import type {AppRouter} from "@agent-manager/shared";
import {createORPCClient} from "@orpc/client";
import {RPCLink} from "@orpc/client/message-port";
import type {ContractRouterClient} from "@orpc/contract";

// Initialize the ORPC client
export const createClient = () => {
    // Determine transport
    // In Electron, we create a MessageChannel and send one port to the main process
    const channel = new MessageChannel();
    const port1 = channel.port1;
    const port2 = channel.port2;

    // Send port2 to Electron via window.postMessage (handled in preload)
    // Check if we are in Electron by checking for window.electronAPI or similar indicator if needed,
    // or just try posting the message. Preload will ignore if it's not set up?
    // Actually preload is always there in Electron.
    if (window.electronAPI) {
        console.log("Web: Connecting to Electron via ORPC (window.postMessage)...");
        window.postMessage("start-orpc-client", "*", [port2]);
    } else {
        console.warn("Web: ORPC connection skipped (not in Electron)");
    }

    // Create the client using port1
    port1.start();
    const link = new RPCLink({
        port: port1,
    });

	return createORPCClient<ContractRouterClient<AppRouter>>(link);
};

export const orpc = createClient();
