export type ExportLoadingMessage = string | readonly string[];

export const EXPORT_LOADING_MESSAGES: readonly ExportLoadingMessage[] = [
	"Reticulating splines...",
	"Try licking your elbow while reading this.",
	"keep calm and npm install",
	"Are we there yet?",
	"Just count to 10",
	"Dividing by zero...",
	["Updating Updater...", "Downloading Downloader...", "Debugging Debugger..."],
	"One mississippi, two mississippi...",
	"TODO: Insert elevator music",
	"You are number 2843684714 in the queue",
	"When nothing is going right, go left",
	"Resistance is Futile",
	"Grrr. Bark. Bark. Grrr",
	"Don't Panic",
	"Rendering your frames...",
	"Applying your edits...",
	"Compositing the scene...",
	"Stitching it all together...",
	"Polishing every pixel...",
	"Hang tight, your export is on its way.",
	"Longer recordings take a little longer.",
	"Higher quality takes a few more seconds.",
	"Good things take a moment.",
	"Processing your video...",
	"Working through your timeline...",
	"Building your video frame by frame...",
	"Encoding video frames...",
	"Bringing everything together...",
	"Preparing your file...",
	"Still working on it...",
	"Thanks for your patience.",
];

export function shuffleExportLoadingMessages(messages: readonly ExportLoadingMessage[]) {
	const order = [...messages];
	for (let i = order.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}
	return order.flat();
}
