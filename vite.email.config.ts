import { defineConfig } from "vite";

// Separate from Electron so email edits do not restart the running desktop app.
export default defineConfig({
	server: { host: "127.0.0.1", port: 3500, strictPort: true, open: false },
	optimizeDeps: { entries: ["email-preview.html"] },
	plugins: [
		{
			name: "email-preview-entry",
			configureServer(server) {
				server.middlewares.use((req, _res, next) => {
					if (req.url === "/") req.url = "/email-preview.html";
					next();
				});
			},
		},
	],
});
