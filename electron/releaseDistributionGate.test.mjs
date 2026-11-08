import * as fs from "node:fs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

// js-yaml is included by the repository's existing Electron build toolchain.
const { load } = createRequire(import.meta.url)("js-yaml");
const workflow = load(
	readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
);

function matchingStep(steps, command) {
	return steps.findIndex((step) => step.run?.includes(command));
}

describe("macOS published distribution gate", () => {
	for (const arch of ["x64", "arm64"]) {
		it(`requires verified signing and notarization before ${arch} artifacts reach publication`, () => {
			const jobName = `build-macos-${arch}`;
			const job = workflow.jobs[jobName];
			const steps = job.steps;
			const build = matchingStep(steps, "electron-builder --mac");
			const verify = matchingStep(steps, "npm run verify:macos-distribution");
			const checksums = matchingStep(steps, "npm run checksums:release");
			const upload = steps.findIndex((step) => step.with?.name === `macos-${arch}-release`);

			expect(build).toBeGreaterThan(-1);
			expect(steps[build].run).toContain("-c.mac.forceCodeSigning=true");
			expect(steps[build].run).toContain("-c.mac.notarize=true");
			expect(steps[build].run).toContain("--publish never");
			expect(verify).toBeGreaterThan(build);
			expect(verify).toBeLessThan(checksums);
			expect(verify).toBeLessThan(upload);
			expect(steps[verify].if).toBeUndefined();
			expect(steps[verify]["continue-on-error"]).not.toBe(true);
			expect(steps[verify].run).toContain(`--arch ${arch}`);
			expect(steps[verify].run).toContain('--team-id "$APPLE_TEAM_ID"');
			expect(job.env.APPLE_TEAM_ID).toContain("secrets.APPLE_TEAM_ID");
			expect(steps[upload].with.path).toContain(
				`release/macos-distribution-report-${arch}.json`,
			);

			const publish = workflow.jobs["publish-release-assets"];
			expect(publish.needs).toContain(jobName);
			expect(publish.if).toContain(`needs.${jobName}.result == 'success'`);
		});
	}
});

const smokeSource = readFileSync(
	new URL("../scripts/smoke-packaged-binaries.mjs", import.meta.url),
	"utf8",
);
const smokeProgram = ts.transpileModule(smokeSource, {
	compilerOptions: {
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.ES2022,
		esModuleInterop: true,
	},
}).outputText;
const smokeDirectories = [];

