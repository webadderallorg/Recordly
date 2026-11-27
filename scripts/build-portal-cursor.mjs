import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();

if (process.platform !== "linux") {
	console.log("[build-portal-cursor] Skipping: host platform is not Linux.");
	process.exit(0);
}

const crateDir = path.join(projectRoot, "electron", "native", "portal-cursor");
const archTag = process.arch === "arm64" ? "linux-arm64" : "linux-x64";
const outputDir = path.join(projectRoot, "electron", "native", "bin", archTag);
const binaryName = "recordly-portal-cursor";
const target = path.join(outputDir, binaryName);
const required = process.env.CI === "true" || process.env.RECORDLY_PORTAL_CURSOR_REQUIRED === "1";

const installInstructions = [
	"Missing Rust/PipeWire/GStreamer build dependencies for recordly-portal-cursor.",
	"Install Rust (https://rustup.rs) and the Linux native build dependencies:",
	"  sudo apt-get install -y libpipewire-0.3-dev libspa-0.2-dev libclang-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev",
	"Then run the command again (or point PKG_CONFIG_PATH at a local sysroot).",
].join("\n");

const cargoCheck = spawnSync("cargo", ["--version"], { stdio: "ignore" });
const pkgConfigCheck = spawnSync(
	"pkg-config",
	["--exists", "libpipewire-0.3", "gstreamer-1.0", "gstreamer-app-1.0"],
	{ stdio: "ignore" },
);

if (cargoCheck.status !== 0 || pkgConfigCheck.status !== 0) {
	if (required) {
		throw new Error(installInstructions);
	}
	await rm(target, { force: true });
	console.warn(
		`[build-portal-cursor] ${installInstructions}\n[build-portal-cursor] Skipping portal-cursor build; Recordly will fall back to browser capture.`,
	);
	process.exit(0);
}

const build = spawnSync(
	"cargo",
	[
		"build",
		"--release",
		"--message-format=json-render-diagnostics",
		"--manifest-path",
		path.join(crateDir, "Cargo.toml"),
	],
	{ stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" },
);

if (build.status !== 0) {
	const details = build.error ? ` (${build.error.message})` : "";
	throw new Error(`Failed to build ${binaryName}${details}.\n${installInstructions}`);
}

let builtExecutable;
for (const line of (build.stdout ?? "").split(/\r?\n/)) {
	if (!line.startsWith("{")) continue;
	try {
		const message = JSON.parse(line);
		if (
			message?.reason === "compiler-artifact" &&
			message?.target?.name === binaryName &&
			typeof message?.executable === "string"
		) {
			builtExecutable = message.executable;
		}
	} catch {
		// Ignore non-JSON lines emitted by cargo or build scripts.
	}
}

await mkdir(outputDir, { recursive: true });
const source = builtExecutable ?? path.join(crateDir, "target", "release", binaryName);
await copyFile(source, target);
await chmod(target, 0o755);
console.log(`[build-portal-cursor] Staged ${binaryName} (${archTag}) -> ${target}`);
