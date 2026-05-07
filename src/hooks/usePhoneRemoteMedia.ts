import { useCallback, useEffect, useRef, useState } from "react";

const PHONE_VIDEO_WIDTH = 1280;
const PHONE_VIDEO_HEIGHT = 720;
const PHONE_VIDEO_FRAME_RATE = 30;
const REMOTE_STALE_TIMEOUT_MS = 5000;

type PhoneRemoteConnectionState =
	| "idle"
	| "waiting"
	| "phone-connected"
	| "preview-live"
	| "mic-active"
	| "reconnecting"
	| "disconnected"
	| "error";

type PhoneRemoteSignalMessage = RendererPhoneRemoteSignalMessage;
type PhoneRemoteStatusMessage = RendererPhoneRemoteStatusMessage;

type UsePhoneRemoteMediaReturn = {
	session: RendererPhoneRemoteSession | null;
	status: PhoneRemoteConnectionState;
	statusDetail: string | null;
	error: string | null;
	previewStream: MediaStream | null;
	videoCaptureStream: MediaStream | null;
	audioStream: MediaStream | null;
	micActive: boolean;
	videoActive: boolean;
	secureJoinReady: boolean;
	startSession: () => Promise<void>;
	stopSession: () => void;
	copyJoinLink: () => Promise<boolean>;
};

function isPhoneSignalMessage(value: unknown): value is PhoneRemoteSignalMessage {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}

	const record = value as Record<string, unknown>;
	if (record.type === "offer" || record.type === "answer") {
		const description = record.description as Record<string, unknown> | null;
		return (
			Boolean(description) &&
			(description?.type === "offer" || description?.type === "answer") &&
			typeof description?.sdp === "string"
		);
	}

	if (record.type === "ice-candidate") {
		return record.candidate === null || typeof record.candidate === "object";
	}

	return false;
}

function normalizeStatus(status: PhoneRemoteStatusMessage["status"]): PhoneRemoteConnectionState {
	switch (status) {
		case "waiting":
		case "phone-connected":
		case "preview-live":
		case "mic-active":
		case "reconnecting":
		case "disconnected":
			return status;
		case "camera-permission-denied":
		case "microphone-permission-denied":
		case "no-audio-track":
		case "phone-backgrounded":
		case "phone-sleeping":
			return "reconnecting";
		case "error":
			return "error";
	}
}

function drawCoverImage(
	context: CanvasRenderingContext2D,
	video: HTMLVideoElement,
	width: number,
	height: number,
) {
	const sourceWidth = video.videoWidth;
	const sourceHeight = video.videoHeight;
	if (sourceWidth <= 0 || sourceHeight <= 0) {
		return;
	}

	const scale = Math.max(width / sourceWidth, height / sourceHeight);
	const drawWidth = sourceWidth * scale;
	const drawHeight = sourceHeight * scale;
	const drawX = (width - drawWidth) / 2;
	const drawY = (height - drawHeight) / 2;
	context.drawImage(video, drawX, drawY, drawWidth, drawHeight);
}

