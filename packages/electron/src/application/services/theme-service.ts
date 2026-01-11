import { EventEmitter } from "node:events";
import type {
	IThemeService,
	ThemeChangeEvent,
	ThemeSource,
} from "@agent-manager/shared";
import { nativeTheme } from "electron";

export class ThemeServiceAdapter implements IThemeService {
	private emitter = new EventEmitter();

	constructor() {
		nativeTheme.on("updated", () => {
			this.emitter.emit("change", { isDark: nativeTheme.shouldUseDarkColors });
		});
	}

	isDark(): boolean {
		return nativeTheme.shouldUseDarkColors;
	}

	setSource(source: ThemeSource): boolean {
		nativeTheme.themeSource = source;
		return nativeTheme.shouldUseDarkColors;
	}

	subscribe(callback: (event: ThemeChangeEvent) => void): () => void {
		const handler = (event: ThemeChangeEvent) => callback(event);
		this.emitter.on("change", handler);
		return () => {
			this.emitter.off("change", handler);
		};
	}
}
