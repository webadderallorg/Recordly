import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import {
	ensureSwiftHelperBinary,
	getSystemCursorHelperBinaryPath,
	getSystemCursorHelperSourcePath,
} from "../../paths/binaries";
import {
	cachedSystemCursorAssets,
	cachedSystemCursorAssetsSourceMtimeMs,
	setCachedSystemCursorAssets,
	setCachedSystemCursorAssetsSourceMtimeMs,
} from "../../state";

const execFileAsync = promisify(execFile);

export async function getSystemCursorAssets() {
	if (process.platform !== "darwin") {
		setCachedSystemCursorAssets({});
		setCachedSystemCursorAssetsSourceMtimeMs(null);
		return cachedSystemCursorAssets ?? {};
	}
	const sourcePath = getSystemCursorHelperSourcePath();
	const sourceStat = await fs.stat(sourcePath);
	if (cachedSystemCursorAssets && cachedSystemCursorAssetsSourceMtimeMs === sourceStat.mtimeMs) {
		return cachedSystemCursorAssets;
	}
	const binaryPath = await ensureSwiftHelperBinary(
		sourcePath,
		getSystemCursorHelperBinaryPath(),
		"system cursor helper",
		"recordly-system-cursors",
	);
	const { stdout } = await execFileAsync(binaryPath, [], {
		timeout: 15000,
		maxBuffer: 20 * 1024 * 1024,
	});
	const parsed = JSON.parse(stdout) as Record<
		string,
		Partial<import("../../types").SystemCursorAsset>
	>;
	const result = Object.fromEntries(
		Object.entries(parsed).filter(
			([, asset]) =>
				typeof asset?.dataUrl === "string" &&
				typeof asset?.hotspotX === "number" &&
				typeof asset?.hotspotY === "number" &&
				typeof asset?.width === "number" &&
				typeof asset?.height === "number",
		),
	) as Record<string, import("../../types").SystemCursorAsset>;
	setCachedSystemCursorAssets(result);
	setCachedSystemCursorAssetsSourceMtimeMs(sourceStat.mtimeMs);
	return result;
}
