import React from "react";
import SharingIllustration from "./SharingIllustration";
import { WebcamIllustration, CaptionsIllustration, ExportIllustration, CloudIllustration } from "./FeatureIllustrations";

const illustrations = {
	webcam: WebcamIllustration,
	captions: CaptionsIllustration,
	export: ExportIllustration,
	sharing: SharingIllustration,
	cloud: CloudIllustration,
};

export default function BentoArtwork({ feature }) {
	const Illustration = illustrations[feature];
	return Illustration ? <Illustration /> : null;
}
