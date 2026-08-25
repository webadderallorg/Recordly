import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	assertWebcamSegmentationAssets,
	getWebcamSegmentationPackageDirectory,
	WEBCAM_SEGMENTATION_ASSET_FILES,
} from "../../webcamSegmentationAssets";

describe("webcam segmentation package assets", () => {
	it("contains every runtime file emitted by the build", () => {
		const packageDirectory = getWebcamSegmentationPackageDirectory();
		expect(() => assertWebcamSegmentationAssets(packageDirectory)).not.toThrow();
		for (const fileName of WEBCAM_SEGMENTATION_ASSET_FILES) {
			expect(fs.statSync(path.join(packageDirectory, fileName)).isFile()).toBe(true);
		}
	});
});
