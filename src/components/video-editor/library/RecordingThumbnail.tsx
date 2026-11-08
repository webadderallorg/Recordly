import { useScopedT } from "@/contexts/I18nContext";
import { useEffect, useRef, useState } from "react";
import { FilmStrip } from "@/components/ui/icons";
import type { RecordingLibraryEntry } from "@/types/recordingLibrary";

import {
	loadRecordingThumbnail,
	peekRecordingThumbnail,
	recordingThumbnailKey,
} from "./recordingThumbnailCache";

export function RecordingThumbnail({ entry }: { entry: RecordingLibraryEntry }) {
	const te = useScopedT("editing");
	const host = useRef<HTMLSpanElement>(null);
	const key = recordingThumbnailKey(entry);
	const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);
	const [failedKey, setFailedKey] = useState<string | null>(null);
	const src = loaded?.key === key ? loaded.url : peekRecordingThumbnail(key);
	const failed = failedKey === key;
	useEffect(() => {
		if (src || failed) return;
		let active = true;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				observer.disconnect();
				void loadRecordingThumbnail(key, entry.path)
					.then((url) => {
						if (active) setLoaded({ key, url });
					})
					.catch(() => {
						if (active) setFailedKey(key);
					});
			},
			{ rootMargin: "400px" },
		);
		if (host.current) observer.observe(host.current);
		return () => {
			active = false;
			observer.disconnect();
		};
	}, [key, entry.path, src, failed]);
	return (
		<span
			ref={host}
			className="flex h-9 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-default text-muted-foreground"
		>
			{src && !failed ? (
				<img
					src={src}
					alt={te("previewOf", "Preview of {{name}}", { name: entry.name })}
					className="size-full object-cover"
					decoding="async"
					draggable={false}
					onError={() => {
						setFailedKey(key);
					}}
				/>
			) : failed ? (
				<FilmStrip
					className="size-5"
					aria-label={te("previewUnavailable", "Preview unavailable")}
				/>
			) : (
				<span
					className="size-full animate-pulse bg-default"
					aria-label={te("loadingPreviewImage", "Loading preview image")}
				/>
			)}
		</span>
	);
}
