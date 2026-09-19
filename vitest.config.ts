import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: [
			"src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
			"electron/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
			"scripts/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
		],
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
});
