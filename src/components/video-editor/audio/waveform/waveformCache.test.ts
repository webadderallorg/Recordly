import { describe, expect, it } from "vitest";

import { VersionedWaveformCache } from "./waveformCache";

describe("VersionedWaveformCache", () => {
	it("prunes superseded versions and rejects stale in-flight results", () => {
		const cache = new VersionedWaveformCache<string>(2);

		cache.activate("mic::100", "mic-v1");
		expect(cache.setIfCurrent("mic::100", "mic-v1", "version one")).toBe(true);

		cache.activate("mic::100", "mic-v2");
		expect(cache.get("mic-v1")).toBeUndefined();
		expect(cache.setIfCurrent("mic::100", "mic-v1", "stale version one")).toBe(false);
		expect(cache.setIfCurrent("mic::100", "mic-v2", "version two")).toBe(true);
		expect(cache.get("mic-v2")).toBe("version two");

		cache.activate("mic::100", "mic-v3");
		cache.deactivateIfCurrent("mic::100", "mic-v3");
		expect(cache.setIfCurrent("mic::100", "mic-v3", "failed version three")).toBe(false);
	});

	it("evicts the least recently used resource when the cache reaches its bound", () => {
		const cache = new VersionedWaveformCache<string>(2);

		cache.activate("mic-a", "mic-a-v1");
		cache.setIfCurrent("mic-a", "mic-a-v1", "a");
		cache.activate("mic-b", "mic-b-v1");
		cache.setIfCurrent("mic-b", "mic-b-v1", "b");
		expect(cache.get("mic-a-v1")).toBe("a");

		cache.activate("mic-c", "mic-c-v1");
		cache.setIfCurrent("mic-c", "mic-c-v1", "c");

		expect(cache.get("mic-a-v1")).toBe("a");
		expect(cache.get("mic-b-v1")).toBeUndefined();
		expect(cache.get("mic-c-v1")).toBe("c");
	});
});
