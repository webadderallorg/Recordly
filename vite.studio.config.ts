import { randomUUID } from "node:crypto";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Local-only, bounded, ephemeral uploads. Nothing is written into public/ or the feed.
function studioMedia(): Plugin {
	const uploads = new Map<string, { data: Buffer; type: string }>();
	let storedBytes = 0;
	const cap = 100 * 1024 * 1024;
	return {
		name: "recordly-studio-media",
		configureServer(server) {
			server.middlewares.use((req, _res, next) => {
				if (req.url === "/") req.url = "/announcement-studio.html";
				next();
			});
			server.middlewares.use("/__studio/media", (req, res, next) => {
				if (req.method === "POST" && req.url === "/") {
					if (req.headers.origin !== `http://${req.headers.host}`) {
						res.writeHead(403).end();
						return;
					}
					const type = req.headers["content-type"] || "";
					if (
						!/^(image\/(png|jpeg|webp|gif|avif)|video\/(mp4|webm|quicktime))$/.test(
							type,
						)
					) {
						res.writeHead(415).end("Use an image or video.");
						return;
					}
					const chunks: Buffer[] = [];
					let size = 0;
					let rejected = false;
					req.on("data", (chunk: Buffer) => {
						size += chunk.length;
						if (size > 50 * 1024 * 1024 || storedBytes + size > cap) {
							if (!rejected)
								res.writeHead(413).end(
									"Upload limit reached. Restart the studio to clear temporary media.",
								);
							rejected = true;
							chunks.length = 0;
						} else if (!rejected) chunks.push(chunk);
					});
					req.on("end", () => {
						if (rejected) return;
						// Recheck the total in case another upload completed while this request streamed.
						if (storedBytes + size > cap) {
							res.writeHead(413).end("Temporary media limit reached.");
							return;
						}
						const id = randomUUID();
						uploads.set(id, { data: Buffer.concat(chunks), type });
						storedBytes += size;
						res.writeHead(200, { "Content-Type": "application/json" }).end(
							JSON.stringify({ url: `/__studio/media/${id}` }),
						);
					});
					return;
				}
				const item = uploads.get((req.url || "").slice(1));
				if (!item) {
					next();
					return;
				}
				if (req.method !== "GET" && req.method !== "HEAD") {
					res.writeHead(405).end();
					return;
				}
				const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
				const start = range ? Number(range[1]) : 0;
				const end =
					range && range[2]
						? Math.min(Number(range[2]), item.data.length - 1)
						: item.data.length - 1;
				if (start > end || start >= item.data.length) {
					res.writeHead(416, { "Content-Range": `bytes */${item.data.length}` }).end();
					return;
				}
				res.writeHead(range ? 206 : 200, {
					"Content-Type": item.type,
					"Content-Length": end - start + 1,
					"Accept-Ranges": "bytes",
					"Cache-Control": "no-store",
					"X-Content-Type-Options": "nosniff",
					...(range
						? { "Content-Range": `bytes ${start}-${end}/${item.data.length}` }
						: {}),
				});
				res.end(req.method === "HEAD" ? undefined : item.data.subarray(start, end + 1));
			});
		},
	};
}
export default defineConfig({
	plugins: [react(), studioMedia()],
	resolve: { alias: { "@": path.resolve(__dirname, "src") } },
	// This is an authoring tool sharing a checkout with active app development.
	// Source HMR steals focus and closes native menus on unrelated file changes.
	// Draft previews still update live through postMessage; source changes apply on reload.
	server: { host: "127.0.0.1", port: 3000, strictPort: true, open: false, hmr: false },
	optimizeDeps: {
		entries: ["announcement-studio.html", "announcement-preview.html"],
		include: ["use-sync-external-store/shim"],
	},
	build: {
		outDir: "dist-announcement-studio",
		rollupOptions: { input: ["announcement-studio.html", "announcement-preview.html"] },
	},
});
