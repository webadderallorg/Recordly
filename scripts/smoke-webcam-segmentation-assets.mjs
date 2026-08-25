import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const assetDirectory = path.resolve("dist", "webcam-segmentation");
const expectedFiles = [
	"selfie_segmentation.js",
	"selfie_segmentation.binarypb",
	"selfie_segmentation.tflite",
	"selfie_segmentation_landscape.tflite",
	"selfie_segmentation_solution_simd_wasm_bin.data",
	"selfie_segmentation_solution_simd_wasm_bin.js",
	"selfie_segmentation_solution_simd_wasm_bin.wasm",
	"selfie_segmentation_solution_wasm_bin.js",
	"selfie_segmentation_solution_wasm_bin.wasm",
];

const missing = expectedFiles.filter(
	(fileName) => !fs.existsSync(path.join(assetDirectory, fileName)),
);
if (!fs.existsSync(path.resolve("dist", "THIRD_PARTY_NOTICES.txt"))) {
	missing.push("../THIRD_PARTY_NOTICES.txt");
}

if (missing.length > 0) {
	console.error(`Missing packaged webcam segmentation assets: ${missing.join(", ")}`);
	process.exit(1);
}

console.log(`Verified ${expectedFiles.length} webcam segmentation runtime assets and notices.`);
