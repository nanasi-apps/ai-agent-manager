import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import VueRouter from "unplugin-vue-router/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
	base: command === "build" ? "./" : "/",
	plugins: [
		VueRouter({
			routesFolder: "src/pages",
		}),
		vue(),
		tailwindcss(),
	],
	server: {
		port: Number(process.env.WEB_PORT) || 5173,
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
}));
