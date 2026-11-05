import React from "react";
import { LinkIcon } from "@solar-icons/react/linear/link";
import { CopyIcon } from "@solar-icons/react/linear/copy";
import { PlayIcon } from "@solar-icons/react/bold/play";
import "./SharingIllustration.css";

function RecordingPreview() {
	return (
		<div className="sharing-art-player">
			<div className="sharing-art-screen">
				<img src="/assets/recordly-hero-poster.jpg" width="1920" height="1222" alt="" loading="lazy" />
				<span className="sharing-art-hd">HD</span>
				<span className="sharing-art-play"><PlayIcon size="13" /></span>
			</div>
			<div className="sharing-art-controls">
				<PlayIcon size="8" />
				<span className="sharing-art-track"><span /></span>
				<span>0:24</span>
			</div>
		</div>
	);
}

function ShareLink() {
	return (
		<div className="sharing-art-link">
			<LinkIcon size="15" />
			<span>recordly.dev/s/intro</span>
			<span className="sharing-art-copy"><CopyIcon size="13" /></span>
		</div>
	);
}

export default function SharingIllustration() {
	return (
		<div className="sharing-art" aria-hidden="true">
			<div className="sharing-art-dots" />
			<div className="sharing-art-shadow" />
			<svg className="sharing-art-connector" viewBox="0 0 300 200" fill="none">
				<path d="M224 108H257C266 108 270 113 270 121V134C270 143 264 148 255 148H222" />
				<circle cx="257" cy="108" r="2.5" />
			</svg>
			<RecordingPreview />
			<ShareLink />
			<span className="sharing-art-confirmation"><span>✓</span>Link copied</span>
		</div>
	);
}
