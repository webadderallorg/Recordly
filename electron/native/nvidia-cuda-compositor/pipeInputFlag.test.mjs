import { describe, expect, it } from "vitest";
import { resolvePipeInputFlag } from "./pipeInputFlag.mjs";

describe("resolvePipeInputFlag", () => {
	it("defaults off: no --pipe-input and no env gate means file mode", () => {
		expect(resolvePipeInputFlag([], {})).toBe(false);
		expect(resolvePipeInputFlag(["--input", "source.mp4"], {})).toBe(false);
	});

	it("enables pipe mode from the explicit --pipe-input CLI flag", () => {
		expect(resolvePipeInputFlag(["--pipe-input"], {})).toBe(true);
		expect(
			resolvePipeInputFlag(
				["--pipe-input", "--input", "source.mp4", "--output-codec", "hevc"],
				{},
			),
		).toBe(true);
	});

	it("enables pipe mode from the RECORDLY_NVIDIA_CUDA_PIPE_INPUT=1 env gate", () => {
		expect(resolvePipeInputFlag([], { RECORDLY_NVIDIA_CUDA_PIPE_INPUT: "1" })).toBe(true);
	});

	it("keeps file mode when the env gate is 0/empty/absent", () => {
		expect(resolvePipeInputFlag([], { RECORDLY_NVIDIA_CUDA_PIPE_INPUT: "0" })).toBe(false);
		expect(resolvePipeInputFlag([], { RECORDLY_NVIDIA_CUDA_PIPE_INPUT: "" })).toBe(false);
		expect(resolvePipeInputFlag([], { RECORDLY_NVIDIA_CUDA_PIPE_INPUT: undefined })).toBe(false);
		expect(resolvePipeInputFlag([], undefined)).toBe(false);
	});

	it("explicit flag wins even when the env gate is off", () => {
		expect(
			resolvePipeInputFlag(["--pipe-input"], { RECORDLY_NVIDIA_CUDA_PIPE_INPUT: "0" }),
		).toBe(true);
	});
});
