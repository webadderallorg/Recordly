import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MonitorIcon } from "@solar-icons/react/linear/monitor";
import { MicrophoneIcon } from "@solar-icons/react/linear/microphone";
import { VideocameraIcon } from "@solar-icons/react/linear/videocamera";
import { HomeIcon } from "@solar-icons/react/bold/home";
import { MenuDotsVerticalIcon } from "@solar-icons/react/bold/menu-dots-vertical";
import { PauseIcon } from "@solar-icons/react/bold/pause";
import { MinusIcon } from "@solar-icons/react/linear/minus";
import { CloseIcon } from "@solar-icons/react/linear/close";

function HudIcon({ icon: Icon, slash = false }) {
	return <span className="native-hud-icon">
		<Icon size={20} />
		{slash && <svg viewBox="0 0 24 24" fill="none"><path d="M4 4L20 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>}
	</span>;
}

function Control({ icon, slash = false, danger = false, children }) {
	return <span className={`native-hud-control${danger ? " native-hud-danger" : ""}`}>
		{icon ? <HudIcon icon={icon} slash={slash} /> : children}
	</span>;
}

function Countdown() {
	return <svg className="native-hud-countdown" viewBox="0 0 24 24" fill="none">
		<circle cx="12" cy="14" r="8.5" stroke="currentColor" strokeWidth="1.5" />
		<path d="M10 2h4M12 2v3.5M18.5 7.5 20 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		<text x="12" y="14.5" fill="currentColor" fontSize="9" fontWeight="600" textAnchor="middle" dominantBaseline="central">0</text>
	</svg>;
}

export default function RecordHudArtwork() {
	const [seconds, setSeconds] = useState(-1);
	const frameRef = useRef(null);
	const barRef = useRef(null);
	const [scale, setScale] = useState(.5);
	useLayoutEffect(() => {
		const frame = frameRef.current;
		const idleWidth = barRef.current.offsetWidth;
		const resize = () => setScale(Math.min(1, (frame.clientWidth - 24) / idleWidth));
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(frame);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
		let timer;
		const restart = () => {
			clearInterval(timer);
			setSeconds(-1);
			if (reducedMotion.matches) return;
			const started = performance.now();
			timer = setInterval(() => {
				const phase = (performance.now() - started) % 6000;
				setSeconds(phase < 1500 ? -1 : Math.min(3, Math.floor((phase - 1500) / 1000)));
			}, 100);
		};
		restart();
		reducedMotion.addEventListener("change", restart);
		return () => {
			clearInterval(timer);
			reducedMotion.removeEventListener("change", restart);
		};
	}, []);
	const recording = seconds >= 0;
	return (
		<div ref={frameRef} className="record-hud-demo" data-recording={recording} data-seconds={seconds}
			role="img" aria-label="Recordly recorder HUD changes to recording, counts to three seconds, then repeats">
			<div className="native-hud-position" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
				<div ref={barRef} className="native-hud-bar">
					<span className="native-hud-drag"><MenuDotsVerticalIcon size={18} /></span>
					{recording ? (
						<div key="recording" className="native-hud-controls native-hud-state">
							<Control icon={HomeIcon} />
							<span className="native-hud-timer"><i /><span>00:0{seconds}</span></span>
							<span className="native-hud-disabled"><Control icon={MicrophoneIcon} slash /></span>
							<span className="native-hud-separator" />
							<Control icon={PauseIcon} />
							<Control danger><span className="native-hud-stop" /></Control>
							<Control icon={MinusIcon} />
							<Control icon={CloseIcon} />
						</div>
					) : (
						<div key="idle" className="native-hud-controls native-hud-state">
							<span className="native-hud-source"><HudIcon icon={MonitorIcon} /><span>Pick source</span></span>
							<span className="native-hud-separator" />
							<Control icon={MicrophoneIcon} slash />
							<Control icon={VideocameraIcon} slash />
							<Control><Countdown /></Control>
							<Control danger><span className="native-hud-record" /></Control>
							<span className="native-hud-separator" />
							<Control icon={HomeIcon} />
							<Control icon={MinusIcon} />
							<Control icon={CloseIcon} />
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
