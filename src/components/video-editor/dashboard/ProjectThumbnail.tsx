import { Skeleton } from "@heroui/react";
import type { ProjectPreviewData } from "@/types/projectPreview";
import { PROJECT_THUMBNAIL_RENDER_VERSION } from "@/lib/projectThumbnail";
import { ProjectHoverPreview } from "./ProjectHoverPreview";
import { ImageSquare } from "@/components/ui/icons";
import { useState, useEffect, useCallback, useRef } from "react";
import { normalizeProjectEditor } from "../projectPersistence";
import { getTimelineDurationMs } from "../types";
import { generateProjectThumbnail } from "./generateProjectThumbnail";
import { getOrCreateProjectThumbnail, peekProjectThumbnail } from "./projectThumbnailCache";
import { DurationBadge } from "./DurationBadge";
import { useProjectThumbnailUrl } from "./useProjectThumbnailUrl";
export function ProjectThumbnail({
	path,
	projectPath,
	previewActive = false,
	revision = 0,
	videoSource,
}: {
	path: string | null;
	projectPath?: string;
	previewActive?: boolean;
	revision?: number;
	videoSource?: string;
}) {
	const [loadedSource, setLoadedSource] = useState<string | null>(null);
	const [failedSource, setFailedSource] = useState<string | null>(null);
	const [visible, setVisible] = useState(false);
	const thumbnailSource = useProjectThumbnailUrl(path, revision, visible);
	const sourceKey = `${path}:${revision}`;
	const sourceFailed = failedSource === sourceKey || thumbnailSource.failed;
	const cacheKey = `${PROJECT_THUMBNAIL_RENDER_VERSION}:${projectPath ?? videoSource}:${revision}`;
	const [preview, setPreview] = useState<ProjectPreviewData | null>(null);
	const [metadataState, setMetadataState] = useState<{
		key: string;
		value: ProjectPreviewData;
	} | null>(null);
	const metadata = metadataState?.key === cacheKey ? metadataState.value : null;
	const [sourceDuration, setSourceDuration] = useState<number | undefined>(
		() => peekProjectThumbnail(cacheKey)?.duration,
	);
	const [generated, setGenerated] = useState(() => {
		const cached = peekProjectThumbnail(cacheKey);
		return cached ? { key: cacheKey, ...cached } : null;
	});
	const generatedThumbnail = generated?.key === cacheKey ? generated.url : null;
	const duration = metadata
		? getTimelineDurationMs(
				normalizeProjectEditor(metadata.project.editor).clipRegions,
				(sourceDuration ?? 0) * 1000,
			) / 1000
		: sourceDuration;
	const metadataSource = videoSource ?? metadata?.videoUrl;
	const [failedGenerationKey, setFailedGenerationKey] = useState<string | null>(null);
	const needsThumbnail = !path || sourceFailed;
	useEffect(() => {
		if (
			!visible ||
			!needsThumbnail ||
			!metadataSource ||
			generatedThumbnail ||
			failedGenerationKey === cacheKey
		)
			return;
		let active = true;
		void getOrCreateProjectThumbnail(cacheKey, async () => {
			const thumbnail = await generateProjectThumbnail(metadataSource, metadata);
			if (projectPath && metadata?.revision) {
				// Cache writes are optional: an unwritable/offline project still gets its preview.
				void window.electronAPI
					.cacheProjectThumbnail?.(projectPath, metadata.revision, thumbnail.url)
					.catch(() => undefined);
			}
			return thumbnail;
		})
			.then((thumbnail) => {
				if (active) {
					setGenerated({ key: cacheKey, ...thumbnail });
					setSourceDuration(thumbnail.duration);
				}
			})
			.catch(() => {
				if (active) setFailedGenerationKey(cacheKey);
			});
		return () => {
			active = false;
		};
	}, [
		visible,
		needsThumbnail,
		metadataSource,
		metadata,
		cacheKey,
		projectPath,
		generatedThumbnail,
		failedGenerationKey,
	]);
	useEffect(() => {
		// A refreshed project must not replay the previous revision's source/settings.
		setMetadataState(null);
		setPreview(null);
		setFailedGenerationKey(null);
		setSourceDuration(peekProjectThumbnail(cacheKey)?.duration);
	}, [cacheKey]);
	const host = useRef<HTMLDivElement>(null);
	const finish = useCallback(() => setPreview(null), []);
	useEffect(() => {
		if (
			!previewActive ||
			!projectPath ||
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		)
			return;
		let active = true;
		const timer = window.setTimeout(() => {
			if (metadata && active && !document.hidden) setPreview(metadata);
		}, 300);
		const observer = new IntersectionObserver((entries) => {
			if (entries.every((entry) => !entry.isIntersecting)) {
				active = false;
				setPreview(null);
			}
		});
		if (host.current) observer.observe(host.current);
		return () => {
			active = false;
			clearTimeout(timer);
			observer.disconnect();
			setPreview(null);
		};
	}, [previewActive, projectPath, metadata]);
	useEffect(() => {
		if (!host.current) return;
		const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
			rootMargin: "800px",
		});
		observer.observe(host.current);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		if (!visible || !projectPath || metadata) return;
		let active = true;
		void window.electronAPI
			.getProjectPreview(projectPath)
			.then((result) => {
				if (active) {
					if (result.success) setMetadataState({ key: cacheKey, value: result.value });
					else setFailedGenerationKey(cacheKey);
				}
			})
			.catch(() => {
				if (active) setFailedGenerationKey(cacheKey);
			});
		return () => {
			active = false;
		};
	}, [visible, projectPath, metadata, cacheKey]);

	return (
		<div
			ref={host}
			className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-default/60"
		>
			{((path && loadedSource !== sourceKey && !sourceFailed) ||
				(needsThumbnail &&
					!generatedThumbnail &&
					failedGenerationKey !== cacheKey &&
					(projectPath || videoSource))) && (
				<Skeleton className="absolute inset-0 rounded-xl" />
			)}
			{path && !sourceFailed ? (
				thumbnailSource.url ? (
					<img
						src={thumbnailSource.url}
						alt=""
						loading={visible ? "eager" : "lazy"}
						decoding="async"
						draggable={false}
						onError={() => setFailedSource(sourceKey)}
						onLoad={() => setLoadedSource(sourceKey)}
						className={`h-full w-full object-cover${loadedSource === sourceKey ? " loading-content-enter" : " opacity-0"}`}
					/>
				) : null
			) : generatedThumbnail ? (
				<img
					src={generatedThumbnail}
					alt=""
					draggable={false}
					className="loading-content-enter h-full w-full object-cover"
				/>
			) : videoSource && visible ? (
				<video
					src={videoSource}
					preload="metadata"
					onLoadedMetadata={(event) => setSourceDuration(event.currentTarget.duration)}
					onDurationChange={(event) => setSourceDuration(event.currentTarget.duration)}
					muted
					playsInline
					tabIndex={-1}
					aria-hidden="true"
					className="pointer-events-none h-full w-full object-cover"
				/>
			) : needsThumbnail &&
				failedGenerationKey !== cacheKey &&
				(projectPath || videoSource) ? null : (
				<ImageSquare weight="fill" className="size-8 text-muted-foreground/20" />
			)}
			{previewActive && preview && preview === metadata && (
				<ProjectHoverPreview key={cacheKey} data={preview} onFinish={finish} />
			)}
			{visible &&
				metadataSource &&
				((path && !sourceFailed) || !videoSource) &&
				(!duration || !Number.isFinite(duration)) && (
					<video
						src={metadataSource}
						preload="metadata"
						muted
						playsInline
						aria-hidden="true"
						className="hidden"
						onLoadedMetadata={(event) =>
							setSourceDuration(event.currentTarget.duration)
						}
						onDurationChange={(event) =>
							setSourceDuration(event.currentTarget.duration)
						}
					/>
				)}
			<DurationBadge seconds={duration} />
		</div>
	);
}
