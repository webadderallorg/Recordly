import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const describeOnDarwin = process.platform === "darwin" ? describe : describe.skip;

function sliceRequired(source: string, startMarker: string, endMarker: string): string {
	const start = source.indexOf(startMarker);
	expect(start).toBeGreaterThanOrEqual(0);
	const end = source.indexOf(endMarker, start);
	expect(end).toBeGreaterThan(start);
	return source.slice(start, end);
}

describeOnDarwin("ScreenCaptureKitWindowList geometry", () => {
	it("keeps subtract and unionRect behavior stable", () => {
		const swiftcCheck = spawnSync("swiftc", ["--version"], { encoding: "utf8" });
		if (swiftcCheck.status !== 0) {
			console.warn("Skipping Swift geometry test because swiftc is unavailable.");
			return;
		}

		const sourcePath = path.join(
			process.cwd(),
			"electron",
			"native",
			"ScreenCaptureKitWindowList.swift",
		);
		const source = readFileSync(sourcePath, "utf8");
		const windowRectDeclaration = sliceRequired(
			source,
			"struct WindowRect",
			"struct WindowVisibility",
		);
		const geometryDeclarations = sliceRequired(
			source,
			"func subtract",
			"func shouldIgnoreWindowStackEntry",
		);

		const tempDir = mkdtempSync(path.join(os.tmpdir(), "recordly-window-geometry-"));
		try {
			const testPath = path.join(tempDir, "GeometryTest.swift");
			const outputPath = path.join(tempDir, "GeometryTest");
			writeFileSync(
				testPath,
				`
${windowRectDeclaration}
${geometryDeclarations}

extension WindowRect: Equatable {}

func describe(_ rect: WindowRect) -> String {
	return "(x: \\(rect.x), y: \\(rect.y), width: \\(rect.width), height: \\(rect.height))"
}

func expectRect(_ actual: WindowRect, _ expected: WindowRect, _ label: String) {
	if actual != expected {
		fatalError("\\(label): expected \\(describe(expected)), got \\(describe(actual))")
	}
}

func expectRects(_ actual: [WindowRect], _ expected: [WindowRect], _ label: String) {
	if actual.count != expected.count {
		fatalError("\\(label): expected \\(expected.count) pieces, got \\(actual.count)")
	}
	for (index, pair) in zip(actual, expected).enumerated() {
		expectRect(pair.0, pair.1, "\\(label)[\\(index)]")
	}
}

let source = WindowRect(x: 0, y: 0, width: 10, height: 10)

expectRects(
	subtract(WindowRect(x: 10, y: 0, width: 5, height: 10), from: source),
	[source],
	"touching edges"
)

expectRects(
	subtract(WindowRect(x: -5, y: -5, width: 20, height: 20), from: source),
	[],
	"full occlusion"
)

let nestedPieces = [
	WindowRect(x: 0, y: 0, width: 10, height: 2),
	WindowRect(x: 0, y: 6, width: 10, height: 4),
	WindowRect(x: 0, y: 2, width: 2, height: 4),
	WindowRect(x: 6, y: 2, width: 4, height: 4),
]
expectRects(
	subtract(WindowRect(x: 2, y: 2, width: 4, height: 4), from: source),
	nestedPieces,
	"nested occluder"
)
expectRect(unionRect(nestedPieces)!, source, "nested occluder union")

expectRect(
	unionRect([
		WindowRect(x: 0, y: 0, width: 5, height: 5),
		WindowRect(x: 10, y: 5, width: 5, height: 5),
	])!,
	WindowRect(x: 0, y: 0, width: 15, height: 10),
	"disjoint visible region union"
)

if unionRect([]) != nil {
	fatalError("empty union should be nil")
}
`,
				"utf8",
			);

			const compile = spawnSync("swiftc", [testPath, "-o", outputPath], {
				encoding: "utf8",
			});
			expect([compile.stdout, compile.stderr].filter(Boolean).join("\n")).toBe("");
			expect(compile.status).toBe(0);

			const run = spawnSync(outputPath, { encoding: "utf8" });
			expect([run.stdout, run.stderr].filter(Boolean).join("\n")).toBe("");
			expect(run.status).toBe(0);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
