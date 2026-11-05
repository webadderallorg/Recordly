import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const storeConfiguration = require("../electron-builder.store.cjs");
const { getConfig, validateConfiguration } = require("app-builder-lib/out/util/config/config");
const { DebugLogger, Arch } = require("builder-util");
const { AppInfo } = require("app-builder-lib/out/appInfo");
const AppxTarget = require("app-builder-lib/out/targets/AppxTarget").default;
const root = fileURLToPath(new URL("../", import.meta.url));
const identity = {
	RECORDLY_STORE_IDENTITY_NAME: "12345.TestRecordly",
	RECORDLY_STORE_PUBLISHER: "CN=00000000-0000-0000-0000-000000000000",
	RECORDLY_STORE_PUBLISHER_DISPLAY_NAME: "Test & Publisher",
	RECORDLY_STORE_VERSION: "2.0.1",
};

describe("Microsoft Store packaging", () => {
	afterEach(() => vi.unstubAllEnvs());
	it("requires an explicit reserved product identity and a valid Store version", () => {
		for (const name of Object.keys(identity)) {
			expect(() => storeConfiguration(undefined, { ...identity, [name]: "" })).toThrow(name);
		}
		for (const version of ["2.0.0-beta.1", "2.0.0.1", "0.1.0", "2.0.65536", "2.01.0"]) {
			expect(() =>
				storeConfiguration(undefined, { ...identity, RECORDLY_STORE_VERSION: version }),
			).toThrow("RECORDLY_STORE_VERSION");
		}
	});
	it("generates a valid full-trust manifest with auth activation and no direct updater", async () => {
		for (const [key, value] of Object.entries(identity)) vi.stubEnv(key, value);
		// Exercise the installed builder's config loader/merger and manifest writer,
		// without claiming this runs Windows MakeAppx or certification.
		const config = await getConfig(root, path.join(root, "electron-builder.store.cjs"), null);
		await validateConfiguration(config, new DebugLogger());
		expect(config.publish).toBeNull();
		expect(config.win.publish).toBeNull();
		expect(config.win.target).toEqual([{ target: "appx", arch: ["x64"] }]);
		expect(config.win.signExecutable).toBe(false);
		expect(config.appx.electronUpdaterAware).toBe(false);
		const metadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
		metadata.version = config.extraMetadata.version;
		metadata.author = { name: metadata.author };
		const info = { config, metadata, platform: { name: "win" } };
		const packager = {
			config,
			info,
			platformSpecificBuildOptions: config.win,
			appInfo: new AppInfo(info, undefined, config.win),
			getResource: async () => null,
		};
		// The constructor requires macOS/Windows even though manifest generation is portable.
		const target = Object.assign(Object.create(AppxTarget.prototype), {
			packager,
			options: { ...config.win, ...config.appx },
		});
		const directory = await mkdtemp(path.join(os.tmpdir(), "recordly-store-"));
		try {
			const assets = await readdir(path.join(root, "build/appx"));
			const file = path.join(directory, "AppxManifest.xml");
			await target.writeManifest(file, Arch.x64, config.appx.publisher, assets);
			const manifest = await readFile(file, "utf8");
			expect(manifest).toContain('Name="12345.TestRecordly"');
			expect(manifest).toContain('Version="2.0.1.0"');
			expect(manifest).toContain('MinVersion="10.0.19041.0"');
			expect(manifest).toContain(
				"<PublisherDisplayName>Test &amp; Publisher</PublisherDisplayName>",
			);
			expect(manifest).toContain('Id="Recordly" Executable="app\\Recordly.exe"');
			expect(manifest).toContain('EntryPoint="Windows.FullTrustApplication"');
			expect(manifest).toContain('<uap:Protocol Name="recordly">');
			for (const capability of ["runFullTrust", "microphone", "webcam"]) {
				expect(manifest).toContain(`Name="${capability}"`);
			}
			expect(manifest).not.toContain("${");
			for (const [name, width, height] of [
				["StoreLogo.png", 50, 50],
				["Square44x44Logo.png", 44, 44],
				["Square150x150Logo.png", 150, 150],
				["Wide310x150Logo.png", 310, 150],
			]) {
				const png = await readFile(path.join(root, "build/appx", name));
				expect(png.subarray(1, 4).toString()).toBe("PNG");
				expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([width, height]);
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
