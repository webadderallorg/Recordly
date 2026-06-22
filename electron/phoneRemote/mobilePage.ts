export function getPhoneRemoteMobilePage(): string {
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
	<title>Recordly Phone Camera</title>
	<style>
		:root {
			color-scheme: dark;
			font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			background: #0d0d12;
			color: #f4f4f7;
		}
		* { box-sizing: border-box; }
		body {
			margin: 0;
			min-height: 100svh;
			background:
				radial-gradient(circle at 20% 0%, rgba(61, 139, 255, 0.22), transparent 34rem),
				linear-gradient(180deg, #12121a 0%, #09090d 100%);
		}
		main {
			min-height: 100svh;
			display: grid;
			grid-template-rows: auto 1fr auto;
			gap: 18px;
			padding: max(18px, env(safe-area-inset-top)) 18px max(18px, env(safe-area-inset-bottom));
		}
		header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
		.brand { display: flex; flex-direction: column; gap: 2px; }
		h1 { margin: 0; font-size: 20px; letter-spacing: 0; }
		p { margin: 0; color: #a5a5b3; font-size: 13px; line-height: 1.45; }
		.status {
			display: inline-flex;
			align-items: center;
			gap: 8px;
			padding: 8px 10px;
			border-radius: 999px;
			border: 1px solid rgba(255, 255, 255, 0.1);
			background: rgba(255, 255, 255, 0.06);
			font-size: 12px;
			font-weight: 700;
			color: #d8d8df;
			white-space: nowrap;
		}
		.status::before {
			content: "";
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: #f59e0b;
		}
		.status.live::before { background: #34d399; }
		.status.error::before { background: #f43f5e; }
		.previewWrap {
			position: relative;
			min-height: 0;
			border-radius: 28px;
			overflow: hidden;
			background: #050507;
			border: 1px solid rgba(255, 255, 255, 0.08);
			box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
		}
		video {
			display: block;
			width: 100%;
			height: 100%;
			min-height: 54svh;
			object-fit: cover;
			background: #050507;
		}
		.placeholder {
			position: absolute;
			inset: 0;
			display: grid;
			place-items: center;
			padding: 28px;
			text-align: center;
			color: #a5a5b3;
			pointer-events: none;
		}
		.placeholder.hidden { display: none; }
		.controls {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 10px;
		}
		button, input {
			width: 100%;
			min-height: 48px;
			border-radius: 14px;
			border: 1px solid rgba(255, 255, 255, 0.1);
			background: rgba(255, 255, 255, 0.08);
			color: #f4f4f7;
			font: inherit;
		}
		button {
			cursor: pointer;
			font-weight: 800;
		}
		button.primary {
			background: #3d8bff;
			border-color: #62a4ff;
			color: white;
		}
		button:disabled {
			opacity: 0.45;
			cursor: not-allowed;
		}
		.join {
			display: grid;
			gap: 12px;
			padding: 14px;
			border-radius: 18px;
			background: rgba(255, 255, 255, 0.06);
			border: 1px solid rgba(255, 255, 255, 0.08);
		}
		input {
			padding: 0 14px;
			text-transform: uppercase;
			letter-spacing: 0.08em;
			font-weight: 800;
			text-align: center;
		}
		.notice {
			padding: 12px 14px;
			border-radius: 16px;
			background: rgba(245, 158, 11, 0.12);
			border: 1px solid rgba(245, 158, 11, 0.22);
			color: #f8d28a;
			font-size: 12px;
			line-height: 1.45;
		}
		.notice.hidden { display: none; }
	</style>
</head>
<body>
	<main>
		<header>
			<div class="brand">
				<h1>Recordly Camera</h1>
				<p>Send this phone camera and mic to your laptop recording.</p>
			</div>
			<div id="status" class="status">Waiting</div>
		</header>

		<section class="previewWrap">
			<video id="preview" autoplay muted playsinline></video>
			<div id="placeholder" class="placeholder">Camera preview will appear here after permission is granted.</div>
		</section>

		<section class="join" id="joinPanel">
			<div id="secureNotice" class="notice hidden">
				This page is not running in a secure browser context. Most phones require HTTPS before camera and microphone permissions can work.
			</div>
			<input id="codeInput" placeholder="SESSION CODE" autocomplete="one-time-code" />
			<button id="connectButton" class="primary" type="button">Connect Phone</button>
		</section>

		<section class="controls">
			<button id="flipButton" type="button" disabled>Flip Camera</button>
			<button id="muteButton" type="button" disabled>Mute Mic</button>
		</section>
	</main>

	<script>
		(() => {
			const statusEl = document.getElementById("status");
			const previewEl = document.getElementById("preview");
			const placeholderEl = document.getElementById("placeholder");
			const codeInput = document.getElementById("codeInput");
			const connectButton = document.getElementById("connectButton");
			const flipButton = document.getElementById("flipButton");
			const muteButton = document.getElementById("muteButton");
			const secureNotice = document.getElementById("secureNotice");

			const params = new URLSearchParams(window.location.search);
			codeInput.value = (params.get("code") || "").toUpperCase();
			if (!window.isSecureContext) {
				secureNotice.classList.remove("hidden");
			}

			let session = null;
			let peer = null;
			let localStream = new MediaStream();
			let facingMode = "user";
			let laptopSignalIndex = 0;
			let pollTimer = 0;
			let heartbeatTimer = 0;
			let pendingLaptopIceCandidates = [];
			let muted = false;

			function setStatus(label, tone) {
				statusEl.textContent = label;
				statusEl.classList.toggle("live", tone === "live");
				statusEl.classList.toggle("error", tone === "error");
			}

			async function postJson(url, body) {
				const response = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				});
				if (!response.ok) {
					throw new Error(await response.text());
				}
				return response.json();
			}

			async function sendStatus(status, extra = {}) {
				if (!session) return;
				try {
					await postJson("/api/phone-remote/status", {
						code: session.code,
						status,
						...extra,
					});
				} catch (error) {
					console.warn("Failed to send status", error);
				}
			}

			async function sendSignal(message) {
				if (!session) return;
				await postJson("/api/phone-remote/signal", {
					code: session.code,
					message,
				});
			}

			function getLiveMediaState() {
				const hasVideo = localStream
					.getVideoTracks()
					.some((track) => track.readyState === "live" && !track.muted);
				const hasAudio = localStream
					.getAudioTracks()
					.some((track) => track.readyState === "live" && track.enabled && !track.muted);

				return { hasAudio, hasVideo };
			}

			function startHeartbeat() {
				window.clearInterval(heartbeatTimer);
				heartbeatTimer = window.setInterval(() => {
					const mediaState = getLiveMediaState();
					const status = mediaState.hasVideo
						? "preview-live"
						: mediaState.hasAudio
							? "mic-active"
							: "phone-connected";

					sendStatus(status, {
						...mediaState,
						facingMode,
					});
				}, 3000);
			}

			function getVideoConstraints() {
				return {
					facingMode,
					width: { ideal: 1280 },
					height: { ideal: 720 },
					frameRate: { ideal: 30, max: 30 },
				};
			}

			function getAudioConstraints() {
				return {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				};
			}

			async function requestCombinedMedia() {
				try {
					return await navigator.mediaDevices.getUserMedia({
						video: getVideoConstraints(),
						audio: getAudioConstraints(),
					});
				} catch (error) {
					console.warn("Combined camera/mic request failed", error);
					return null;
				}
			}

			async function requestCameraTrack() {
				try {
					const stream = await navigator.mediaDevices.getUserMedia({
						video: getVideoConstraints(),
						audio: false,
					});
					return stream.getVideoTracks()[0] || null;
				} catch (error) {
					await sendStatus("camera-permission-denied", {
						detail: error instanceof Error ? error.message : String(error),
					});
					return null;
				}
			}

			async function requestAudioTrack() {
				try {
					const stream = await navigator.mediaDevices.getUserMedia({
						video: false,
						audio: getAudioConstraints(),
					});
					return stream.getAudioTracks()[0] || null;
				} catch (error) {
					await sendStatus("microphone-permission-denied", {
						detail: error instanceof Error ? error.message : String(error),
					});
					return null;
				}
			}

			function replaceLocalStream(nextStream) {
				localStream.getTracks().forEach((track) => track.stop());
				localStream = nextStream;
				previewEl.srcObject = localStream;
				placeholderEl.classList.toggle("hidden", localStream.getVideoTracks().length > 0);
			}

			async function acquireMedia() {
				setStatus("Requesting permission", "");
				const nextStream = new MediaStream();
				const combinedStream = await requestCombinedMedia();
				let videoTrack = combinedStream?.getVideoTracks()[0] || null;
				let audioTrack = combinedStream?.getAudioTracks()[0] || null;

				if (!combinedStream) {
					videoTrack = await requestCameraTrack();
					audioTrack = await requestAudioTrack();
				}

				if (videoTrack) {
					nextStream.addTrack(videoTrack);
					videoTrack.onended = () => sendStatus("disconnected", { detail: "Camera track ended." });
					videoTrack.onmute = () => sendStatus("reconnecting", { detail: "Camera track muted." });
					videoTrack.onunmute = () => sendStatus("preview-live", { hasVideo: true });
				}
				if (audioTrack) {
					nextStream.addTrack(audioTrack);
					audioTrack.enabled = !muted;
					audioTrack.onended = () => sendStatus("no-audio-track", { detail: "Microphone track ended." });
					audioTrack.onmute = () => sendStatus("no-audio-track", { detail: "Microphone track muted." });
					audioTrack.onunmute = () => sendStatus("mic-active", { hasAudio: true });
				} else {
					await sendStatus("no-audio-track", { detail: "Phone connected without an audio track." });
				}

				replaceLocalStream(nextStream);
				flipButton.disabled = !videoTrack;
				muteButton.disabled = !audioTrack;
				setStatus(videoTrack ? "Preview live" : "Mic only", videoTrack || audioTrack ? "live" : "error");
				await sendStatus(videoTrack ? "preview-live" : "phone-connected", {
					hasAudio: Boolean(audioTrack),
					hasVideo: Boolean(videoTrack),
					facingMode,
				});
			}

			function ensurePeer() {
				if (peer) return peer;

				peer = new RTCPeerConnection({
					iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
				});
				peer.onicecandidate = (event) => {
					sendSignal({
						type: "ice-candidate",
						candidate: event.candidate ? event.candidate.toJSON() : null,
					}).catch((error) => console.warn("Failed to send ICE candidate", error));
				};
				peer.onconnectionstatechange = () => {
					if (!peer) return;
					if (peer.connectionState === "connected") {
						setStatus("Connected", "live");
						const mediaState = getLiveMediaState();
						sendStatus(mediaState.hasVideo ? "preview-live" : mediaState.hasAudio ? "mic-active" : "phone-connected", mediaState);
					} else if (peer.connectionState === "disconnected" || peer.connectionState === "failed") {
						setStatus("Reconnecting", "");
						sendStatus("reconnecting", { detail: peer.connectionState });
					} else if (peer.connectionState === "closed") {
						setStatus("Disconnected", "error");
						sendStatus("disconnected");
					}
				};

				localStream.getTracks().forEach((track) => {
					peer.addTrack(track, localStream);
				});
				return peer;
			}

			async function flushPendingLaptopIceCandidates(connection) {
				const candidates = pendingLaptopIceCandidates.splice(0);
				for (const candidate of candidates) {
					try {
						await connection.addIceCandidate(candidate);
					} catch (error) {
						console.warn("Failed to apply queued laptop ICE candidate", error);
					}
				}
			}

			async function handleLaptopSignal(message) {
				const connection = ensurePeer();
				if (message.type === "offer") {
					if (connection.signalingState !== "stable") {
						return;
					}
					await connection.setRemoteDescription(message.description);
					const answer = await connection.createAnswer();
					await connection.setLocalDescription(answer);
					await sendSignal({ type: "answer", description: answer });
					await flushPendingLaptopIceCandidates(connection);
					return;
				}
				if (message.type === "ice-candidate" && message.candidate) {
					if (!connection.remoteDescription) {
						pendingLaptopIceCandidates.push(message.candidate);
						return;
					}
					await connection.addIceCandidate(message.candidate);
				}
			}

			async function pollLaptopSignals() {
				if (!session) return;
				try {
					const response = await fetch(
						"/api/phone-remote/signals?code=" +
							encodeURIComponent(session.code) +
							"&after=" +
							encodeURIComponent(String(laptopSignalIndex)),
					);
					if (!response.ok) throw new Error(await response.text());
					const payload = await response.json();
					for (const envelope of payload.signals || []) {
						laptopSignalIndex = Math.max(laptopSignalIndex, envelope.index);
						await handleLaptopSignal(envelope.message);
					}
				} catch (error) {
					console.warn("Signal poll failed", error);
					setStatus("Reconnecting", "");
				} finally {
					pollTimer = window.setTimeout(pollLaptopSignals, 750);
				}
			}

			async function connect() {
				const code = codeInput.value.trim().toUpperCase();
				if (!code) {
					codeInput.focus();
					return;
				}

				connectButton.disabled = true;
				setStatus("Connecting", "");
				try {
					const response = await fetch("/api/phone-remote/session?code=" + encodeURIComponent(code));
					if (!response.ok) throw new Error(await response.text());
					const payload = await response.json();
					session = payload.session;
					await sendStatus("phone-connected");
					await acquireMedia();
					ensurePeer();
					startHeartbeat();
					connectButton.textContent = "Connected";
					window.clearTimeout(pollTimer);
					pollLaptopSignals();
				} catch (error) {
					setStatus("Connection failed", "error");
					connectButton.disabled = false;
					alert(error instanceof Error ? error.message : String(error));
				}
			}

			flipButton.addEventListener("click", async () => {
				if (!peer) return;
				facingMode = facingMode === "user" ? "environment" : "user";
				const nextVideoTrack = await requestCameraTrack();
				if (!nextVideoTrack) return;

				const oldVideoTrack = localStream.getVideoTracks()[0];
				const sender = peer.getSenders().find((candidate) => candidate.track && candidate.track.kind === "video");
				if (sender) {
					await sender.replaceTrack(nextVideoTrack);
				}
				if (oldVideoTrack) {
					localStream.removeTrack(oldVideoTrack);
					oldVideoTrack.stop();
				}
				localStream.addTrack(nextVideoTrack);
				previewEl.srcObject = localStream;
				await sendStatus("preview-live", { hasVideo: true, facingMode });
			});

			muteButton.addEventListener("click", async () => {
				muted = !muted;
				for (const track of localStream.getAudioTracks()) {
					track.enabled = !muted;
				}
				muteButton.textContent = muted ? "Unmute Mic" : "Mute Mic";
				await sendStatus(muted ? "phone-connected" : "mic-active", {
					detail: muted ? "Phone mic muted." : "Phone mic active.",
					hasAudio: !muted,
				});
			});

			connectButton.addEventListener("click", connect);
			document.addEventListener("visibilitychange", () => {
				if (document.visibilityState === "hidden") {
					sendStatus("phone-backgrounded", { detail: "Phone browser moved to the background." });
				} else {
					sendStatus("reconnecting", { detail: "Phone browser returned to the foreground." });
				}
			});
			window.addEventListener("pagehide", () => {
				window.clearInterval(heartbeatTimer);
				sendStatus("phone-sleeping", { detail: "Phone page is unloading or sleeping." });
			});

			if (codeInput.value) {
				connect().catch((error) => console.warn("Auto-connect failed", error));
			}
		})();
	</script>
</body>
</html>`;
}