export function usePhoneRemoteMedia(): UsePhoneRemoteMediaReturn {
	const [session, setSession] = useState<RendererPhoneRemoteSession | null>(null);
	const [status, setStatus] = useState<PhoneRemoteConnectionState>("idle");
	const [statusDetail, setStatusDetail] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
	const [videoCaptureStream, setVideoCaptureStream] = useState<MediaStream | null>(null);
	const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
	const [micActive, setMicActive] = useState(false);
	const [videoActive, setVideoActive] = useState(false);
	const sessionRef = useRef<RendererPhoneRemoteSession | null>(null);
	const peerRef = useRef<RTCPeerConnection | null>(null);
	const remoteStreamRef = useRef<MediaStream | null>(null);
	const videoCaptureStreamRef = useRef<MediaStream | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const canvasVideoRef = useRef<HTMLVideoElement | null>(null);
	const drawFrameRef = useRef<number | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
	const remoteAudioTrackRef = useRef<MediaStreamTrack | null>(null);
	const remoteVideoTrackRef = useRef<MediaStreamTrack | null>(null);
	const pendingRemoteIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
	const pendingLocalIceSignalsRef = useRef<PhoneRemoteSignalMessage[]>([]);
	const offerSentRef = useRef(false);
	const remoteStaleTimerRef = useRef<number | null>(null);

	const setCurrentSession = useCallback((nextSession: RendererPhoneRemoteSession | null) => {
		sessionRef.current = nextSession;
		setSession(nextSession);
	}, []);

	const sendSignal = useCallback(async (message: PhoneRemoteSignalMessage) => {
		const currentSession = sessionRef.current;
		if (!currentSession) {
			return;
		}

		const result = await window.electronAPI.sendPhoneRemoteSignal(currentSession.id, message);
		if (!result.success) {
			throw new Error(result.error ?? "Failed to send phone signal.");
		}
	}, []);

	const clearRemoteStaleTimer = useCallback(() => {
		if (remoteStaleTimerRef.current !== null) {
			window.clearTimeout(remoteStaleTimerRef.current);
			remoteStaleTimerRef.current = null;
		}
	}, []);

	const armRemoteStaleTimer = useCallback(() => {
		clearRemoteStaleTimer();
		remoteStaleTimerRef.current = window.setTimeout(() => {
			setStatus((current) =>
				current === "preview-live" || current === "mic-active" ? "reconnecting" : current,
			);
			setStatusDetail("Phone media has stalled. Screen recording can continue safely.");
		}, REMOTE_STALE_TIMEOUT_MS);
	}, [clearRemoteStaleTimer]);

	const ensureVideoCaptureStream = useCallback(() => {
		if (videoCaptureStreamRef.current) {
			return videoCaptureStreamRef.current;
		}

		const canvas = document.createElement("canvas");
		canvas.width = PHONE_VIDEO_WIDTH;
		canvas.height = PHONE_VIDEO_HEIGHT;
		const context = canvas.getContext("2d");
		if (!context) {
			throw new Error("Unable to prepare the phone camera canvas.");
		}

		const video = document.createElement("video");
		video.muted = true;
		video.playsInline = true;
		video.autoplay = true;
		canvasRef.current = canvas;
		canvasVideoRef.current = video;

		const draw = () => {
			context.fillStyle = "#0d0d12";
			context.fillRect(0, 0, PHONE_VIDEO_WIDTH, PHONE_VIDEO_HEIGHT);
			const hasUsableVideo =
				video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
				video.videoWidth > 0 &&
				video.videoHeight > 0;

			if (hasUsableVideo) {
				drawCoverImage(context, video, PHONE_VIDEO_WIDTH, PHONE_VIDEO_HEIGHT);
			} else {
				context.fillStyle = "#777783";
				context.font = "600 34px sans-serif";
				context.textAlign = "center";
				context.fillText(
					"Phone camera waiting",
					PHONE_VIDEO_WIDTH / 2,
					PHONE_VIDEO_HEIGHT / 2,
				);
			}

			drawFrameRef.current = window.requestAnimationFrame(draw);
		};

		drawFrameRef.current = window.requestAnimationFrame(draw);
		const stream = canvas.captureStream(PHONE_VIDEO_FRAME_RATE);
		videoCaptureStreamRef.current = stream;
		setVideoCaptureStream(stream);
		return stream;
	}, []);

	const ensureAudioDestination = useCallback(() => {
		if (audioDestinationRef.current) {
			return audioDestinationRef.current;
		}

		const context = new AudioContext({ sampleRate: 48000 });
		const destination = context.createMediaStreamDestination();
		audioContextRef.current = context;
		audioDestinationRef.current = destination;
		setAudioStream(destination.stream);
		return destination;
	}, []);

	const attachRemoteAudioTrack = useCallback(
		(track: MediaStreamTrack) => {
			remoteAudioTrackRef.current = track;
			const destination = ensureAudioDestination();
			audioSourceRef.current?.disconnect();
			const context = audioContextRef.current;
			if (!context) {
				return;
			}

			const source = context.createMediaStreamSource(new MediaStream([track]));
			source.connect(destination);
			audioSourceRef.current = source;
			context.resume().catch(() => undefined);

			const updateAudioState = () => {
				const active = track.readyState === "live" && track.enabled;
				setMicActive(active);
				if (active) {
					setStatus("mic-active");
					setStatusDetail("Phone microphone is active.");
				}
			};

			track.onmute = updateAudioState;
			track.onunmute = updateAudioState;
			track.onended = () => {
				if (remoteAudioTrackRef.current === track) {
					remoteAudioTrackRef.current = null;
				}
				setMicActive(false);
				setStatus("reconnecting");
				setStatusDetail("Phone microphone track ended.");
			};
			updateAudioState();
		},
		[ensureAudioDestination],
	);

	const attachRemoteStream = useCallback(
		(stream: MediaStream) => {
			remoteStreamRef.current = stream;
			setPreviewStream(stream);
			ensureVideoCaptureStream();

			const video = canvasVideoRef.current;
			if (video && video.srcObject !== stream) {
				video.srcObject = stream;
				video.play().catch(() => undefined);
			}

			const videoTrack = stream.getVideoTracks()[0];
			if (videoTrack) {
				remoteVideoTrackRef.current = videoTrack;
				setVideoActive(videoTrack.readyState === "live");
				videoTrack.onmute = () => {
					setVideoActive(false);
					setStatus("reconnecting");
					setStatusDetail("Phone camera track muted.");
					armRemoteStaleTimer();
				};
				videoTrack.onunmute = () => {
					setVideoActive(true);
					setStatus("preview-live");
					setStatusDetail("Phone camera preview is live.");
					armRemoteStaleTimer();
				};
				videoTrack.onended = () => {
					if (remoteVideoTrackRef.current === videoTrack) {
						remoteVideoTrackRef.current = null;
					}
					setVideoActive(false);
					setStatus("reconnecting");
					setStatusDetail("Phone camera track ended.");
					armRemoteStaleTimer();
				};
			}

			const audioTrack = stream.getAudioTracks()[0];
			if (audioTrack) {
				attachRemoteAudioTrack(audioTrack);
			} else {
				setMicActive(false);
			}

			if (videoTrack || audioTrack) {
				setStatus(videoTrack ? "preview-live" : "mic-active");
				setStatusDetail(
					videoTrack ? "Phone camera preview is live." : "Phone microphone is active.",
				);
				armRemoteStaleTimer();
			}
		},
		[armRemoteStaleTimer, attachRemoteAudioTrack, ensureVideoCaptureStream],
	);

	const closePeer = useCallback(() => {
		const peer = peerRef.current;
		peerRef.current = null;
		if (peer) {
			peer.onicecandidate = null;
			peer.ontrack = null;
			peer.onconnectionstatechange = null;
			peer.close();
		}
		pendingRemoteIceCandidatesRef.current = [];
		pendingLocalIceSignalsRef.current = [];
		offerSentRef.current = false;
	}, []);

	const createPeer = useCallback(() => {
		closePeer();
		const peer = new RTCPeerConnection({
			iceServers: [
				{ urls: "stun:stun.l.google.com:19302" },
				{ urls: "stun:stun1.l.google.com:19302" },
				{ urls: "stun:stun2.l.google.com:19302" },
			],
		});

		peer.addTransceiver("video", { direction: "recvonly" });
		peer.addTransceiver("audio", { direction: "recvonly" });
		peer.onicecandidate = (event) => {
			const message: PhoneRemoteSignalMessage = {
				type: "ice-candidate",
				candidate: event.candidate ? event.candidate.toJSON() : null,
			};

			if (!offerSentRef.current) {
				pendingLocalIceSignalsRef.current.push(message);
				return;
			}

			sendSignal(message).catch((signalError) => {
				console.warn("Failed to send phone remote ICE candidate:", signalError);
			});
		};
		peer.ontrack = (event) => {
			const stream = event.streams[0] ?? remoteStreamRef.current ?? new MediaStream();
			if (!event.streams[0] && event.track) {
				stream.addTrack(event.track);
			}
			attachRemoteStream(stream);
		};
		peer.onconnectionstatechange = () => {
			switch (peer.connectionState) {
				case "connected":
					setStatus("phone-connected");
					setStatusDetail("Phone is connected.");
					break;
				case "disconnected":
				case "failed":
					setStatus("reconnecting");
					setStatusDetail("Phone connection dropped. Screen recording can continue.");
					break;
				case "closed":
					setStatus("disconnected");
					setStatusDetail("Phone disconnected.");
					break;
				default:
					break;
			}
		};
		peerRef.current = peer;
		return peer;
	}, [attachRemoteStream, closePeer, sendSignal]);

	const stopSession = useCallback(() => {
		const currentSession = sessionRef.current;
		if (currentSession) {
			void window.electronAPI.endPhoneRemoteSession(currentSession.id);
		}
		closePeer();
		clearRemoteStaleTimer();
		audioSourceRef.current?.disconnect();
		audioSourceRef.current = null;
		audioContextRef.current?.close().catch(() => undefined);
		audioContextRef.current = null;
		audioDestinationRef.current = null;
		remoteAudioTrackRef.current = null;
		remoteVideoTrackRef.current = null;
		pendingRemoteIceCandidatesRef.current = [];
		pendingLocalIceSignalsRef.current = [];
		offerSentRef.current = false;
		if (drawFrameRef.current !== null) {
			window.cancelAnimationFrame(drawFrameRef.current);
			drawFrameRef.current = null;
		}
		videoCaptureStreamRef.current?.getTracks().forEach((track) => track.stop());
		videoCaptureStreamRef.current = null;
		remoteStreamRef.current = null;
		canvasVideoRef.current = null;
		canvasRef.current = null;
		setCurrentSession(null);
		setStatus("idle");
		setStatusDetail(null);
		setError(null);
		setPreviewStream(null);
		setVideoCaptureStream(null);
		setAudioStream(null);
		setMicActive(false);
		setVideoActive(false);
	}, [clearRemoteStaleTimer, closePeer, setCurrentSession]);

	const startSession = useCallback(async () => {
		setStatus("waiting");
		setStatusDetail("Creating phone connection.");
		setError(null);

		try {
			ensureVideoCaptureStream();
			ensureAudioDestination();
			const result = await window.electronAPI.createPhoneRemoteSession();
			if (!result.success || !result.session) {
				throw new Error(result.error ?? "Failed to create phone session.");
			}

			setCurrentSession(result.session);
			const peer = createPeer();
			const offer = await peer.createOffer();
			await peer.setLocalDescription(offer);
			await sendSignal({ type: "offer", description: offer });
			offerSentRef.current = true;
			for (const candidateSignal of pendingLocalIceSignalsRef.current.splice(0)) {
				await sendSignal(candidateSignal);
			}
			setStatus("waiting");
			setStatusDetail("Waiting for phone to connect.");
		} catch (startError) {
			const message = startError instanceof Error ? startError.message : String(startError);
			setError(message);
			setStatus("error");
			setStatusDetail(message);
		}
	}, [
		createPeer,
		ensureAudioDestination,
		ensureVideoCaptureStream,
		sendSignal,
		setCurrentSession,
	]);

	const copyJoinLink = useCallback(async () => {
		const joinUrl = sessionRef.current?.joinUrl;
		if (!joinUrl) {
			return false;
		}

		try {
			await navigator.clipboard.writeText(joinUrl);
			return true;
		} catch {
			return false;
		}
	}, []);

	useEffect(() => {
		let active = true;
		const removeSignalListener = window.electronAPI.onPhoneRemoteSignal(async (payload) => {
			if (!active) {
				return;
			}
			const currentSession = sessionRef.current;
			if (!currentSession || payload.sessionId !== currentSession.id) {
				return;
			}
			if (!isPhoneSignalMessage(payload.message)) {
				return;
			}

			const peer = peerRef.current;
			if (!peer) {
				return;
			}

			try {
				if (payload.message.type === "answer") {
					if (peer.signalingState !== "have-local-offer") {
						return;
					}
					await peer.setRemoteDescription(payload.message.description);
					if (!active) {
						return;
					}
					for (const candidate of pendingRemoteIceCandidatesRef.current.splice(0)) {
						try {
							await peer.addIceCandidate(candidate);
						} catch (candidateError) {
							console.warn(
								"Failed to apply queued phone ICE candidate:",
								candidateError,
							);
						}
					}
					return;
				}
				if (payload.message.type === "ice-candidate" && payload.message.candidate) {
					if (!peer.remoteDescription) {
						pendingRemoteIceCandidatesRef.current.push(payload.message.candidate);
						return;
					}
					await peer.addIceCandidate(payload.message.candidate);
				}
			} catch (signalError) {
				if (!active) {
					return;
				}
				console.warn("Failed to apply phone remote signal:", signalError);
				setStatus("reconnecting");
				setStatusDetail("Phone signal failed. Waiting for reconnect.");
			}
		});

		const removeStatusListener = window.electronAPI.onPhoneRemoteStatus((payload) => {
			const currentSession = sessionRef.current;
			if (!currentSession || payload.sessionId !== currentSession.id) {
				return;
			}

			setStatus(normalizeStatus(payload.status.status));
			setStatusDetail(payload.status.detail ?? null);
			const actualAudioActive =
				remoteAudioTrackRef.current?.readyState === "live" &&
				remoteAudioTrackRef.current.enabled;
			const actualVideoActive =
				remoteVideoTrackRef.current?.readyState === "live" &&
				!remoteVideoTrackRef.current.muted;

			if (typeof payload.status.hasAudio === "boolean") {
				setMicActive(payload.status.hasAudio ? Boolean(actualAudioActive) : false);
			}
			if (typeof payload.status.hasVideo === "boolean") {
				setVideoActive(payload.status.hasVideo ? Boolean(actualVideoActive) : false);
			}
			if (
				payload.status.status === "preview-live" ||
				payload.status.status === "mic-active" ||
				payload.status.status === "phone-connected"
			) {
				armRemoteStaleTimer();
			}
		});

		return () => {
			active = false;
			removeSignalListener();
			removeStatusListener();
		};
	}, [armRemoteStaleTimer]);

	useEffect(() => {
		return () => {
			stopSession();
		};
	}, [stopSession]);

	return {
		session,
		status,
		statusDetail,
		error,
		previewStream,
		videoCaptureStream,
		audioStream,
		micActive,
		videoActive,
		secureJoinReady: session?.urlMode === "secure-tunnel",
		startSession,
		stopSession,
		copyJoinLink,
	};
}
