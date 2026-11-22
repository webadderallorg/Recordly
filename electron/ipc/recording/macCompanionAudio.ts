import path from "node:path";

export type MacCompanionAudioSuffix = "system" | "mic";

export function getFinalMacCompanionAudioPath(
	videoPath: string,
	sourceAudioPath: string,
	suffix: MacCompanionAudioSuffix,
) {
	const separatorIndex = Math.max(videoPath.lastIndexOf("/"), videoPath.lastIndexOf("\\"));
	const videoDirectory = separatorIndex >= 0 ? videoPath.slice(0, separatorIndex + 1) : "";
	const videoFileName = separatorIndex >= 0 ? videoPath.slice(separatorIndex + 1) : videoPath;
	const videoPathWithoutExt = `${videoDirectory}${path.parse(videoFileName).name}`;
	const sourceExtension = path.extname(sourceAudioPath).toLowerCase() || ".m4a";
	return `${videoPathWithoutExt}.${suffix}${sourceExtension}`;
}
