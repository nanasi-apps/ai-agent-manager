import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
	plugins: [vue(), tailwindcss()],
	resolve: {
		alias: {
			"@agent-manager/ui": "../ui/src/index.ts",
			"@agent-manager/shared": "../shared/src/index.ts",
		},
	},
	server: {
		port: 5173,
		strictPort: true,
	},
});
