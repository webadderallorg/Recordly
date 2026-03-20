import { WebDemuxer } from "web-demuxer";

export interface ForwardFrameSourceMetadata {
  width: number;
  height: number;
  duration: number;
  codec: string;
}

/**
 * Forward-only decoded frame source for monotonic timestamp access.
 *
 * This avoids per-frame HTMLVideoElement seeking during export and returns
 * the nearest decoded frame for increasing target timestamps.
 */
export class ForwardFrameSource {
  private demuxer: WebDemuxer | null = null;
  private decoder: VideoDecoder | null = null;
  private cancelled = false;
  private metadata: ForwardFrameSourceMetadata | null = null;
  private pendingFrames: VideoFrame[] = [];
  private frameResolve: ((frame: VideoFrame | null) => void) | null = null;
  private decodeError: Error | null = null;
  private decodeDone = false;
  private feedPromise: Promise<void> | null = null;
  private reader: ReadableStreamDefaultReader<EncodedVideoChunk> | null = null;
  private heldFrame: VideoFrame | null = null;
  private heldFrameSec = 0;
  private lastTargetTimeSec = 0;

  private toLocalFilePath(resourceUrl: string): string | null {
    if (!resourceUrl.startsWith("file:")) {
      return null;
    }

    try {
      const url = new URL(resourceUrl);
      let filePath = decodeURIComponent(url.pathname);
      if (/^\/[A-Za-z]:/.test(filePath)) {
        filePath = filePath.slice(1);
      }
      return filePath;
    } catch {
      return resourceUrl.replace(/^file:\/\//, "");
    }
  }

  private inferMimeType(fileName: string): string {
    const extension = fileName.split(".").pop()?.toLowerCase();
    switch (extension) {
      case "mov":
        return "video/quicktime";
      case "webm":
        return "video/webm";
      case "mkv":
        return "video/x-matroska";
      case "avi":
        return "video/x-msvideo";
      case "mp4":
      default:
        return "video/mp4";
    }
  }

  private async loadVideoFile(resourceUrl: string): Promise<File> {
    const filename = resourceUrl.split("/").pop() || "video";
    const localFilePath = this.toLocalFilePath(resourceUrl);

    if (localFilePath) {
      const result = await window.electronAPI.readLocalFile(localFilePath);
      if (!result.success || !result.data) {
        throw new Error(result.error || "Failed to read local video file");
      }

      const bytes =
        result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data);
      const arrayBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      return new File([arrayBuffer], filename, {
        type: this.inferMimeType(filename),
      });
    }

    const response = await fetch(resourceUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to load video resource: ${response.status} ${response.statusText}`,
      );
    }

    const blob = await response.blob();
    return new File([blob], filename, {
      type: blob.type || this.inferMimeType(filename),
    });
  }

  private resolveVideoResourceUrl(videoUrl: string): string {
    if (/^(blob:|data:|https?:|file:)/i.test(videoUrl)) {
      return videoUrl;
    }

    if (videoUrl.startsWith("/")) {
      return `file://${encodeURI(videoUrl)}`;
    }

    return videoUrl;
  }

