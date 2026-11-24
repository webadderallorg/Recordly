export type ExportLoadingMessage = string | readonly string[];

export const SENSIBLE_EXPORT_LOADING_MESSAGES: readonly ExportLoadingMessage[] = [
	"Preparing your video...",
	"Processing your recording...",
	"Working through the timeline...",
	"Rendering frames...",
	"Compositing layers...",
	"Applying backgrounds...",
	"Stitching segments together...",
	"Fine-tuning colors...",
	"Encoding video...",
	"Encoding audio...",
	"Mixing audio tracks...",
	"Syncing audio and video...",
	"Preserving image quality...",
	"Optimizing file size...",
	"Writing video data...",
	"Packaging the final file...",
	"Thanks for your patience...",
];

export const SILLY_EXPORT_LOADING_MESSAGES: readonly ExportLoadingMessage[] = [
	"Reticulating splines...",
	["Updating Updater...", "Downloading Downloader...", "Debugging Debugger..."],
	"One mississippi, two mississippi...",
	"TODO: Insert elevator music",
];

export const EXPORT_LOADING_MESSAGES: readonly ExportLoadingMessage[] = [
	...SENSIBLE_EXPORT_LOADING_MESSAGES,
	...SILLY_EXPORT_LOADING_MESSAGES,
];

export function shuffleExportLoadingMessages(messages: readonly ExportLoadingMessage[]) {
	const order = [...messages];
	for (let i = order.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}
	return order.flat();
}
