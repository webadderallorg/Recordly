import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.skipIf(process.platform === "win32")(
	"native padding covers static recording gaps exactly with one sample",
	() => {
		const directory = mkdtempSync(join(tmpdir(), "recordly-frame-padding-"));
		try {
			const file = join(directory, "test.cpp");
			const binary = join(directory, "test");
			writeFileSync(
				file,
				`#include "frame_padding.h"
#include <cassert>
#include <cstdint>
#include <iostream>
#include <limits>

int main() {
    constexpr int64_t frame = 10000000LL / 60;
    assert(planFramePadding(-1, 10000000).durationHns == 0);
    assert(planFramePadding(frame, 0).durationHns == 0);
    assert(planFramePadding(frame, frame).durationHns == 0);

    // Timestamp jitter must not cause a second encoded sample per live frame.
    assert(planFramePadding(frame, frame + 1, frame).durationHns == 0);
    assert(planFramePadding(frame, 2 * frame - 1, frame).durationHns == 0);
    assert(planFramePadding(frame, 2 * frame, frame).durationHns == frame);

    // A static hour followed by Stop requires one sample, not 216,000.
    const int64_t stop = 3600LL * 10000000 + 12345;
    auto padding = planFramePadding(frame, stop);
    assert(padding.timestampHns == frame);
    assert(padding.durationHns == stop - frame);
    const int64_t end = padding.timestampHns + padding.durationHns;
    assert(end == stop);
    assert(planFramePadding(end, stop).durationHns == 0);

    // Repeated extensions must start after the full duration already written,
    // rather than one nominal frame after that sample's starting timestamp.
    auto extension = planFramePadding(end, stop + 1);
    assert(extension.timestampHns == stop);
    assert(extension.durationHns == 1);

    // Exercise fractional-frame endpoints and large timestamp gaps. Every
    // uncovered interval is contiguous and ends exactly at the target.
    uint64_t random = 42;
    for (int i = 0; i < 100000; ++i) {
        random = random * 6364136223846793005ULL + 1;
        const int64_t previousEnd = static_cast<int64_t>(random >> 2);
        random = random * 6364136223846793005ULL + 1;
        const int64_t gap = 1 + static_cast<int64_t>(random >> 2);
        const int64_t target = previousEnd + gap;
        auto planned = planFramePadding(previousEnd, target);
        assert(planned.timestampHns == previousEnd);
        assert(planned.durationHns == gap);
        assert(planned.timestampHns + planned.durationHns == target);
        assert(planFramePadding(target, target - 1).durationHns == 0);
    }
    auto maximum = planFramePadding(0, std::numeric_limits<int64_t>::max());
    assert(maximum.durationHns == std::numeric_limits<int64_t>::max());
    std::cout << "100000 native timeline intervals passed\\n";
}
`,
			);
			const compilation = spawnSync(
				"c++",
				[
					"-std=c++17",
					"-Wall",
					"-Wextra",
					"-Werror",
					"-I",
					fileURLToPath(new URL("./src", import.meta.url)),
					file,
					"-o",
					binary,
				],
				{ encoding: "utf8", timeout: 30_000 },
			);
			expect(compilation.status, compilation.stderr).toBe(0);
			const result = spawnSync(binary, [], {
				encoding: "utf8",
				timeout: 10_000,
			});
			expect(result.status, result.stderr).toBe(0);
			expect(result.stdout).toContain("100000 native timeline intervals passed");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	},
	45_000,
);
