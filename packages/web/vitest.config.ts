/// <reference types="vitest" />

import path from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [vue()],
	test: {
		globals: true,
		environment: "jsdom",
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
});