afterEach(() => {
	for (const directory of smokeDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

function smokeFixture(platform = "darwin") {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "recordly-packaged-smoke-"));
	smokeDirectories.push(directory);
	fs.writeFileSync(
		path.join(directory, "package.json"),
		JSON.stringify({ name: "recordly", productName: "Recordly" }),
	);
	return {
		directory,
		addArtifact(arch, packages, libraries) {
			const app = path.join(
				directory,
				`artifact-${arch}`,
				...(platform === "darwin" ? ["Recordly.app", "Contents"] : []),
			);
			const resources = path.join(app, platform === "darwin" ? "Resources" : "resources");
			const unpacked = path.join(resources, "app.asar.unpacked");
			const put = (file, value = "fixture") => {
				fs.mkdirSync(path.dirname(file), { recursive: true });
				fs.writeFileSync(file, value, { mode: 0o755 });
			};
			put(
				path.join(
					app,
					...(platform === "darwin"
						? ["MacOS", "Recordly"]
						: [platform === "win32" ? "Recordly.exe" : "recordly"]),
				),
			);
			put(
				path.join(resources, "licenses", "manifest.json"),
				JSON.stringify({ platform, arch }),
			);
			put(
				path.join(
					unpacked,
					"node_modules",
					"ffmpeg-static",
					platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
				),
			);
			for (const name of packages) {
				const module = path.join(unpacked, "node_modules", name);
				put(path.join(module, "sherpa-onnx.node"));
				for (const library of libraries) put(path.join(module, library));
			}
			const helperNames =
				platform === "darwin"
					? [
							"recordly-permission-drag-helper",
							"recordly-screencapturekit-helper",
							"recordly-window-list",
							"recordly-system-cursors",
							"recordly-native-cursor-monitor",
							"whisper-cli",
							"whisper-runtime.json",
						]
					: platform === "win32"
						? [
								"wgc-capture.exe",
								"cursor-monitor.exe",
								"recordly-gpu-export.exe",
								"helpers-manifest.json",
								"whisper-cli.exe",
								"whisper-runtime.json",
								"recordly-nvidia-cuda-compositor.exe",
							]
						: ["whisper-cli", "whisper-runtime.json"];
			for (const helperArch of ["arm64", "x64"]) {
				for (const helper of helperNames)
					put(
						path.join(
							unpacked,
							"electron",
							"native",
							"bin",
							`${platform}-${helperArch}`,
							helper,
						),
					);
			}
		},
		run() {
			const messages = [];
			runInNewContext(smokeProgram, {
				exports: {},
				require(name) {
					if (name === "node:fs") return fs;
					if (name === "node:path") return path;
					if (name === "node:child_process")
						return { execFileSync: () => "ffmpeg version fixture\n" };
					if (name === "./verify-distribution-notices.mjs")
						return {
							verifyPackagedDistributionNotices: (resources) =>
								JSON.parse(
									fs.readFileSync(
										path.join(resources, "licenses", "manifest.json"),
										"utf8",
									),
								),
						};
					throw new Error(`Unexpected smoke dependency: ${name}`);
				},
				process: {
					cwd: () => directory,
					platform,
					arch: "arm64",
					env: { RECORDLY_RELEASE_DIR: directory },
				},
				console: { log: (message) => messages.push(message) },
			});
			return messages;
		},
	};
}

describe("packaged caption runtime validation", () => {
	it("checks each macOS artifact's target package when both architectures share an output directory", () => {
		const fixture = smokeFixture();
		for (const arch of ["arm64", "x64"])
			fixture.addArtifact(
				arch,
				[`sherpa-onnx-darwin-${arch}`],
				["libonnxruntime.dylib", "libsherpa-onnx-c-api.dylib"],
			);
		expect(fixture.run().at(-1)).toContain("packaged binary path smoke passed");
	});

	it("rejects a macOS x64 artifact containing only the build host's arm64 caption package", () => {
		const fixture = smokeFixture();
		fixture.addArtifact(
			"arm64",
			["sherpa-onnx-darwin-arm64"],
			["libonnxruntime.dylib", "libsherpa-onnx-c-api.dylib"],
		);
		fixture.addArtifact(
			"x64",
			["sherpa-onnx-darwin-arm64"],
			["libonnxruntime.dylib", "libsherpa-onnx-c-api.dylib"],
		);
		expect(() => fixture.run()).toThrow(/Parakeet.*missing/);
	});

	for (const [platform, packageName, core, api, provider] of [
		[
			"win32",
			"sherpa-onnx-win-arm64",
			"onnxruntime.dll",
			"sherpa-onnx-c-api.dll",
			"onnxruntime_providers_shared.dll",
		],
		[
			"darwin",
			"sherpa-onnx-darwin-arm64",
			"libonnxruntime.1.23.2.dylib",
			"libsherpa-onnx-c-api.dylib",
			"libonnxruntime_providers_shared.dylib",
		],
		[
			"linux",
			"sherpa-onnx-linux-arm64",
			"libonnxruntime.so.1.23.2",
			"libsherpa-onnx-c-api.so",
			"libonnxruntime_providers_shared.so",
		],
	]) {
		it(`rejects a ${platform} provider library when the core ONNX Runtime library is missing`, () => {
			const fixture = smokeFixture(platform);
			fixture.addArtifact("arm64", [packageName], [provider, api]);
			expect(() => fixture.run()).toThrow(/Parakeet library onnxruntime is missing/);
		});
		it(`accepts the ${platform} core library with a provider library beside it`, () => {
			const fixture = smokeFixture(platform);
			fixture.addArtifact("arm64", [packageName], [provider, core, api]);
			expect(fixture.run().at(-1)).toContain("packaged binary path smoke passed");
		});
	}
});
