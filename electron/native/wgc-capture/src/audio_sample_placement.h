#pragma once

#include <algorithm>
#include <cstdint>
#include <limits>

inline bool shouldFadeAfterAudioGap(uint64_t gapFrames, uint32_t sampleRate) {
    if (sampleRate == 0) return false;
    // Sample-clock drift commonly needs one sample of silence. Restarting a
    // boundary fade there would repeatedly duck otherwise continuous audio.
    constexpr uint64_t minimumFadeGapMs = 5;
    const uint64_t minimumFadeGapFrames =
        (static_cast<uint64_t>(sampleRate) * minimumFadeGapMs + 999) / 1000;
    return gapFrames >= minimumFadeGapFrames;
}

struct AudioSamplePlacement {
    int64_t originQpcHns;
    uint64_t silenceFrames = 0;
    uint32_t trimFrames = 0;
    bool rejectedTimestamp = false;
};

// Place source PCM on the capture clock without accumulating per-packet rounding
// error. Invalid timestamps retain contiguous PCM until a reliable clock arrives.
inline AudioSamplePlacement planAudioSamplePlacement(
    int64_t originQpcHns,
    int64_t packetQpcHns,
    int64_t pausedHns,
    uint64_t writtenFrames,
    uint32_t packetFrames,
    uint32_t sampleRate,
    bool reliableTimestamp
) {
    AudioSamplePlacement placement{originQpcHns};
    if (!reliableTimestamp || packetFrames == 0 || sampleRate == 0) return placement;

    constexpr uint64_t hnsPerSecond = 10000000;
    // A corrupt device clock must not create hours of blocking silence writes.
    // Preserve ordinary dropouts; retain contiguous PCM for implausible jumps.
    constexpr uint64_t maximumGapSeconds = 30;
    const uint64_t safePausedHns = static_cast<uint64_t>((std::max)(int64_t{0}, pausedHns));
    if (packetQpcHns <= 0 || safePausedHns > static_cast<uint64_t>(packetQpcHns)) {
        placement.rejectedTimestamp = true;
        return placement;
    }
    const uint64_t activePacketHns = static_cast<uint64_t>(packetQpcHns) - safePausedHns;

    if (originQpcHns < 0) {
        // Timestamp-error packets may already have supplied PCM. The next valid
        // packet describes their endpoint, not the beginning of the WAV file.
        const uint64_t seconds = writtenFrames / sampleRate;
        const uint64_t remainderHns =
            ((writtenFrames % sampleRate) * hnsPerSecond + sampleRate / 2) / sampleRate;
        const uint64_t maximumHns = static_cast<uint64_t>((std::numeric_limits<int64_t>::max)());
        if (seconds > (maximumHns - remainderHns) / hnsPerSecond) {
            placement.rejectedTimestamp = true;
            return placement;
        }
        const uint64_t writtenHns = seconds * hnsPerSecond + remainderHns;
        if (writtenHns > activePacketHns) {
            placement.rejectedTimestamp = true;
            return placement;
        }
        placement.originQpcHns = static_cast<int64_t>(activePacketHns - writtenHns);
        return placement;
    }

    const uint64_t originHns = static_cast<uint64_t>(originQpcHns);
    const uint64_t elapsedHns = activePacketHns > originHns ? activePacketHns - originHns : 0;
    const uint64_t seconds = elapsedHns / hnsPerSecond;
    const uint64_t remainderFrames =
        ((elapsedHns % hnsPerSecond) * sampleRate + hnsPerSecond / 2) / hnsPerSecond;
    if (seconds > ((std::numeric_limits<uint64_t>::max)() - remainderFrames) / sampleRate) {
        placement.rejectedTimestamp = true;
        return placement;
    }
    const uint64_t expectedStartFrame = seconds * sampleRate + remainderFrames;
    const uint64_t maximumCorrectionFrames = static_cast<uint64_t>(sampleRate) * maximumGapSeconds;
    if (expectedStartFrame > writtenFrames) {
        const uint64_t missingFrames = expectedStartFrame - writtenFrames;
        if (missingFrames > maximumCorrectionFrames) {
            placement.rejectedTimestamp = true;
            return placement;
        }
        placement.silenceFrames = missingFrames;
    } else {
        // A device clock reset must not discard all subsequent microphone PCM.
        if (writtenFrames - expectedStartFrame > maximumCorrectionFrames) {
            placement.rejectedTimestamp = true;
            return placement;
        }
        placement.trimFrames = static_cast<uint32_t>((std::min)(
            writtenFrames - expectedStartFrame, static_cast<uint64_t>(packetFrames)));
    }
    return placement;
}
