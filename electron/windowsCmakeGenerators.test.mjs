import { describe, expect, it, vi } from "vitest";

import {
	configureWithWindowsCmakeGenerator,
	WINDOWS_VISUAL_STUDIO_INSTALL_DIRS,
} from "../scripts/windows-cmake-generators.mjs";

describe("configureWithWindowsCmakeGenerator", () => {
	it("uses Visual Studio 2026 first", () => {
		const configure = vi.fn();
		const clearCache = vi.fn();

		const selected = configureWithWindowsCmakeGenerator({
			prefix: "test",
			configure,
			clearCache,
		});

		expect(selected).toBe("Visual Studio 18 2026");
		expect(WINDOWS_VISUAL_STUDIO_INSTALL_DIRS[0]).toBe("18");
		expect(configure).toHaveBeenCalledWith("Visual Studio 18 2026", "v143");
		expect(clearCache).toHaveBeenCalledTimes(1);
	});

	it("falls back in supported-version order and clears stale CMake state", () => {
		const attempted = [];
		const clearCache = vi.fn();
		const log = vi.fn();

		const selected = configureWithWindowsCmakeGenerator({
			prefix: "test",
			clearCache,
			log,
			configure: (generator, toolset) => {
				attempted.push({ name: generator, toolset });
				if (generator !== "Visual Studio 16 2019") {
					throw new Error(`${generator} unavailable`);
				}
			},
		});

		expect(attempted).toEqual([
			{ name: "Visual Studio 18 2026", toolset: "v143" },
			{ name: "Visual Studio 17 2022", toolset: undefined },
			{ name: "Visual Studio 16 2019", toolset: undefined },
		]);
		expect(clearCache).toHaveBeenCalledTimes(3);
		expect(log).toHaveBeenCalledTimes(2);
		expect(selected).toBe("Visual Studio 16 2019");
	});

	it("configures on Visual Studio 2026 with only its default toolset installed", () => {
		const clearCache = vi.fn();
		const configure = vi.fn((generator, toolset) => {
			if (generator !== "Visual Studio 18 2026") throw new Error("Generator unavailable");
			if (toolset === "v143") throw new Error("MSB8020: v143 build tools cannot be found");
		});

		const selected = configureWithWindowsCmakeGenerator({
			prefix: "test",
			clearCache,
			log: vi.fn(),
			configure,
		});

		expect(selected).toBe("Visual Studio 18 2026");
		expect(configure.mock.calls).toEqual([
			["Visual Studio 18 2026", "v143"],
			["Visual Studio 17 2022", undefined],
			["Visual Studio 16 2019", undefined],
			["Visual Studio 18 2026", undefined],
		]);
		expect(clearCache).toHaveBeenCalledTimes(4);
	});

	it("rethrows the final configure error when no supported generator exists", () => {
		const finalError = new Error("VS 2026 default toolset unavailable");

		expect(() =>
			configureWithWindowsCmakeGenerator({
				prefix: "test",
				clearCache: vi.fn(),
				log: vi.fn(),
				configure: (generator, toolset) => {
					if (generator === "Visual Studio 18 2026" && !toolset) throw finalError;
					throw new Error(`${generator} unavailable`);
				},
			}),
		).toThrow(finalError);
	});
});
