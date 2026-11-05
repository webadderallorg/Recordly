export function getExportFileName(projectName: string | undefined, format: "mp4" | "gif") {
	// Preserve readable titles, while keeping the suggested name valid on both platforms.
	const title =
		(projectName ?? "")
			.replace(/[<>:"/\\|?*\p{Cc}]/gu, "-")
			.trim()
			.replace(/[. ]+$/, "") || "Untitled Project";
	const safeTitle = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(title)
		? `_${title}`
		: title;
	return `${safeTitle}.${format}`;
}
