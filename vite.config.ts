import type { ChildProcess } from "node:child_process";
import { spawnSync } from "node:child_process";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { treeKillSync } from "vite-plugin-electron";
import electron from "vite-plugin-electron/simple";
import {
	createElectronDevLifecycle,
	type ElectronDevQueue,
} from "./scripts/electronDevProcessLifecycle";
import { prepareElectronDevRuntime } from "./scripts/electronDevRuntime";

function electronMainCjsOutputPlugin(): Plugin {
	return {
		name: "recordly-electron-main-cjs-output",
		enforce: "post",
		config(config) {
			// Vite mergeConfig concatenates lib.formats with the plugin's ESM default.
			config.build ??= {};
			const build = config.build;
			const lib = build.lib;
			if (lib && typeof lib === "object") {
				lib.formats = ["cjs"];
				lib.fileName = (_format, entryName) => `${entryName}.cjs`;
			}

			build.rollupOptions ??= {};
			const rollupOptions = build.rollupOptions;
			const cjsOutput = {
				format: "cjs" as const,
				inlineDynamicImports: true,
				entryFileNames: "[name].cjs",
				chunkFileNames: "[name]-[hash].cjs",
			};

			rollupOptions.output = Array.isArray(rollupOptions.output)
				? rollupOptions.output.map((output) => ({ ...output, ...cjsOutput }))
				: { ...(rollupOptions.output ?? {}), ...cjsOutput };
		},
	};
}

function electronMainCjsGuardPlugin(): Plugin {
	return {
		name: "recordly-electron-main-cjs-guard",
		closeBundle() {
			const scriptPath = path.resolve(__dirname, "scripts/smoke-electron-main-cjs.mjs");
			const result = spawnSync(process.execPath, [scriptPath], {
				cwd: __dirname,
				encoding: "utf8",
			});

			if (result.status !== 0) {
				const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
				throw new Error(
					`Electron main CJS smoke failed after Vite build.${details ? `\n${details}` : ""}`,
				);
			}
		},
	};
}

// https://vitejs.dev/config/
const electronHost = process as NodeJS.Process & {
	electronApp?: ChildProcess;
	recordlyElectronDevQueue?: ElectronDevQueue;
};
electronHost.recordlyElectronDevQueue ??= { pending: Promise.resolve() };
const lifecycle = createElectronDevLifecycle(
	{
		getProcess: () => electronHost.electronApp,
		clearProcess: (child) => {
			if (electronHost.electronApp === child) electronHost.electronApp = undefined;
		},
		stopProcessTree: treeKillSync,
	},
	electronHost.recordlyElectronDevQueue,
);

export default defineConfig(({ mode }) => ({
	// Renderer-only UI tests must not invalidate a running Electron dev server.
	cacheDir: process.env.RECORDLY_VITE_CACHE_DIR
		? path.resolve(__dirname, process.env.RECORDLY_VITE_CACHE_DIR)
		: path.join(
				__dirname,
				"node_modules",
				mode === "ui" || process.env.RECORDLY_RENDERER_ONLY === "1" ? ".vite-ui" : ".vite",
			),
	// Keep browser scenarios stable while other workers edit the shared checkout.
	server: process.env.RECORDLY_UI_TEST_RUN === "1" ? { hmr: false, watch: null } : undefined,
	plugins: [
		react(),
		...(mode === "ui" || process.env.RECORDLY_RENDERER_ONLY === "1"
			? []
			: [
					electron({
						main: {
							onstart({ startup }) {
								void lifecycle
									.mainBuilt(async () => {
										prepareElectronDevRuntime(__dirname);
										await startup();
									})
									.catch((error) =>
										console.error(
											"[Recordly dev] Electron restart failed:",
											error,
										),
									);
							},
							// Shortcut of `build.lib.entry`.
							entry: "electron/main.ts",
							vite: {
								build: {
									lib: {
										entry: "electron/main.ts",
										formats: ["cjs"],
										fileName: (_format, entryName) => `${entryName}.cjs`,
									},
									rollupOptions: {
										external: [
											"ffmpeg-static",
											"uiohook-napi",
											"sherpa-onnx-node",
										],
										output: {
											format: "cjs",
											inlineDynamicImports: true,
											entryFileNames: "[name].cjs",
											chunkFileNames: "[name]-[hash].cjs",
										},
									},
								},
								plugins: [
									electronMainCjsOutputPlugin(),
									electronMainCjsGuardPlugin(),
								],
							},
						},
						preload: {
							onstart({ startup, reload }) {
								void lifecycle
									.preloadBuilt(async () => {
										prepareElectronDevRuntime(__dirname);
										await startup();
									})
									.then(reload)
									.catch((error) =>
										console.error(
											"[Recordly dev] Electron preload reload failed:",
											error,
										),
									);
							},
							// Shortcut of `build.rollupOptions.input`.
							// Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
							input: path.join(__dirname, "electron/preload.ts"),
							vite: {
								build: {
									rollupOptions: {
										// Sandboxed Electron loads this CommonJS preload as .js;
										// .mjs is treated as an unsupported ES module preload.
										output: {
											entryFileNames: "[name].js",
											chunkFileNames: "[name].js",
										},
									},
								},
							},
						},
						// Polyfill the Electron and Node.js API for the renderer process.
						// If you want to use Node.js in the renderer process, enable `nodeIntegration` in the main process.
						// See https://github.com/electron-vite/vite-plugin-electron-renderer
						renderer:
							process.env.NODE_ENV === "test"
								? // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
									undefined
								: {},
					}),
				]),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	optimizeDeps: {
		entries: ["index.html"],
		// Prebundle the lazy timeline before React mounts. Discovering it later can
		// replace shared React chunks while an editor is already using the old ones.
		include: ["use-sync-external-store/shim", "dnd-timeline"],
		exclude: [
			"react-icons/bs",
			"react-icons/fa",
			"react-icons/fa6",
			"react-icons/fi",
			"react-icons/md",
			"react-icons/rx",
		],
	},
	build: {
		target: "esnext",
		minify: "terser",
		terserOptions: {
			compress: {
				// Keep warnings/errors available to the user-triggered support log collector.
				drop_console: ["log", "debug", "info"],
				drop_debugger: true,
				pure_funcs: ["console.log", "console.debug"],
			},
		},
		rollupOptions: {
			output: {
				manualChunks: {
					"react-vendor": ["react", "react-dom"],
					"video-processing": ["mediabunny", "mp4box", "@fix-webm-duration/fix"],
				},
			},
		},
		chunkSizeWarningLimit: 1000,
	},
}));
