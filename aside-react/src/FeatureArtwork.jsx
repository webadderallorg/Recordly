import React from "react";
import ShareArtwork from "./ShareArtwork";
import DemoVideo from "./DemoVideo";

export default function FeatureArtwork({ feature, active = true }) {
	if (feature === "Automatic zooms" || feature === "Smooth cursor") {
		const name = feature === "Automatic zooms" ? "auto-zoom" : "cursor";
		return <div className="feature-frame feature-artwork">
			<DemoVideo enabled={active} className="feature-demo-video" src={`/assets/recordly-${name}-demo.mp4`}
				poster={`/assets/recordly-${name}-poster.jpg`} label={`${feature} demo`} width={960} height={600} />
		</div>;
	}
	if (feature === "Record") return (
		<div className="feature-frame feature-artwork">
			<img className="record-feature-screenshot" src="/assets/recordly-record-feature.png" alt="Recordly recording controls over a coastal desktop background" loading="lazy" width="1758" height="1044" />
		</div>
	);
	if (feature === "Preview") return (
		<div className="feature-frame feature-artwork">
			<img src="/assets/recordly-preview-feature.png" alt="Recordly video editor with background controls, video preview and zoom timeline" loading="lazy" width="2724" height="1704" />
		</div>
	);
	if (feature === "Share" || feature === "Share anywhere") return (
		<div className="feature-frame feature-artwork">
			<ShareArtwork />
		</div>
	);
	return <div className="feature-frame" aria-hidden="true" />;
}
