import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

export const WEBCAM_SEGMENTATION_ASSET_PATH = "webcam-segmentation";
export const WEBCAM_SEGMENTATION_ASSET_FILES = [
	"selfie_segmentation.js",
	"selfie_segmentation.binarypb",
	"selfie_segmentation.tflite",
	"selfie_segmentation_landscape.tflite",
	"selfie_segmentation_solution_simd_wasm_bin.data",
	"selfie_segmentation_solution_simd_wasm_bin.js",
	"selfie_segmentation_solution_simd_wasm_bin.wasm",
	"selfie_segmentation_solution_wasm_bin.js",
	"selfie_segmentation_solution_wasm_bin.wasm",
] as const;

const require = createRequire(import.meta.url);

export function getWebcamSegmentationPackageDirectory(): string {
	return path.dirname(require.resolve("@mediapipe/selfie_segmentation/package.json"));
}

export function assertWebcamSegmentationAssets(packageDirectory: string): void {
	const missing = WEBCAM_SEGMENTATION_ASSET_FILES.filter(
		(fileName) => !fs.existsSync(path.join(packageDirectory, fileName)),
	);
	if (missing.length > 0) {
		throw new Error(`Missing MediaPipe webcam segmentation assets: ${missing.join(", ")}`);
	}
}

function contentTypeForAsset(fileName: string): string {
	if (fileName.endsWith(".js")) return "text/javascript; charset=utf-8";
	if (fileName.endsWith(".wasm")) return "application/wasm";
	return "application/octet-stream";
}

export function webcamSegmentationAssetsPlugin(): Plugin {
	const packageDirectory = getWebcamSegmentationPackageDirectory();
	assertWebcamSegmentationAssets(packageDirectory);

	return {
		name: "recordly-webcam-segmentation-assets",
		configureServer(server) {
			const prefix = `/${WEBCAM_SEGMENTATION_ASSET_PATH}/`;
			server.middlewares.use((request, response, next) => {
				const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
				if (!requestUrl.pathname.startsWith(prefix)) {
					next();
					return;
				}

				const fileName = decodeURIComponent(requestUrl.pathname.slice(prefix.length));
				if (!(WEBCAM_SEGMENTATION_ASSET_FILES as readonly string[]).includes(fileName)) {
					response.statusCode = 404;
					response.end("Not Found");
					return;
				}

				response.statusCode = 200;
				response.setHeader("Content-Type", contentTypeForAsset(fileName));
				fs.createReadStream(path.join(packageDirectory, fileName)).pipe(response);
			});
		},
		generateBundle() {
			for (const fileName of WEBCAM_SEGMENTATION_ASSET_FILES) {
				this.emitFile({
					type: "asset",
					fileName: `${WEBCAM_SEGMENTATION_ASSET_PATH}/${fileName}`,
					source: fs.readFileSync(path.join(packageDirectory, fileName)),
				});
			}
		},
	};
}
