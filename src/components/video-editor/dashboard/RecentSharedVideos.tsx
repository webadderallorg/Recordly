import { Button } from "@heroui/react";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { toast } from "@/components/ui/toast";
import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import { subscribeShareCapacityChanges } from "../cloud/shareCapacity";
import { parseSharedRecordingDate } from "../cloud/sharedRecordingDate";
import { ProjectThumbnail } from "./ProjectThumbnail";
import {
	peekRecentSharedVideos,
	readRecentSharedVideos,
	type SharedVideo,
	sharedVideoCacheKey,
} from "./recentSharedVideoCache";

export function RecentSharedVideos({
	token,
	endpoint,
	accountId,
	onViewAll,
}: {
	token: string;
	endpoint: string;
	accountId?: string;
	onViewAll: () => void;
}) {
	const { t: uiText } = useUiLocale();
	const cacheKey = sharedVideoCacheKey(endpoint, accountId ?? token);
	const [videos, setVideos] = useState<SharedVideo[]>(
		() => peekRecentSharedVideos(cacheKey) ?? [],
	);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();
	const generation = useRef(0);
	const track = useRef<HTMLUListElement>(null);
	const [edges, setEdges] = useState({ left: false, right: false });
	useEffect(() => {
		if (!loading && !error && !videos.length) return;
		const element = track.current;
		if (!element) return;
		const updateEdges = () => {
			setEdges({
				left: element.scrollLeft > 1,
				right: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
			});
		};
		updateEdges();
		element.addEventListener("scroll", updateEdges, { passive: true });
		const observer = new ResizeObserver(updateEdges);
		observer.observe(element);
		return () => {
			element.removeEventListener("scroll", updateEdges);
			observer.disconnect();
		};
	}, [videos, loading, error]);
	const refresh = useCallback(
		async (fresh = false) => {
			const current = ++generation.current;
			setLoading(true);
			try {
				const result = await readRecentSharedVideos(cacheKey, endpoint, token, fresh);
				if (current !== generation.current) return;
				setVideos(result);
				setError(undefined);
			} catch (cause) {
				if (current === generation.current)
					setError(cause instanceof Error ? cause.message : String(cause));
			} finally {
				if (current === generation.current) setLoading(false);
			}
		},
		[token, endpoint, cacheKey],
	);
	useEffect(() => {
		void refresh();
		const unsubscribe = subscribeShareCapacityChanges(() => void refresh(true));
		const onFocus = () => void refresh(true);
		window.addEventListener("focus", onFocus);
		return () => {
			generation.current++;
			unsubscribe();
			window.removeEventListener("focus", onFocus);
		};
	}, [refresh]);
	const scroll = (direction: number) =>
		track.current?.scrollBy({
			left: direction * Math.max(260, track.current.clientWidth * 0.8),
			behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
				? "instant"
				: "smooth",
		});
	const openVideo = async (video: SharedVideo) => {
		try {
			const result = await window.electronAPI.openExternalUrl(video.url);
			if (!result.success)
				throw new Error(result.error || uiText("ui.couldNotOpenSharedVideo"));
		} catch (cause) {
			toast.error(cause instanceof Error ? cause.message : String(cause));
		}
	};
	const failure = error && (
		<div className="text-xs text-muted">
			<div className="flex flex-wrap items-center gap-2">
				<span role="status">{uiText("ui.couldNotLoadSharedVideos")}</span>
				<Button
					variant="ghost"
					size="sm"
					onPress={() => void refresh(true)}
					isDisabled={loading}
				>
					{uiText("ui.retry")}
				</Button>
				<details className="min-w-0">
					<summary className="cursor-pointer underline focus-visible:outline-2 focus-visible:outline-accent">
						{uiText("ui.technicalDetails")}
					</summary>
					<p className="my-2 select-text whitespace-pre-wrap [overflow-wrap:anywhere]">
						{error}
					</p>
					<ErrorReportButton error={error} context="cloud-library" />
				</details>
			</div>
		</div>
	);
	if (!videos.length) {
		return failure ? (
			<section aria-label={uiText("ui.recentlySharedVideos")} className="mb-3 min-w-0">
				{failure}
			</section>
		) : null;
	}
	return (
		<section aria-label={uiText("ui.recentlySharedVideos")} className="mb-8 min-w-0">
			<div className="mb-4 flex items-center justify-between gap-3">
				<h2 className="text-lg font-medium text-foreground">
					{uiText("ui.recentlyShared")}
				</h2>
				<div className="flex items-center gap-1">
					<Button variant="ghost" size="sm" onPress={onViewAll}>
						{uiText("ui.viewAll")}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						isIconOnly
						aria-label={uiText("ui.previousSharedVideos")}
						onPress={() => scroll(-1)}
					>
						<ArrowLeft size={18} />
					</Button>
					<Button
						variant="ghost"
						size="sm"
						isIconOnly
						aria-label={uiText("ui.nextSharedVideos")}
						onPress={() => scroll(1)}
					>
						<ArrowRight size={18} />
					</Button>
				</div>
			</div>
			{failure}
			<ul
				ref={track}
				aria-label={uiText("ui.sharedVideoCarousel")}
				tabIndex={0}
				className="custom-scrollbar flex snap-x snap-mandatory gap-5 overflow-x-auto pb-3 focus-visible:outline-2 focus-visible:outline-accent"
				aria-busy={loading}
				style={{
					maskImage:
						edges.left || edges.right
							? `linear-gradient(to right, ${edges.left ? "transparent, black 32px" : "black"}, ${edges.right ? "black calc(100% - 32px), transparent" : "black"})`
							: undefined,
				}}
			>
				{videos.map((video) => (
					<li key={video.code} className="w-60 shrink-0 snap-start">
						<button
							type="button"
							className="w-full rounded-xl text-left outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
							aria-label={uiText("ui.openSharedVideo", undefined, {
								name: video.title,
							})}
							onClick={() => void openVideo(video)}
						>
							<ProjectThumbnail
								path={
									new URL(`/thumb/${encodeURIComponent(video.code)}`, endpoint)
										.href
								}
								revision={parseSharedRecordingDate(video.createdAt)}
							/>
							<p className="mt-3 truncate text-sm font-medium text-foreground">
								{video.title}
							</p>
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}
