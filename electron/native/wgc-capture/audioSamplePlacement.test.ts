import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.skipIf(process.platform === "win32")(
	"native PCM keeps capture-clock gaps, overlaps, and long recordings in sample alignment",
	() => {
		const directory = mkdtempSync(join(tmpdir(), "recordly-audio-placement-"));
		try {
			const file = join(directory, "test.cpp");
			const binary = join(directory, "test");
			writeFileSync(
				file,
				`#include "audio_sample_placement.h"
#include <cassert>
#include <cmath>
#include <iostream>
#include <vector>

constexpr int64_t second = 10000000;
constexpr int64_t origin = 100 * second;

struct Recorder {
    uint32_t rate;
    int64_t epoch = -1;
    uint64_t written = 0;
    uint64_t silence = 0;
    uint64_t trimmed = 0;
    uint64_t gapFades = 0;
    std::vector<int> pcm;

    explicit Recorder(uint32_t sampleRate) : rate(sampleRate) {}

    AudioSamplePlacement append(int64_t timestamp, uint32_t count,
        bool reliable = true, int64_t paused = 0, bool retainPcm = false, int marker = 1) {
        auto placement = planAudioSamplePlacement(
            epoch, timestamp, paused, written, count, rate, reliable);
        epoch = placement.originQpcHns;
        silence += placement.silenceFrames;
        trimmed += placement.trimFrames;
        if (shouldFadeAfterAudioGap(placement.silenceFrames, rate)) ++gapFades;
        written += placement.silenceFrames + count - placement.trimFrames;
        if (retainPcm) {
            pcm.insert(pcm.end(), placement.silenceFrames, 0);
            for (uint32_t i = placement.trimFrames; i < count; ++i) pcm.push_back(marker + i);
        }
        return placement;
    }
};

void testPackets(uint32_t rate) {
    const uint32_t packet = rate / 100;
    Recorder recorder{rate};
    recorder.append(origin, packet, true, 0, true, 1000);
    // A 40 ms gap previously fell under both WASAPI gap-fill thresholds.
    auto gap = recorder.append(origin + second / 20, packet, true, 0, true, 2000);
    assert(gap.silenceFrames == rate * 4 / 100);
    assert(recorder.gapFades == 1);
    assert(recorder.pcm[packet] == 0);
    assert(recorder.pcm[rate / 20] == 2000);
    const auto endpoint = recorder.written;
    // Repeated and fully late packets cannot duplicate samples or lengthen audio.
    auto duplicate = recorder.append(origin + second / 20, packet, true, 0, true, 3000);
    assert(duplicate.trimFrames == packet);
    assert(recorder.written == endpoint);
    auto late = recorder.append(origin, packet, true, 0, true, 4000);
    assert(late.trimFrames == packet);
    assert(recorder.written == endpoint);
    // A partially overlapping packet retains only the samples beyond the endpoint.
    const uint32_t overlap = packet / 2;
    const int64_t overlapTime = static_cast<int64_t>(std::llround(
        static_cast<long double>(endpoint - overlap) * second / rate));
    auto partial = recorder.append(origin + overlapTime, packet, true, 0, true, 5000);
    assert(partial.trimFrames == overlap);
    assert(recorder.pcm[endpoint] == 5000 + static_cast<int>(overlap));
    assert(recorder.written == endpoint + packet - overlap);

    // Pauses before the first valid timestamp must not delay the metadata epoch.
    Recorder delayedClock{rate};
    delayedClock.append(0, packet, false);
    delayedClock.append(origin, packet, false);
    auto firstValid = delayedClock.append(origin + 3 * second + second / 50,
        packet, true, 3 * second);
    assert(firstValid.originQpcHns == origin);
    // Metadata uses the physical recording epoch with all earlier pauses removed.
    assert(firstValid.originQpcHns + 3 * second +
        static_cast<int64_t>(packet * 2) * second / rate ==
        origin + 3 * second + second / 50);
    assert(firstValid.silenceFrames == 0 && firstValid.trimFrames == 0);
    assert(delayedClock.written == packet * 3);
    // A later invalid timestamp keeps PCM; a returning valid clock does not add
    // silence for that already-written data or for excluded pause duration.
    delayedClock.append(0, packet, false, 3 * second);
    auto afterPause = delayedClock.append(origin + 8 * second + second / 25,
        packet, true, 8 * second);
    assert(afterPause.silenceFrames == 0 && afterPause.trimFrames == 0);
    assert(delayedClock.written == packet * 5);

    Recorder pausedBeforeData{rate};
    auto firstAfterPause = pausedBeforeData.append(origin + 2 * second,
        packet, true, 2 * second);
    assert(firstAfterPause.originQpcHns == origin);

    // Sub-millisecond loss is retained rather than compacted into the next sound.
    Recorder singleSampleGap{rate};
    singleSampleGap.append(origin, packet);
    const int64_t nextTimestamp = origin + static_cast<int64_t>(std::llround(
        static_cast<long double>(packet + 1) * second / rate));
    assert(singleSampleGap.append(nextTimestamp, packet).silenceFrames == 1);
    assert(singleSampleGap.gapFades == 0);
    const uint64_t fiveMsFrames = (static_cast<uint64_t>(rate) * 5 + 999) / 1000;
    assert(!shouldFadeAfterAudioGap(fiveMsFrames - 1, rate));
    assert(shouldFadeAfterAudioGap(fiveMsFrames, rate));
}

void testHour(uint32_t rate, int clockPartsPerMillion) {
    Recorder recorder{rate};
    const uint32_t packet = rate / 100;
    for (uint64_t index = 0; index < 360000; ++index) {
        const int64_t elapsed = static_cast<int64_t>(std::llround(
            static_cast<long double>(index) * second / 100 *
            (1000000 + clockPartsPerMillion) / 1000000));
        const int64_t pause = index >= 180000 ? 17 * second : 0;
        const auto placement = recorder.append(origin + elapsed + pause, packet, true, pause);
        assert(!placement.rejectedTimestamp);
        const uint64_t expected = static_cast<uint64_t>(std::llround(
            static_cast<long double>(elapsed) * rate / second)) + packet;
        assert(recorder.written == expected);
    }
    assert(recorder.epoch == origin);
    assert(recorder.gapFades == 0);
    if (clockPartsPerMillion > 0) assert(recorder.silence > rate / 2);
    else assert(recorder.trimmed > rate / 2);
}

int main() {
    for (const uint32_t rate : {44100, 48000}) {
        testPackets(rate);
        testHour(rate, -200);
        testHour(rate, 200);
    }

    Recorder corruptedClock{48000};
    corruptedClock.append(origin, 480);
    auto enormousGap = corruptedClock.append((std::numeric_limits<int64_t>::max)(), 480);
    assert(enormousGap.rejectedTimestamp && enormousGap.silenceFrames == 0);
    assert(corruptedClock.written == 960 && corruptedClock.epoch == origin);
    auto recovered = corruptedClock.append(origin + second / 50, 480);
    assert(!recovered.rejectedTimestamp && recovered.silenceFrames == 0);

    Recorder resetClock{48000};
    resetClock.append(origin, 480);
    resetClock.written = 61 * 48000;
    auto backwardReset = resetClock.append(origin + second, 480);
    assert(backwardReset.rejectedTimestamp && backwardReset.trimFrames == 0);
    assert(resetClock.written == 61 * 48000 + 480 && resetClock.epoch == origin);
    auto afterReset = resetClock.append(origin + 61 * second + second / 100, 480);
    assert(!afterReset.rejectedTimestamp && afterReset.trimFrames == 0);

    // Extreme inputs cannot overflow either direction of the sample conversion.
    auto impossibleOrigin = planAudioSamplePlacement(-1, origin, 0,
        (std::numeric_limits<uint64_t>::max)(), 480, 1, true);
    assert(impossibleOrigin.rejectedTimestamp && impossibleOrigin.originQpcHns == -1);
    auto overflowingFrames = planAudioSamplePlacement(0,
        (std::numeric_limits<int64_t>::max)(), 0, 0, 480,
        (std::numeric_limits<uint32_t>::max)(), true);
    assert(overflowingFrames.rejectedTimestamp && overflowingFrames.silenceFrames == 0);
    auto invalidPause = planAudioSamplePlacement(-1, origin, origin + 1, 0, 480, 48000, true);
    assert(invalidPause.rejectedTimestamp && invalidPause.originQpcHns == -1);
    std::cout << "sample placement and four simulated recording hours passed\\n";
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
			const result = spawnSync(binary, [], { encoding: "utf8", timeout: 10_000 });
			expect(result.status, result.stderr).toBe(0);
			expect(result.stdout).toContain(
				"sample placement and four simulated recording hours passed",
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	},
	45_000,
);
