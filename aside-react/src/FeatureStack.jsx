import React from "react";
import BentoArtwork from "./BentoArtwork";
import "./FeatureBento.css";

const features = [
	{
		id: "webcam",
		title: "Put a face to your story",
		description: "Add a webcam overlay and make it your own with flexible sizing and positioning.",
	},
	{
		id: "captions",
		title: "Let your words show",
		description: "Generate captions from your audio, then fine-tune the words to get them just right.",
	},
	{
		id: "export",
		title: "Export up to 4K",
		description: "Save your recording as an MP4 video or a looping GIF, in resolutions up to 4K.",
	},
	{
		id: "sharing",
		title: "Share in high definition",
		description: "Upload your video and share a link to watch it in high definition.",
	},
	{
		id: "cloud",
		title: "All your recordings",
		description: "Keep your recordings together in the cloud and ready to share.",
	},
];

export default function FeatureStack() {
	return (
		<div className="feature-bento">
			<div className="feature-bento-heading">
				<h2>Everything for a better recording.</h2>
				<p>From the first click to the link you send.</p>
			</div>
			<div className="feature-bento-grid">
				{features.map(({ id, title, description }) => (
					<article className={`feature-bento-card feature-bento-${id}`} key={id} aria-labelledby={`feature-${id}`}>
						<div className="feature-bento-media"><BentoArtwork feature={id} /></div>
						<div className="feature-bento-copy">
							<h3 id={`feature-${id}`}>{title}</h3>
							<p>{description}</p>
						</div>
					</article>
				))}
			</div>
		</div>
	);
}
