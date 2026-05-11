import { describe, expect, it } from "vitest";
import {
	findElectronMainCjsEsmSyntax,
	normalizeElectronMainCjsSource,
} from "../scripts/normalize-electron-main-cjs.mjs";

describe("Electron main CJS normalizer", () => {
	it("converts Rollup named export blocks to CommonJS assignments", () => {
		const source = [
			'const MAIN_DIST = "dist-electron";',
			'const RENDERER_DIST = "dist";',
			"const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;",
			"export {",
			"  MAIN_DIST,",
			"  RENDERER_DIST,",
			"  VITE_DEV_SERVER_URL",
			"};",
		].join("\n");

		const result = normalizeElectronMainCjsSource(source);

		expect(result.changed).toBe(true);
		expect(result.source).toContain("exports.MAIN_DIST = MAIN_DIST;");
		expect(result.source).toContain("exports.RENDERER_DIST = RENDERER_DIST;");
		expect(result.source).toContain("exports.VITE_DEV_SERVER_URL = VITE_DEV_SERVER_URL;");
		expect(findElectronMainCjsEsmSyntax(result.source)).toEqual([]);
	});

	it("converts single-line aliased named exports to CommonJS assignments", () => {
		const source = "export { VITE_DEV_SERVER_URL as devServerUrl };";

		const result = normalizeElectronMainCjsSource(source);

		expect(result.changed).toBe(true);
		expect(result.source).toBe("exports.devServerUrl = VITE_DEV_SERVER_URL;");
		expect(findElectronMainCjsEsmSyntax(result.source)).toEqual([]);
	});

	it("reports unsupported ESM export syntax that cannot be normalized safely", () => {
		const source = "export default MAIN_DIST;";

		expect(findElectronMainCjsEsmSyntax(source)).toEqual([
			{ line: 1, text: "export default MAIN_DIST;" },
		]);
	});

	it("preserves an unsupported export block exactly while normalizing other syntax", () => {
		const source = [
			'import fs from "node:fs";',
			"export {",
			'  MAIN_DIST as "main-dist",',
			"};",
		].join("\n");

		const result = normalizeElectronMainCjsSource(source);

		expect(result.changed).toBe(true);
		expect(result.source).toBe(
			[
				'const fs = require("node:fs");',
				"export {",
				'  MAIN_DIST as "main-dist",',
				"};",
			].join("\n"),
		);
		expect(findElectronMainCjsEsmSyntax(result.source)).toEqual([
			{ line: 2, text: "export {" },
		]);
	});
});
