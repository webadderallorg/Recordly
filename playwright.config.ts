import { defineConfig } from "@playwright/test";

const port = Number(process.env.RECORDLY_UI_PORT ?? "5179");
if (!Number.isInteger(port) || port < 1 || port > 65535)
	throw new Error("RECORDLY_UI_PORT must be an integer between 1 and 65535.");
const baseURL = `http://127.0.0.1:${port}`;
const authPort = Number(process.env.RECORDLY_UI_AUTH_PORT ?? String(port + 1));
if (!Number.isInteger(authPort) || authPort < 1 || authPort > 65535 || authPort === port)
	throw new Error("RECORDLY_UI_AUTH_PORT must be a distinct port between 1 and 65535.");

function rendererServer(serverPort: number, production: boolean) {
	return {
		env: {
			NODE_ENV: production ? "production" : "development",
			RECORDLY_RENDERER_ONLY: "1",
			RECORDLY_UI_TEST_RUN: "1",
			RECORDLY_VITE_CACHE_DIR: `node_modules/.vite-ui-${serverPort}`,
			VITE_SUPABASE_URL: "https://auth.recordly.test",
			VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ui_test",
		},
		command: `npx vite --host 127.0.0.1 --port ${serverPort} --strictPort`,
		url: `http://127.0.0.1:${serverPort}`,
		reuseExistingServer: false,
	};
}

export default defineConfig({
	testDir: "./tests/ui",
	outputDir: `test-results-ui-${port}`,
	timeout: 30000,
	use: {
		baseURL,
		viewport: { width: 1440, height: 1000 },
		trace: "retain-on-failure",
	},
	// Auth/permission recovery tests exercise production gates; design previews
	// use the normal development renderer. Neither starts Electron.
	webServer: [rendererServer(port, false), rendererServer(authPort, true)],
});
