/**
 * INativeDialog - Port interface for native OS dialogs
 *
 * This interface defines the contract for native file/directory selection dialogs.
 * In Electron, this is implemented using electron.dialog.
 * In web/browser contexts, this might be null or use browser file pickers.
 */

export interface INativeDialog {
    selectDirectory(): Promise<string | null>;

    selectPaths(options: {
        type: "file" | "dir" | "any";
        multiple?: boolean;
    }): Promise<string[]>;
}
