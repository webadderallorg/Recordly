import { describe, expect, it } from "vitest";
import { EXPERIMENTAL_UPDATE_DESCRIPTION, getUpdateChannelConfiguration } from "./updateChannel";

describe("getUpdateChannelConfiguration", () => {
	it("keeps regular clients on stable metadata", () => {
		expect(getUpdateChannelConfiguration(false)).toEqual({
			channel: "latest",
			allowPrerelease: false,
			allowDowngrade: false,
		});
	});

	it("uses beta metadata only after the client opts in", () => {
		expect(getUpdateChannelConfiguration(true)).toEqual({
			channel: "beta",
			allowPrerelease: true,
			allowDowngrade: false,
		});
	});

	it("uses the approved experimental update description", () => {
		expect(EXPERIMENTAL_UPDATE_DESCRIPTION).toBe(
			"You've opted into experimental updates so you have the choice to test the latest update of Recordly before it's widely available.",
		);
	});
});
