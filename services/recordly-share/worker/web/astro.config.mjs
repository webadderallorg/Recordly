import { fileURLToPath } from "node:url";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { viewerContentSecurityPolicy } from "./scripts/viewer-content-security-policy.mjs";

export default defineConfig({
	output: "static",
	integrations: [react(), viewerContentSecurityPolicy()],
	vite: {
		plugins: [tailwindcss()],
		resolve: { dedupe: ["react", "react-dom", "@heroui/react", "@phosphor-icons/react"] },
		define: {
			__RECORDLY_PUBLIC_DIR__: JSON.stringify(
				fileURLToPath(new URL("../../../../public/", import.meta.url)),
			),
		},
	},
	build: {
		format: "file",
	},
});
