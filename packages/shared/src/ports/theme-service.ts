/**
 * Theme Service Port - Interface for native theme management
 *
 * This port defines the contract for theme-related operations.
 * Implementation lives in the electron package.
 */

/**
 * Theme change event
 */
export interface ThemeChangeEvent {
	isDark: boolean;
}

/**
 * Theme source options
 */
export type ThemeSource = "system" | "light" | "dark";

/**
 * Interface for theme management service
 */
export interface IThemeService {
	/**
	 * Get the current theme (dark/light)
	 */
	isDark(): boolean;

	/**
	 * Set the theme source
	 */
	setSource(source: ThemeSource): boolean;

	/**
	 * Subscribe to theme changes
	 * @returns Unsubscribe function
	 */
	subscribe(callback: (event: ThemeChangeEvent) => void): () => void;
}
