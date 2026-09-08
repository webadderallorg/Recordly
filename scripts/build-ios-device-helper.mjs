import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (process.platform !== "darwin") {
	console.log("[ios-helper] SKIPPED: native builds require macOS.");
	process.exit(0);
}
const root = process.cwd();
const packagePath = path.join(root, "electron/native/ios-device-capture");
const checkout = createHash("sha256").update(root).digest("hex").slice(0, 12);
const cache = path.join(os.tmpdir(), `recordly-ios-module-cache-${checkout}`);
function run(command, args) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		env: {
			...process.env,
			CLANG_MODULE_CACHE_PATH: cache,
			SWIFTPM_MODULECACHE_OVERRIDE: cache,
		},
	});
	if (result.status !== 0)
		throw new Error(
			result.error?.message ??
				([result.stderr, result.stdout].filter(Boolean).join("\n") || `${command} failed`),
		);
	return result.stdout.trim();
}
for (const [arch, tag] of [
	["arm64", "darwin-arm64"],
	["x86_64", "darwin-x64"],
]) {
	const scratch = path.join(os.tmpdir(), `recordly-ios-build-${checkout}-${arch}`);
	const args = [
		"build",
		"--disable-sandbox",
		"--package-path",
		packagePath,
		"--scratch-path",
		scratch,
		"-c",
		"release",
		"--triple",
		`${arch}-apple-macosx14.0`,
		"--product",
		"recordly-ios-device-helper",
		"-Xlinker",
		"-sectcreate",
		"-Xlinker",
		"__TEXT",
		"-Xlinker",
		"__info_plist",
		"-Xlinker",
		path.join(packagePath, "Resources/Info.plist"),
	];
	console.log(`[ios-helper] Building ${tag}`);
	run("swift", args);
	const binPath = run("swift", [
		"build",
		"--disable-sandbox",
		"--package-path",
		packagePath,
		"--scratch-path",
		scratch,
		"-c",
		"release",
		"--triple",
		`${arch}-apple-macosx14.0`,
		"--show-bin-path",
	]);
	const directory = path.join(root, "electron/native/bin", tag);
	await mkdir(directory, { recursive: true });
	const binary = path.join(directory, "recordly-ios-device-helper");
	await copyFile(path.join(binPath, "recordly-ios-device-helper"), binary);
	await chmod(binary, 0o755);
	if (run("lipo", ["-archs", binary]) !== arch)
		throw new Error(`Architecture mismatch for ${tag}`);
	const info = run("vtool", ["-show-build", binary]);
	if (!/minos\s+14\.0(?:\.0)?\b/.test(info))
		throw new Error(`Deployment target mismatch for ${tag}`);
	const plist = run("otool", ["-s", "__TEXT", "__info_plist", binary]);
	if (!plist.includes("__info_plist"))
		throw new Error(`Missing embedded privacy metadata for ${tag}`);
	console.log(
		`[ios-helper] Staged ${tag} (compile evidence; signing and physical acceptance not established)`,
	);
}
