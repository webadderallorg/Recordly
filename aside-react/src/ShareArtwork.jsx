import React from "react";
import { LinkIcon } from "@solar-icons/react/linear/link";
import { CopyIcon } from "@solar-icons/react/linear/copy";
import { PlayIcon } from "@solar-icons/react/bold/play";

export default function ShareArtwork() {
	return (
		<div className="share-artwork" role="img" aria-label="Recordly shared video preview with a shareable link">
			<div className="share-demo-panel" aria-hidden="true">
				<div className="share-demo-thumbnail">
					<img src="/assets/recordly-hero-poster.jpg" alt="" width="1920" height="1198" />
					<span className="share-demo-play"><PlayIcon size="1.4em" /></span>
				</div>
				<div className="share-demo-link">
					<LinkIcon size="1.45em" />
					<span>recordly.dev/s/demo</span>
					<span className="share-demo-copy"><CopyIcon size="1.3em" /></span>
				</div>
			</div>
		</div>
	);
}
