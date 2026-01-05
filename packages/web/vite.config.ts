import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import VueRouter from "unplugin-vue-router/vite";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";
import cssnano from "cssnano";

export default defineConfig(({ command }) => ({
	base: command === "build" ? "./" : "/",
	css: {
		postcss: {
			plugins: [
				cssnano({
					preset: ["default", { discardComments: { removeAll: true } }],
				}),
			],
		},
	},
	plugins: [
		VueRouter({
			routesFolder: "src/pages",
		}),
		vue(),
		tailwindcss(),
		visualizer({
			filename: "dist/stats.html",
			open: false,
			gzipSize: true,
			brotliSize: true,
		}),
	],
	server: {
		port: Number(process.env.WEB_PORT) || 5173,
	},
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "./src"),
		},
	},
	esbuild: {
		drop: ["console", "debugger"],
		legalComments: "none",
		minifyIdentifiers: true,
		minifySyntax: true,
		minifyWhitespace: true,
		treeShaking: true,
	},
	build: {
		minify: "esbuild",
		rollupOptions: {
			output: {
				manualChunks: (id) => {
					if (id.includes("node_modules")) {
						// Vue core ecosystem
						if (id.includes("vue") || id.includes("@vue") || id.includes("pinia")) {
							return "vue-vendor";
						}
						// UI component library
						if (id.includes("reka-ui") || id.includes("radix-vue")) {
							return "ui-vendor";
						}
						// Icons
						if (id.includes("lucide")) {
							return "icons-vendor";
						}
						// Code highlighting
						if (id.includes("highlight.js")) {
							return "highlight-vendor";
						}
						// Markdown
						if (id.includes("marked")) {
							return "markdown-vendor";
						}
						// Data/Query utilities
						if (id.includes("@tanstack") || id.includes("@orpc")) {
							return "data-vendor";
						}
						// vueuseはutilsとして分離
						if (id.includes("@vueuse")) {
							return "utils-vendor";
						}
						// i18n
						if (id.includes("vue-i18n")) {
							return "i18n-vendor";
						}
						// Everything else
						return "vendor";
					}
				},
			},
		},
		cssMinify: false,
		target: "esnext",
		reportCompressedSize: true,
	},
}));
