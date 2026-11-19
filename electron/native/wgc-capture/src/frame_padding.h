#pragma once

#include <cstdint>

struct FramePadding {
    int64_t timestampHns;
    int64_t durationHns;
};

// The next sample starts at the end of the last successfully submitted sample.
// Preserve the entire uncovered interval without generating per-frame work.
inline FramePadding planFramePadding(
    int64_t lastSampleEndHns, int64_t targetHns, int64_t minimumDurationHns = 1
) {
    if (lastSampleEndHns < 0 || targetHns <= lastSampleEndHns) {
        return {lastSampleEndHns, 0};
    }
    const int64_t durationHns = targetHns - lastSampleEndHns;
    if (durationHns < minimumDurationHns) return {lastSampleEndHns, 0};
    return {lastSampleEndHns, durationHns};
}
