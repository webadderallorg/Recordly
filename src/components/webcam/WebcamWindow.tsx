import { useEffect, useRef, useState } from 'react'

export function WebcamWindow() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let mounted = true

    const startWebcam = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        })

        if (mounted && videoRef.current) {
          videoRef.current.srcObject = mediaStream
          setStream(mediaStream)
          videoRef.current.play().catch((error) => {
            console.error('Error playing webcam:', error)
          })
        } else {
          mediaStream.getTracks().forEach((track) => track.stop())
        }
      } catch (error) {
        console.error('Failed to get webcam access:', error)
      }
    }

    void startWebcam()

    return () => {
      mounted = false
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="w-full h-full rounded-full overflow-hidden border-4 border-white/30 shadow-2xl cursor-move"
      style={{
        background: 'linear-gradient(135deg, rgba(28,28,36,0.97) 0%, rgba(18,18,26,0.96) 100%)',
        WebkitAppRegion: 'drag',
      } as any}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
        style={{
          transform: 'scaleX(-1)',
        }}
      />
    </div>
  )
}
