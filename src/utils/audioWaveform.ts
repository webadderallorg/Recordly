/**
 * Extracts waveform peaks from an audio file.
 * We decode the audio file using the Web Audio API and calculate the max peaks for each sample.
 */

import { toFileUrl } from "@/components/video-editor/projectPersistence";

const waveformCache = new Map<string, number[]>();

export async function generateWaveform(audioPath: string, samples = 200): Promise<number[]> {
  const cacheKey = `${audioPath}:${samples}`;
  if (waveformCache.has(cacheKey)) {
    return waveformCache.get(cacheKey)!;
  }

  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  try {
    const response = await fetch(toFileUrl(audioPath));
    const arrayBuffer = await response.arrayBuffer();
    
    // Use an offline audio context to decode the data
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    const channelData = audioBuffer.getChannelData(0); // Use the first channel
    const blockSize = Math.floor(channelData.length / samples);
    const peaks: number[] = [];

    for (let i = 0; i < samples; i++) {
      const start = i * blockSize;
      let max = 0;
      for (let j = 0; j < blockSize; j++) {
        const value = Math.abs(channelData[start + j]);
        if (value > max) max = value;
      }
      peaks.push(max);
    }

    waveformCache.set(cacheKey, peaks);
    return peaks;
  } catch (error) {
    console.error('Failed to generate waveform:', error);
    return new Array(samples).fill(0);
  } finally {
    try {
      await audioContext.close();
    } catch (e) {
      // ignore close errors
    }
  }
}
