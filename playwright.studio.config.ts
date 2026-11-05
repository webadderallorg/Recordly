import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "./tests/studio",
	outputDir: ".tmp/studio-test-results",
	timeout: 60000,
	workers: 1,
	use: {
		baseURL: "http://127.0.0.1:3000",
		viewport: { width: 1600, height: 1100 },
		trace: "retain-on-failure",
	},
	webServer: {
		command: "npm run announcement-studio",
		url: "http://127.0.0.1:3000/announcement-studio.html",
		reuseExistingServer: true,
	},
});
