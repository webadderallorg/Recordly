import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "./tests/ui",
	timeout: 30000,
	use: {
		baseURL: "http://127.0.0.1:5178",
		viewport: { width: 1440, height: 1000 },
		trace: "retain-on-failure",
	},
	webServer: {
		env: {
			RECORDLY_RENDERER_ONLY: "1",
			VITE_SUPABASE_URL: "https://auth.recordly.test",
			VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ui_test",
		},
		command: "npx vite --host 127.0.0.1 --port 5178 --strictPort",
		url: "http://127.0.0.1:5178",
		reuseExistingServer: false,
	},
});