  async initialize(videoUrl: string): Promise<ForwardFrameSourceMetadata> {
    const resourceUrl = this.resolveVideoResourceUrl(videoUrl);
    const wasmUrl = new URL("./wasm/web-demuxer.wasm", window.location.href).href;
    this.demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });

    const file = await this.loadVideoFile(resourceUrl);
    await this.demuxer.load(file);

    const mediaInfo = await this.demuxer.getMediaInfo();
    const videoStream = mediaInfo.streams.find(
      (stream) => stream.codec_type_string === "video",
    );

    this.metadata = {
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      duration: mediaInfo.duration,
      codec: videoStream?.codec_string || "unknown",
    };

    await this.startDecoder();
    return this.metadata;
  }

  private async startDecoder(): Promise<void> {
    if (!this.demuxer || !this.metadata) {
      throw new Error("Must call initialize() before starting decoder");
    }

    const decoderConfig = await this.demuxer.getDecoderConfig("video");
    const codec = this.metadata.codec.toLowerCase();
    const shouldPreferSoftwareDecode = codec.includes("av01") || codec.includes("av1");

    this.decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        if (this.frameResolve) {
          const resolve = this.frameResolve;
          this.frameResolve = null;
          resolve(frame);
        } else {
          this.pendingFrames.push(frame);
        }
      },
      error: (error: DOMException) => {
        this.decodeError = new Error(`VideoDecoder error: ${error.message}`);
        if (this.frameResolve) {
          const resolve = this.frameResolve;
          this.frameResolve = null;
          resolve(null);
        }
      },
    });

    const preferredDecoderConfig = shouldPreferSoftwareDecode
      ? {
          ...decoderConfig,
          hardwareAcceleration: "prefer-software" as const,
        }
      : decoderConfig;

    try {
      this.decoder.configure(preferredDecoderConfig);
    } catch (error) {
      if (!shouldPreferSoftwareDecode) {
        throw error;
      }
      this.decoder.configure(decoderConfig);
    }

    const readEndSec = Math.max(this.metadata.duration, 0) + 0.5;
    this.reader = this.demuxer.read("video", 0, readEndSec).getReader();

    this.feedPromise = (async () => {
      try {
        while (!this.cancelled) {
          const { done, value: chunk } = await this.reader!.read();
          if (done || !chunk) {
            break;
          }

          while (
            (this.decoder!.decodeQueueSize > 10 || this.pendingFrames.length > 24) &&
            !this.cancelled
          ) {
            await new Promise((resolve) => setTimeout(resolve, 1));
          }

          if (this.cancelled) {
            break;
          }

          this.decoder!.decode(chunk);
        }

        if (!this.cancelled && this.decoder?.state === "configured") {
          await this.decoder.flush();
        }
      } catch (error) {
        this.decodeError =
          error instanceof Error ? error : new Error(String(error));
      } finally {
        this.decodeDone = true;
        if (this.frameResolve) {
          const resolve = this.frameResolve;
          this.frameResolve = null;
          resolve(null);
        }
      }
    })();
  }

  private getNextFrame(): Promise<VideoFrame | null> {
    if (this.decodeError) {
      throw this.decodeError;
    }

    if (this.pendingFrames.length > 0) {
      return Promise.resolve(this.pendingFrames.shift()!);
    }

    if (this.decodeDone) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      this.frameResolve = resolve;
    });
  }

  async getFrameAtTime(targetTimeSec: number): Promise<VideoFrame | null> {
    if (!this.metadata) {
      throw new Error("Frame source not initialized");
    }

    const clampedTargetTime = Math.max(0, Math.min(targetTimeSec, this.metadata.duration || targetTimeSec));
    if (clampedTargetTime + 0.001 < this.lastTargetTimeSec) {
      throw new Error("ForwardFrameSource only supports increasing timestamps");
    }
    this.lastTargetTimeSec = clampedTargetTime;

    if (!this.heldFrame) {
      const firstFrame = await this.getNextFrame();
      if (!firstFrame) {
        return null;
      }
      this.heldFrame = firstFrame;
      this.heldFrameSec = firstFrame.timestamp / 1_000_000;
    }

    while (!this.cancelled) {
      const nextFrame = await this.getNextFrame();
      if (!nextFrame) {
        return new VideoFrame(this.heldFrame, {
          timestamp: this.heldFrame.timestamp,
        });
      }

      const nextFrameSec = nextFrame.timestamp / 1_000_000;
      const handoffBoundarySec = (this.heldFrameSec + nextFrameSec) / 2;
      if (clampedTargetTime <= handoffBoundarySec) {
        this.pendingFrames.unshift(nextFrame);
        return new VideoFrame(this.heldFrame, {
          timestamp: this.heldFrame.timestamp,
        });
      }

      this.heldFrame.close();
      this.heldFrame = nextFrame;
      this.heldFrameSec = nextFrameSec;
    }

    return null;
  }

  cancel(): void {
    this.cancelled = true;
  }

  async destroy(): Promise<void> {
    this.cancelled = true;

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        // Ignore cancellation errors during shutdown.
      }
      this.reader = null;
    }

    if (this.feedPromise) {
      try {
        await this.feedPromise;
      } catch {
        // Decoder errors are already surfaced through getFrameAtTime.
      }
      this.feedPromise = null;
    }

    if (this.heldFrame) {
      this.heldFrame.close();
      this.heldFrame = null;
    }

    for (const frame of this.pendingFrames) {
      frame.close();
    }
    this.pendingFrames = [];

    if (this.decoder) {
      try {
        if (this.decoder.state === "configured") {
          this.decoder.close();
        }
      } catch {
        // Ignore decoder shutdown errors.
      }
      this.decoder = null;
    }

    if (this.demuxer) {
      try {
        this.demuxer.destroy();
      } catch {
        // Ignore demuxer shutdown errors.
      }
      this.demuxer = null;
    }

    this.metadata = null;
    this.decodeDone = false;
    this.decodeError = null;
    this.lastTargetTimeSec = 0;
  }
}