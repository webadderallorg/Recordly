#pragma once

// Runs the Windows-only WASAPI loopback level monitor protocol.
// The caller owns the process lifetime; this function returns after stdin
// receives "stop" or closes.
int runAudioOutputLevelMonitor();
