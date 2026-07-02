import { describe, expect, it } from "vitest";
import { createSourcePreviewRequestGate } from "./sourcePreviewRequestGate";

describe("createSourcePreviewRequestGate", () => {
	it("marks an earlier restore request stale after a newer hover starts", () => {
		const gate = createSourcePreviewRequestGate();

		const restoreRequestId = gate.next();
		const hoverRequestId = gate.next();

		expect(gate.isCurrent(restoreRequestId)).toBe(false);
		expect(gate.isCurrent(hoverRequestId)).toBe(true);
	});
});
