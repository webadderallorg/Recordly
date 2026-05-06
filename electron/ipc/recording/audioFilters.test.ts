import { describe, expect, it } from "vitest";

import { WINDOWS_NATIVE_MIC_PRE_FILTERS } from "./audioFilters";

describe("Windows native mic pre-filter policy", () => {
	it("keeps repair filters without automatic gain or loudness normalization", () => {
		expect(WINDOWS_NATIVE_MIC_PRE_FILTERS).toContain("adeclip=threshold=1");
		expect(
			WINDOWS_NATIVE_MIC_PRE_FILTERS.some((filter) =>
				/(^|,)(loudnorm|dynaudnorm|volume)=/i.test(filter),
			),
		).toBe(false);
	});
});
