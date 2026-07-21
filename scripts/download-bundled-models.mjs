#!/usr/bin/env node

/**
 * Download bundled caption-generation models into the project's `models/` directory.
 *
 * In development:
 *   The models live at <project>/models/<model-id>/<file>
 *   These are NOT tracked by git (.gitignore entry is added).
 *
 * In production (packaged app):
 *   electron-builder's `extraResources` copies models/ into the app bundle.
 *   Process.resourcesPath points there at runtime.
 */

import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { get as httpsGet } from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const MODELS_DIR = path.join(PROJECT_ROOT, "models");

const MODELS = [
	{
		id: "sensevoice-small",
		files: [
			{
				url: "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx",
				fileName: "model.int8.onnx",
				sizeBytes: 239_233_841,
			},
			{
				url: "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt",
				fileName: "tokens.txt",
				sizeBytes: 102_685,
			},
		],
	},
];

function downloadFile(url, destinationPath) {
	return new Promise((resolve, reject) => {
		const tryDownload = (currentUrl, remainingRedirects) => {
			if (remainingRedirects <= 0) {
				reject(new Error("Too many redirects."));
				return;
			}

			const req = httpsGet(currentUrl, (response) => {
				const statusCode = response.statusCode ?? 0;

				if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
					response.resume();
					const location = response.headers.location;
					// Handle relative redirects
					const nextUrl = location.startsWith("http")
						? location
						: new URL(location, currentUrl).href;
					tryDownload(nextUrl, remainingRedirects - 1);
					return;
				}

				if (statusCode !== 200) {
					response.resume();
					reject(new Error(`Download failed with status ${statusCode}: ${currentUrl}`));
					return;
				}

				const totalBytes = Number.parseInt(response.headers["content-length"] ?? "0", 10);
				let downloadedBytes = 0;
				const fileStream = createWriteStream(destinationPath);

				response.on("data", (chunk) => {
					downloadedBytes += chunk.length;
					if (totalBytes > 0) {
						const pct = Math.round((downloadedBytes / totalBytes) * 100);
						process.stdout.write(
							`\r  ${path.basename(destinationPath)}: ${pct}% (${(downloadedBytes / 1_000_000).toFixed(1)} / ${(totalBytes / 1_000_000).toFixed(1)} MB)`,
						);
					}
				});

				response.pipe(fileStream);
				fileStream.on("finish", () => {
					fileStream.close();
					console.log(`\r  ${path.basename(destinationPath)}: 100%`);
					resolve();
				});
				fileStream.on("error", reject);
				response.on("error", reject);
			});

			req.on("error", reject);
			req.setTimeout(120_000, () => {
				req.destroy(new Error("Download timed out."));
			});
		};

		tryDownload(url, 5);
	});
}

async function main() {
	console.log("[download-bundled-models]");

	for (const model of MODELS) {
		const modelDir = path.join(MODELS_DIR, model.id);
		await mkdir(modelDir, { recursive: true });

		const allExist = model.files.every((f) => {
			const fp = path.join(modelDir, f.fileName);
			return existsSync(fp);
		});

		if (allExist) {
			console.log(`  ${model.id}: already downloaded, skipping.`);
			continue;
		}

		console.log(`  ${model.id}: downloading...`);
		for (const file of model.files) {
			const dest = path.join(modelDir, file.fileName);
			if (existsSync(dest)) {
				console.log(`    ${file.fileName}: exists, skipping.`);
				continue;
			}
			const tempDest = `${dest}.download`;
			try {
				await downloadFile(file.url, tempDest);
				// Rename temp -> final
				await rm(tempDest, { force: true });
				await writeFile(tempDest, ""); // touch
				await rm(tempDest);
				// Re-download to proper path
				await downloadFile(file.url, dest);
			} catch (error) {
				await rm(tempDest, { force: true }).catch(() => undefined);
				console.error(`    FAILED: ${file.fileName} - ${error.message}`);
				// Don't fail the whole process, let the app download on demand
			}
		}
	}

	// Write a manifest so the app knows which models are bundled
	const manifest = MODELS.map((m) => ({
		id: m.id,
		files: m.files.map((f) => f.fileName),
	}));
	await writeFile(path.join(MODELS_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

	console.log("[download-bundled-models] Done.");
}

main().catch((error) => {
	// Don't fail the install if downloads fail — models can be fetched on demand
	console.error("[download-bundled-models] Warning: download failed:", error.message);
});
