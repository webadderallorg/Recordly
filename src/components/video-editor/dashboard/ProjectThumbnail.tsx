import { Skeleton } from "@heroui/react";
import type { ProjectPreviewData } from "@/types/projectPreview";
import { ProjectHoverPreview } from "./ProjectHoverPreview";
import { ImageSquare } from "@/components/ui/icons";
import { useState, useEffect, useCallback, useRef } from "react";
import { toFileUrl } from "../projectPersistence";
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
	const [preview, setPreview] = useState<ProjectPreviewData | null>(null);
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
			void window.electronAPI
				.getProjectPreview(projectPath)
				.then((result) => {
					if (active && !document.hidden && result.success) setPreview(result.value);
				})
				.catch(() => undefined);
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
	}, [previewActive, projectPath, revision]);
	useEffect(() => {
		if (!videoSource || !host.current) return;
		const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
			rootMargin: "100px",
		});
		observer.observe(host.current);
		return () => observer.disconnect();
	}, [videoSource]);

	const sourceKey = `${path}:${revision}`;
	return (
		<div
			ref={host}
			className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-default/60"
		>
			{path && loadedSource !== sourceKey && failedSource !== sourceKey && (
				<Skeleton className="absolute inset-0 rounded-xl" />
			)}
			{path && failedSource !== sourceKey ? (
				<img
					src={
						/^(data:|blob:)/.test(path)
							? path
							: `${/^https?:/.test(path) ? path : toFileUrl(path)}?v=${revision}`
					}
					alt=""
					loading="lazy"
					draggable={false}
					onError={() => setFailedSource(sourceKey)}
					onLoad={() => setLoadedSource(sourceKey)}
					className="h-full w-full object-cover"
				/>
			) : videoSource && visible ? (
				<video
					src={videoSource}
					preload="metadata"
					muted
					playsInline
					tabIndex={-1}
					aria-hidden="true"
					className="pointer-events-none h-full w-full object-cover"
				/>
			) : (
				<ImageSquare weight="fill" className="size-8 text-muted-foreground/20" />
			)}
			{previewActive && preview && <ProjectHoverPreview data={preview} onFinish={finish} />}
		</div>
	);
}
