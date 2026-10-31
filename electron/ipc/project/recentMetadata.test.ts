import { expect, it, vi } from "vitest";
import { persistRecentMetadata } from "./recentMetadata";
it("reports a metadata warning without rejecting an already committed operation", async () => {
	const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
	const result = await persistRecentMetadata(async () => {
		throw Error("disk full");
	});
	expect(result).toContain("operation completed");
	expect(result).toContain("disk full");
	expect(log).toHaveBeenCalledOnce();
	log.mockRestore();
});
it("has no warning after a successful metadata update", async () => {
	const update = vi.fn().mockResolvedValue(undefined);
	await expect(persistRecentMetadata(update)).resolves.toBeUndefined();
	expect(update).toHaveBeenCalledOnce();
});
