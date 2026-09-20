import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const boundsSource = readFileSync(fileURLToPath(new URL("./bounds.ts", import.meta.url)), "utf8");

describe("window bounds refresh concurrency", () => {
	it("shares native window enumeration and skips overlapping refreshes", () => {
		expect(boundsSource).toContain("if (nativeMacWindowSourcesInFlight)");
		expect(boundsSource).toContain("return nativeMacWindowSourcesInFlight");
		expect(boundsSource).toContain("if (windowBoundsRefreshInFlight)");
		expect(boundsSource).toContain("windowBoundsRefreshInFlight = false");
	});
});
