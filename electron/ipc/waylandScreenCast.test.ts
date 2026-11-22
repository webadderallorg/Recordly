import { describe, expect, it, vi } from "vitest";
import { isWaylandScreenCastMissing } from "./waylandScreenCast";

describe("Wayland ScreenCast discovery", () => {
	it.each([
		['<node><interface name="org.freedesktop.portal.FileChooser"/></node>', true],
		['<node><interface name="org.freedesktop.portal.ScreenCast"/></node>', false],
		["empty reply", false],
	])("detects a missing ScreenCast interface from %s", async (stdout, missing) => {
		const run = vi.fn().mockResolvedValue({ stdout });
		await expect(isWaylandScreenCastMissing(run)).resolves.toBe(missing);
	});

	it.each([
		["Error org.freedesktop.DBus.Error.ServiceUnknown: no portal", true],
		["Error org.freedesktop.DBus.Error.NoReply: timed out", false],
		["Error org.freedesktop.DBus.Error.AccessDenied: denied", false],
		[undefined, false],
	])("distinguishes absent service from an inconclusive failure (%s)", async (stderr, missing) => {
		const run = vi.fn().mockRejectedValue(Object.assign(new Error("probe failed"), { stderr }));
		await expect(isWaylandScreenCastMissing(run)).resolves.toBe(missing);
	});
});
