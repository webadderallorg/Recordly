#pragma once

#include <algorithm>
#include <cstdint>
#include <limits>
#include <mutex>
#include <vector>

// Pause spans on the QPC clock (100 ns units), stamped when stdin receives "pause" and "resume".
// Video and audio both drop samples captured inside a span and shift later samples by the paused
// time before them, so the tracks stay aligned and static time around a pause is kept.
class PauseTimeline {
public:
    void pause(int64_t atHns) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (paused_) return;
        spans_.push_back({atHns, kOpen});
        paused_ = true;
    }

    void resume(int64_t atHns) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!paused_) return;
        spans_.back().end = (std::max)(atHns, spans_.back().start);
        paused_ = false;
    }

    bool isPaused() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return paused_;
    }

    bool contains(int64_t timestampHns) const {
        std::lock_guard<std::mutex> lock(mutex_);
        for (const Span& span : spans_) {
            if (timestampHns >= span.start && timestampHns < span.end) return true;
        }
        return false;
    }

    // An open pause counts up to timestampHns.
    int64_t pausedBefore(int64_t timestampHns) const {
        std::lock_guard<std::mutex> lock(mutex_);
        int64_t total = 0;
        for (const Span& span : spans_) {
            if (timestampHns <= span.start) break;
            total += (std::min)(timestampHns, span.end) - span.start;
        }
        return total;
    }

private:
    static constexpr int64_t kOpen = (std::numeric_limits<int64_t>::max)();
    struct Span {
        int64_t start;
        int64_t end;
    };
    mutable std::mutex mutex_;
    std::vector<Span> spans_;
    bool paused_ = false;
};
