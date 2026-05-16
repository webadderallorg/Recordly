import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	build: {
		target: "esnext",
		rollupOptions: {
			output: {
				manualChunks: {
					three: ["three", "@react-three/fiber", "@react-three/drei"],
					theatre: ["@theatre/core", "@theatre/r3f"],
					"react-vendor": ["react", "react-dom"],
				},
			},
		},
	},
});
