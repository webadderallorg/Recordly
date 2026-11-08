import { LocalizedError } from "@/components/feedback/LocalizedError";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import { Button, Skeleton } from "@heroui/react";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { subscribeShareCapacityChanges } from "../cloud/shareCapacity";
import { parseSharedRecordingDate } from "../cloud/sharedRecordingDate";
import { ProjectThumbnail } from "./ProjectThumbnail";

type SharedVideo = {
	code: string;
	title: string;
	url: string;
	ready: boolean;
	createdAt?: string;
};

export function RecentSharedVideos({
	token,
	endpoint,
	onViewAll,
}: {
	token: string;
	endpoint: string;
	onViewAll: () => void;
}) {
	const { t: uiText } = useUiLocale();
	const [videos, setVideos] = useState<SharedVideo[]>([]);
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
	const refresh = useCallback(async () => {
		const current = ++generation.current;
		setLoading(true);
		setError(undefined);
		try {
			const result = await window.electronAPI.cloudShareManage({
				token,
				endpoint,
				action: "list",
			});
			if (current !== generation.current) return;
			if (!result.success)
				throw new Error(result.error || uiText("ui.couldNotLoadSharedVideos"));
			setVideos(
				(result.videos ?? [])
					.filter((video) => video.ready)
					.sort(
						(a, b) =>
							parseSharedRecordingDate(b.createdAt) -
							parseSharedRecordingDate(a.createdAt),
					)
					.slice(0, 12),
			);
		} catch (cause) {
			if (current === generation.current)
				setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (current === generation.current) setLoading(false);
		}
	}, [token, endpoint, uiText]);
	useEffect(() => {
		void refresh();
		const unsubscribe = subscribeShareCapacityChanges(() => void refresh());
		const onFocus = () => void refresh();
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
	if (!loading && !error && !videos.length) return null;
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
						isDisabled={!videos.length}
					>
						<ArrowLeft size={18} />
					</Button>
					<Button
						variant="ghost"
						size="sm"
						isIconOnly
						aria-label={uiText("ui.nextSharedVideos")}
						onPress={() => scroll(1)}
						isDisabled={!videos.length}
					>
						<ArrowRight size={18} />
					</Button>
				</div>
			</div>
			{error && (
				<div role="status" className="mb-3 flex items-center gap-3 text-sm text-muted">
					<LocalizedError error={error} summary={uiText("ui.couldNotLoadSharedVideos")} />
					<ErrorReportButton error={error} context="cloud-library" />
					<Button
						variant="ghost"
						size="sm"
						onPress={() => void refresh()}
						isDisabled={loading}
					>
						{uiText("ui.retry")}
					</Button>
				</div>
			)}
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
				{loading && !videos.length
					? [0, 1, 2].map((key) => (
							<li key={key} className="w-60 shrink-0">
								<Skeleton className="aspect-[4/3] rounded-xl" />
								<Skeleton className="mt-3 h-4 w-40 rounded" />
							</li>
						))
					: videos.map((video) => (
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
											new URL(
												`/thumb/${encodeURIComponent(video.code)}`,
												endpoint,
											).href
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
