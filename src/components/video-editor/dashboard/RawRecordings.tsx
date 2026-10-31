import { Modal } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { MusicNotes } from "@/components/ui/icons";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import type { RecordingLibraryEntry } from "@/types/recordingLibrary";
const isAudio = (name: string) => /\.(wav|m4a|mp3|ogg|flac)$/i.test(name);
export function RawThumbnail({ entry, active }: { entry: RecordingLibraryEntry; active: boolean }) {
	const video = useRef<HTMLVideoElement>(null);
	const [poster, setPoster] = useState<string>();
	useEffect(() => {
		let active = true;
		if (!isAudio(entry.name))
			void window.electronAPI
				.getRecordingThumbnail(entry.path)
				.then((result) => {
					if (active && result.success) setPoster(result.value);
				})
				.catch(() => undefined);
		return () => {
			active = false;
		};
	}, [entry.path, entry.name]);
	useEffect(() => {
		const element = video.current;
		if (!element) return;
		if (!active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			element.pause();
			element.currentTime = 0;
			return;
		}
		const timer = window.setTimeout(() => {
			element.currentTime = 0;
			void element.play().catch(() => undefined);
		}, 300);
		const stop = () => {
			if (document.hidden) element.pause();
		};
		document.addEventListener("visibilitychange", stop);
		return () => {
			clearTimeout(timer);
			element.pause();
			document.removeEventListener("visibilitychange", stop);
		};
	}, [active]);
	return (
		<div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-default/60">
			{isAudio(entry.name) ? (
				<MusicNotes weight="fill" className="size-8 text-muted-foreground/40" />
			) : (
				<video
					ref={video}
					poster={poster}
					src={entry.url}
					muted
					playsInline
					preload="metadata"
					className="h-full w-full object-cover"
					onTimeUpdate={(event) => {
						if (event.currentTarget.currentTime >= 5) event.currentTarget.pause();
					}}
				/>
			)}
		</div>
	);
}
export function RawPreview({
	entry,
	onClose,
}: {
	entry: ProjectLibraryEntry | null;
	onClose: () => void;
}) {
	return (
		<Modal
			isOpen={!!entry}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<Modal.Backdrop>
				<Modal.Container size="lg">
					<Modal.Dialog aria-label="Raw file preview">
						<Modal.CloseTrigger />
						<Modal.Header>
							<Modal.Heading>{entry?.name}</Modal.Heading>
						</Modal.Header>
						<Modal.Body>
							{entry?.rawSource &&
								(isAudio(entry.rawSource.name) ? (
									<audio controls src={entry.rawSource.url} className="w-full" />
								) : (
									<video
										controls
										src={entry.rawSource.url}
										className="max-h-[65vh] w-full rounded-xl"
									/>
								))}
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
