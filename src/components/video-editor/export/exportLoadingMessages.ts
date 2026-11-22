export type ExportLoadingMessage = string | readonly string[];

// Keep roughly 80% sensible / 20% silly by line count (multi-line entries count per line).
export const SENSIBLE_EXPORT_LOADING_MESSAGES: readonly ExportLoadingMessage[] = [
	"Preparing your video...",
	"Processing your recording...",
	"Working through the timeline...",
	"Rendering frames...",
	"Rendering each frame with care...",
	"Compositing layers...",
	"Laying out the frame...",
	"Applying backgrounds...",
	"Applying zoom effects...",
	"Smoothing cursor movement...",
	"Polishing transitions...",
	"Stitching segments together...",
	"Fine-tuning colors...",
	"Tidying up the edges...",
	"Crunching pixels...",
	"Matching the frame rate...",
	"Encoding video...",
	"Encoding audio...",
	"Mixing audio tracks...",
	"Syncing audio and video...",
	"Balancing quality and speed...",
	"Preserving image quality...",
	"Optimizing file size...",
	"Writing video data...",
	"Assembling the final cut...",
	"Checking everything lines up...",
	"Double-checking the output...",
	"Adding finishing touches...",
	"Packaging the final file...",
	"Getting your video ready to share...",
	"Longer recordings take a little more time.",
	"Thanks for your patience...",
];

export const SILLY_EXPORT_LOADING_MESSAGES: readonly ExportLoadingMessage[] = [
	"Reticulating splines...",
	["Updating Updater...", "Downloading Downloader...", "Debugging Debugger..."],
	"Are we there yet?",
	"One mississippi, two mississippi...",
	"TODO: Insert elevator music",
	"Don't Panic",
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
