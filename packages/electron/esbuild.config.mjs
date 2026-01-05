import esbuild from "esbuild";

const commonConfig = {
	bundle: true,
	platform: "node",
	target: "node20",
	outdir: "dist",
	external: [
		"electron",
		"node-pty",
		"*.node",
	],
	minify: true,
	minifyWhitespace: true,
	minifyIdentifiers: true,
	minifySyntax: true,
	treeShaking: true,
	legalComments: "none",
	drop: ["console", "debugger"],
};

// Build Main Process (CJS)
await esbuild.build({
	...commonConfig,
	entryPoints: ["src/main.ts"],
	format: "cjs",
});

// Build Preload Script (CJS)
await esbuild.build({
	...commonConfig,
	entryPoints: ["src/preload.ts"],
	format: "cjs",
});
