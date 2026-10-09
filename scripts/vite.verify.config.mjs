/**
 * Isolated Vite config for the render verification harness.
 *
 * The project's own vite.config.ts loads the Electron plugin chain, which
 * builds and watches dist-electron. That is unnecessary for serving these
 * modules, so the harness uses this minimal config instead — with the same "@"
 * alias the app uses, so imports resolve exactly as the editor's do.
 */
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

export default defineConfig({
	root: projectRoot,
	plugins: [react()],
	resolve: {
		alias: {
			"@": path.join(projectRoot, "src"),
		},
	},
	server: {
		port: 5199,
		strictPort: true,
		host: "127.0.0.1",
	},
});