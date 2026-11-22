import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { prepareDistributionNotices } from "../scripts/prepare-distribution-notices.mjs";

const require = createRequire(import.meta.url);
const JSON5 = require("json5");
const storeConfiguration = require("../electron-builder.store.cjs");
const root = fileURLToPath(new URL("../", import.meta.url));
const directories = [];

async function put(directory, name, content) {
	const file = path.join(directory, name);
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, content);
}

async function fixture() {
	const directory = await mkdtemp(path.join(os.tmpdir(), "recordly-notices-"));
	directories.push(directory);
	for (const name of [
		"LICENSE.md",
		"THIRD_PARTY_NOTICES.md",
		"build/legal",
		"src/assets/cursors/community",
		"src/assets/cursors/pixel-glove",
		"src/assets/fonts/dm-sans",
		"src/assets/fonts/tiktok-sans",
		"src/assets/liquid-glass",
	]) {
		await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
		await cp(path.join(root, name), path.join(directory, name), { recursive: true });
	}
	await put(
		directory,
		"package.json",
		JSON.stringify({
			name: "fixture",
			version: "2.0.0",
			dependencies: { "demo-runtime": "1.0.0" },
			devDependencies: {
				"@scope/renderer": "1.0.0",
				"@scope/styles": "1.0.0",
				"test-only": "1.0.0",
			},
		}),
	);
	await put(
		directory,
		"node_modules/demo-runtime/package.json",
		JSON.stringify({
			name: "demo-runtime",
			version: "1.0.0",
			license: "MIT",
			dependencies: { "nested-runtime": "1.0.0" },
		}),
	);
	await put(
		directory,
		"node_modules/demo-runtime/LICENSE",
		"Runtime attribution\nMIT license fixture\n",
	);
	await put(
		directory,
		"node_modules/demo-runtime/node_modules/nested-runtime/package.json",
		JSON.stringify({ name: "nested-runtime", version: "1.0.0", license: "BSD-3-Clause" }),
	);
	await put(
		directory,
		"node_modules/demo-runtime/node_modules/nested-runtime/NOTICE",
		"Nested runtime attribution\n",
	);
	await put(
		directory,
		"node_modules/@scope/renderer/package.json",
		JSON.stringify({ name: "@scope/renderer", version: "1.0.0", license: "Apache-2.0" }),
	);
	await put(directory, "node_modules/@scope/renderer/LICENSE", "Renderer license fixture\n");
	await put(
		directory,
		"node_modules/@scope/styles/package.json",
		JSON.stringify({ name: "@scope/styles", version: "1.0.0", license: "MIT" }),
	);
	await put(
		directory,
		"build/legal/packages/@scope__styles@1.0.0/LICENSE",
		"Styles license fixture\n",
	);
	await put(
		directory,
		"build/legal/packages/@scope__styles@1.0.0/PROVENANCE.json",
		'{"licenseUrl":"https://example.invalid/pinned/LICENSE"}\n',
	);
	await put(
		directory,
		"src/entry.tsx",
		'import { renderer } from "@scope/renderer/submodule";\n',
	);
	await put(directory, "src/style.css", '@import "@scope/styles";\n');
	await put(directory, "src/ignored.test.ts", 'import "test-only";\n');
	for (const extension of [".distribution.json", ".LICENSE", ".README"]) {
		await put(directory, `node_modules/ffmpeg-static/ffmpeg${extension}`, "FFmpeg fixture\n");
		await put(
			directory,
			`node_modules/ffmpeg-static/ffmpeg.exe${extension}`,
			"FFmpeg fixture\n",
		);
		await put(
			directory,
			`node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe${extension}`,
			"FFprobe fixture\n",
		);
	}
	await put(
		directory,
		"node_modules/ffmpeg-static/ffmpeg.sources/source.tar.xz",
		"Source archive fixture\n",
	);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("desktop distribution notices", () => {
	it("includes editable cursor source, full licenses, font notices and native dependency notices", async () => {
		const projectDir = await fixture();
		const { outputDir, manifest } = await prepareDistributionNotices({
			projectDir,
			platform: "darwin",
			arch: "arm64",
		});
		expect(outputDir).toBe(path.join(projectDir, ".tmp/distribution-notices/mac-arm64"));
		for (const [source, target] of [
			["LICENSE.md", "LICENSE.md"],
			["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
			[
				"src/assets/cursors/community/bee/arrow.svg",
				"assets/cursors/community/bee/arrow.svg",
			],
			[
				"src/assets/cursors/community/catppuccin-pink/AUTHORS",
				"assets/cursors/community/catppuccin-pink/AUTHORS",
			],
			["src/assets/cursors/pixel-glove/COPYING", "assets/cursors/pixel-glove/COPYING"],
			[
				"src/assets/cursors/pixel-glove/LICENSE.GPL",
				"assets/cursors/pixel-glove/LICENSE.GPL",
			],
			["src/assets/cursors/pixel-glove/arrow.svg", "assets/cursors/pixel-glove/arrow.svg"],
			["src/assets/fonts/dm-sans/OFL.txt", "assets/fonts/dm-sans/OFL.txt"],
			["src/assets/fonts/tiktok-sans/OFL.txt", "assets/fonts/tiktok-sans/OFL.txt"],
			[
				"build/legal/onnxruntime/ThirdPartyNotices.txt",
				"native/onnxruntime/ThirdPartyNotices.txt",
			],
			[
				"node_modules/ffmpeg-static/ffmpeg.sources/source.tar.xz",
				"ffmpeg/sources/source.tar.xz",
			],
		])
			expect(await readFile(path.join(outputDir, target))).toEqual(
				await readFile(path.join(projectDir, source)),
			);
		expect(manifest.packages.map((pkg) => pkg.name)).toEqual([
			"@scope/renderer",
			"@scope/styles",
			"demo-runtime",
			"nested-runtime",
		]);
		const runtime = manifest.packages.find((pkg) => pkg.name === "demo-runtime");
		expect(
			await readFile(path.join(outputDir, runtime.noticeDirectory, "LICENSE"), "utf8"),
		).toContain("Runtime attribution");
		const styles = manifest.packages.find((pkg) => pkg.name === "@scope/styles");
		expect(
			await readFile(
				path.join(outputDir, styles.noticeDirectory, "upstream/LICENSE"),
				"utf8",
			),
		).toContain("Styles license fixture");
		expect(styles.legalFiles).toContain("upstream/LICENSE");
		expect(JSON.stringify(manifest)).not.toContain(projectDir);
		expect(await readFile(path.join(outputDir, "SOURCE_CODE.txt"), "utf8")).toContain(
			"not the complete source for this binary",
		);
	});

	it("fails instead of producing a package with a missing cursor GPL notice", async () => {
		const projectDir = await fixture();
		await rm(path.join(projectDir, "src/assets/cursors/pixel-glove/LICENSE.GPL"));
		await expect(
			prepareDistributionNotices({ projectDir, platform: "darwin", arch: "arm64" }),
		).rejects.toThrow(
			"Missing required distribution notice: src/assets/cursors/pixel-glove/LICENSE.GPL",
		);
	});

	it("includes the Windows FFprobe distribution provenance alongside the separately packaged executable", async () => {
		const projectDir = await fixture();
		const { outputDir } = await prepareDistributionNotices({
			projectDir,
			platform: "win32",
			arch: "x64",
		});
		for (const extension of [".distribution.json", ".LICENSE", ".README"]) {
			expect(
				await readFile(path.join(outputDir, "ffprobe", `ffprobe${extension}`), "utf8"),
			).toBe("FFprobe fixture\n");
		}
	});

	it("fails when a declared runtime dependency is unavailable for notice collection", async () => {
		const projectDir = await fixture();
		await rm(path.join(projectDir, "node_modules/demo-runtime"), { recursive: true });
		await expect(
			prepareDistributionNotices({ projectDir, platform: "darwin", arch: "arm64" }),
		).rejects.toThrow("demo-runtime is not installed");
	});

	it("runs notice preparation and adds an external license resource in desktop and Store configurations", async () => {
		const base = JSON5.parse(await readFile(path.join(root, "electron-builder.json5"), "utf8"));
		const store = storeConfiguration(undefined, {
			RECORDLY_STORE_IDENTITY_NAME: "12345.TestRecordly",
			RECORDLY_STORE_PUBLISHER: "CN=00000000-0000-0000-0000-000000000000",
			RECORDLY_STORE_PUBLISHER_DISPLAY_NAME: "Test",
			RECORDLY_STORE_VERSION: "2.0.1",
		});
		for (const config of [base, store]) {
			expect(config.beforePack).toBe("./scripts/prepare-distribution-notices.mjs");
			expect(config.extraResources).toContainEqual({
				from: ".tmp/distribution-notices/${os}-${arch}",
				to: "licenses",
				filter: ["**/*"],
			});
		}
	});
});
