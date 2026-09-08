import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

if (process.platform !== "darwin") {
	console.log("[ios-native] SKIPPED: native tests require macOS.");
	process.exit(0);
}
const checkout = createHash("sha256").update(process.cwd()).digest("hex").slice(0, 12);
const cache = path.join(os.tmpdir(), `recordly-ios-module-cache-${checkout}`);
const result = spawnSync(
	"swift",
	[
		"test",
		"--disable-sandbox",
		"--package-path",
		"electron/native/ios-device-capture",
		"--scratch-path",
		path.join(os.tmpdir(), `recordly-ios-swift-tests-${checkout}`),
		...process.argv.slice(2),
	],
	{
		stdio: "inherit",
		env: {
			...process.env,
			CLANG_MODULE_CACHE_PATH: cache,
			SWIFTPM_MODULECACHE_OVERRIDE: cache,
		},
	},
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
