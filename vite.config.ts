import { spawnSync } from "node:child_process";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import electron from "vite-plugin-electron/simple";

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
export default defineConfig({
	plugins: [
		react(),
		electron({
			main: {
				// Shortcut of `build.lib.entry`.
				entry: "electron/main.ts",
				vite: {
					build: {
						lib: {
							entry: "electron/main.ts",
							formats: ["cjs"],
						},
						rollupOptions: {
							external: ["ffmpeg-static", "uiohook-napi"],
							output: {
								format: "cjs",
								entryFileNames: "[name].cjs",
								chunkFileNames: "[name].cjs",
							},
						},
					},
					plugins: [electronMainCjsGuardPlugin()],
				},
			},
			preload: {
				// Shortcut of `build.rollupOptions.input`.
				// Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
				input: path.join(__dirname, "electron/preload.ts"),
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
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	optimizeDeps: {
		entries: ["index.html"],
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
				drop_console: true,
				drop_debugger: true,
				pure_funcs: ["console.log", "console.debug"],
			},
		},
		rollupOptions: {
			output: {
				manualChunks: {
					pixi: ["pixi.js"],
					"react-vendor": ["react", "react-dom"],
					"video-processing": ["mediabunny", "mp4box", "@fix-webm-duration/fix"],
				},
			},
		},
		chunkSizeWarningLimit: 1000,
	},
});
