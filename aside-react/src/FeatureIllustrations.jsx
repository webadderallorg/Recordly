import React from "react";
import { VideocameraIcon } from "@solar-icons/react/linear/videocamera";
import { DownloadIcon } from "@solar-icons/react/linear/download";
import { CloudCheckIcon } from "@solar-icons/react/linear/cloud-check";
import { LinkIcon } from "@solar-icons/react/linear/link";
import { PlayIcon } from "@solar-icons/react/bold/play";
import "./FeatureIllustrations.css";

const posters = {
	walkthrough: "/assets/recordly-hero-poster.jpg",
	zoom: "/assets/recordly-auto-zoom-poster.jpg",
	cursor: "/assets/recordly-cursor-poster.jpg",
};

function IllustrationStage({ feature, children }) {
	return (
		<div className={`coded-art coded-art-${feature}`} aria-hidden="true">
			<div className="coded-art-dots" />
			<div className="coded-art-shadow" />
			{children}
		</div>
	);
}

function RecordingThumbnail({ poster = posters.walkthrough }) {
	return <img className="coded-thumbnail" src={poster} width="1920" height="1222" alt="" loading="lazy" />;
}

function WindowChrome({ title }) {
	return <div className="coded-window-chrome"><span className="coded-window-dots"><i /><i /><i /></span><span>{title}</span></div>;
}

function CameraPortrait() {
	return <div className="coded-person"><span className="coded-person-head" /><span className="coded-person-body" /></div>;
}

export function WebcamIllustration() {
	return (
		<IllustrationStage feature="webcam">
			<svg className="coded-connector" viewBox="0 0 300 200" fill="none"><path d="M126 161H157Q164 161 164 154V140Q164 133 172 133H207" /><circle cx="164" cy="151" r="2.5" /></svg>
			<div className="coded-webcam-preview coded-panel">
				<WindowChrome title="Recording" />
				<div className="coded-webcam-screen"><RecordingThumbnail /></div>
			</div>
			<div className="coded-webcam-overlay">
				<CameraPortrait />
				{["nw", "ne", "sw", "se"].map((corner) => <i className={`coded-resize coded-resize-${corner}`} key={corner} />)}
				<span className="coded-webcam-camera"><VideocameraIcon size="10" /></span>
			</div>
			<div className="coded-webcam-settings coded-panel">
				<strong><VideocameraIcon size="11" />Webcam</strong>
				<div><span>Mirror</span><span className="coded-switch"><i /></span></div>
				<div><span>Shape</span><span className="coded-shapes"><i /><i /></span></div>
			</div>
			<span className="coded-tag coded-webcam-tag"><i />Webcam on</span>
		</IllustrationStage>
	);
}

export function CaptionsIllustration() {
	return (
		<IllustrationStage feature="captions">
			<div className="coded-caption-preview coded-panel">
				<WindowChrome title="Preview" />
				<div className="coded-caption-screen"><RecordingThumbnail /><span className="coded-caption-line">Make your <em>words</em> count.</span></div>
			</div>
			<div className="coded-caption-wave">
				{[8, 14, 22, 12, 28, 18, 10, 24, 32, 15, 22, 12].map((height, index) => <i style={{ "--bar-height": height }} key={index} />)}
			</div>
			<div className="coded-caption-list coded-panel">
				<strong>Captions <span>3</span></strong>
				<div className="coded-caption-cue is-active"><span>0:01</span><p>Make your <em>words</em> count.</p></div>
				<div className="coded-caption-cue"><span>0:04</span><p>Say it clearly.</p></div>
			</div>
			<span className="coded-caption-generate">✓ Captions generated</span>
		</IllustrationStage>
	);
}

export function ExportIllustration() {
	return (
		<IllustrationStage feature="export">
			<svg className="coded-connector" viewBox="0 0 300 200" fill="none"><path d="M82 101H142" /><circle cx="123" cy="101" r="2.5" /></svg>
			<div className="coded-export-video coded-panel"><RecordingThumbnail /><span><PlayIcon size="9" /><i />0:24</span></div>
			<div className="coded-export-settings coded-panel">
				<strong>Export</strong>
				<span className="coded-setting-label">Format</span>
				<div className="coded-export-formats"><span className="is-selected">MP4</span><span>GIF</span></div>
				<span className="coded-setting-label">Resolution</span>
				<div className="coded-export-resolutions">{["HD", "FHD", "QHD", "4K"].map((label) => <span className={label === "4K" ? "is-selected" : ""} key={label}>{label}</span>)}</div>
				<div className="coded-export-fps"><span>FPS</span><span>30 <b>60</b></span></div>
				<span className="coded-export-action"><DownloadIcon size="10" />Export video</span>
			</div>
		</IllustrationStage>
	);
}

export function CloudIllustration() {
	const recordings = [
		{ title: "Walkthrough", poster: posters.walkthrough, time: "0:24" },
		{ title: "Quick update", poster: posters.zoom, time: "0:12" },
		{ title: "Product demo", poster: posters.cursor, time: "0:31" },
	];
	return (
		<IllustrationStage feature="cloud">
			<svg className="coded-connector" viewBox="0 0 300 200" fill="none"><path d="M221 74H265Q273 74 273 66V47" /><circle cx="250" cy="74" r="2.5" /></svg>
			<div className="coded-library coded-panel">
				<div className="coded-library-heading"><strong>Shared links</strong><span>3 recordings</span></div>
				<div className="coded-library-grid">{recordings.map((recording) => (
					<div className="coded-library-card" key={recording.title}>
						<div className="coded-library-thumbnail"><RecordingThumbnail poster={recording.poster} /><span>{recording.time}</span></div>
						<strong>{recording.title}</strong>
						<div><span>Today</span><LinkIcon size="9" /></div>
					</div>
				))}</div>
			</div>
			<span className="coded-library-cloud coded-panel"><CloudCheckIcon size="27" /></span>
			<span className="coded-tag coded-library-tag"><span>✓</span>Ready to share</span>
		</IllustrationStage>
	);
}
