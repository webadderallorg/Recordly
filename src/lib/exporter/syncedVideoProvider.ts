import { StreamingVideoDecoder } from './streamingDecoder'

type QueuedFrame = {
  frame: VideoFrame
  timeMs: number
}

export class SyncedVideoProvider {
  private decoder: StreamingVideoDecoder | null = null
  private pendingFrames: QueuedFrame[] = []
  private currentFrame: QueuedFrame | null = null
  private queueWaiters: Array<(frame: QueuedFrame | null) => void> = []
  private done = false
  private error: Error | null = null

  async initialize(videoUrl: string, targetFrameRate: number): Promise<void> {
    this.destroy()
    this.done = false
    this.error = null

    this.decoder = new StreamingVideoDecoder()
    await this.decoder.loadMetadata(videoUrl)

    void this.decoder.decodeAll(
      targetFrameRate,
      undefined,
      undefined,
      async (frame, _exportTimestampUs, sourceTimestampMs) => {
        const clonedFrame = frame.clone()
        this.enqueueFrame({
          frame: clonedFrame,
          timeMs: sourceTimestampMs,
        })

        while (this.pendingFrames.length > 24 && !this.done) {
          await new Promise((resolve) => setTimeout(resolve, 4))
        }
      },
    ).catch((error) => {
      this.error = error instanceof Error ? error : new Error(String(error))
    }).finally(() => {
      this.done = true
      this.flushWaiters()
    })
  }

  async getFrameAt(targetTimeMs: number): Promise<VideoFrame | null> {
    if (targetTimeMs < 0) {
      return null
    }

    while (true) {
      if (this.error) {
        throw this.error
      }

      const nextFrame = await this.peekNextFrame()
      if (!nextFrame) {
        break
      }

      if (nextFrame.timeMs > targetTimeMs) {
        break
      }

      const advancedFrame = this.pendingFrames.shift()
      if (!advancedFrame) {
        break
      }

      if (this.currentFrame) {
        this.currentFrame.frame.close()
      }
      this.currentFrame = advancedFrame
    }

    return this.currentFrame ? this.currentFrame.frame.clone() : null
  }

  destroy(): void {
    this.done = true

    if (this.currentFrame) {
      this.currentFrame.frame.close()
      this.currentFrame = null
    }

    this.pendingFrames.forEach(({ frame }) => frame.close())
    this.pendingFrames = []
    this.flushWaiters()

    if (this.decoder) {
      this.decoder.destroy()
      this.decoder = null
    }
  }

  private enqueueFrame(frame: QueuedFrame) {
    if (this.done) {
      frame.frame.close()
      return
    }

    this.pendingFrames.push(frame)
    this.flushWaiters()
  }

  private async peekNextFrame(): Promise<QueuedFrame | null> {
    if (this.pendingFrames.length > 0) {
      return this.pendingFrames[0]
    }

    if (this.done) {
      return null
    }

    return new Promise((resolve) => {
      this.queueWaiters.push(resolve)
    })
  }

  private flushWaiters() {
    if (this.queueWaiters.length === 0) {
      return
    }

    const value = this.pendingFrames[0] ?? null
    while (this.queueWaiters.length > 0) {
      const waiter = this.queueWaiters.shift()
      waiter?.(value)
    }
  }
}
