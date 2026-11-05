import { LocalizedError } from "@/components/feedback/LocalizedError";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import { Alert, Button } from "@heroui/react";
import { toast } from "@/components/ui/toast";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ArrowClockwise, ArrowSquareOut, Trash } from "@/components/ui/icons";
import { DashboardAnnouncements } from "../dashboard/DashboardAnnouncements";
import { DashboardFilters } from "../dashboard/DashboardFilters";
import {
	compareLibraryEntries,
	defaultLibrarySortDirection,
	type LibrarySort,
	type LibrarySortDirection,
} from "../dashboard/librarySort";
import { DashboardToolbar } from "../dashboard/DashboardToolbar";
import { LibrarySkeleton } from "../dashboard/LibrarySkeleton";
import { ProjectCard } from "../dashboard/ProjectCard";
import { notifyShareCapacityChanged } from "./shareCapacity";
import { parseSharedRecordingDate } from "./sharedRecordingDate";
import { removeProjectShareLinksByUrl } from "./projectShareLinks";

type Recording = {
	code: string;
	title: string;
	size: number;
	ready: boolean;
	url: string;
	createdAt?: string;
};

export function SharedRecordings({
	token,
	endpoint,
	refreshKey,
	standalone = false,
	accountLabel,
}: {
	token: string;
	endpoint: string;
	refreshKey?: string;
	standalone?: boolean;
	accountLabel?: string;
}) {
	const { locale, t: uiText } = useUiLocale();
	const [query, setQuery] = useState("");
	const [period, setPeriod] = useState("all");
	const [sort, setSortCriterion] = useState<LibrarySort>("recent");
	const [sortDirection, setSortDirection] = useState<LibrarySortDirection>("desc");
	const setSort = (next: LibrarySort) => {
		setSortCriterion(next);
		setSortDirection(defaultLibrarySortDirection(next));
	};
	const [selected, setSelected] = useState<string[]>([]);
	const [selecting, setSelecting] = useState(false);
	const [expanded, setExpanded] = useState(standalone);
	const [recordings, setRecordings] = useState<Recording[]>([]);
	const [loading, setLoading] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [nextCursor, setNextCursor] = useState<string>();
	const pagePending = useRef(false);
	const [deleting, setDeleting] = useState<string>();
	const [error, setError] = useState<string>();
	const [errorSource, setErrorSource] = useState<"load" | "more" | "action">();
	const loadGeneration = useRef(0);
	const load = useCallback(async () => {
		const generation = ++loadGeneration.current;
		setLoading(true);
		setLoadingMore(false);
		pagePending.current = false;
		setNextCursor(undefined);
		setDeleting(undefined);
		setRecordings([]);
		setError(undefined);
		try {
			const result = await window.electronAPI.cloudShareManage({
				token,
				endpoint,
				action: "list",
			});
			if (generation !== loadGeneration.current) return;
			if (!result.success)
				throw new Error(result.error || uiText("ui.couldNotLoadSharedRecordings"));
			setRecordings(result.videos || []);
			setNextCursor(result.nextCursor);
		} catch (cause) {
			if (generation === loadGeneration.current) {
				setError(cause instanceof Error ? cause.message : String(cause));
				setErrorSource("load");
			}
		} finally {
			if (generation === loadGeneration.current) setLoading(false);
		}
	}, [token, endpoint, uiText]);
	const loadMore = async () => {
		if (!nextCursor || loading || deleting || pagePending.current) return;
		const generation = loadGeneration.current;
		const cursor = nextCursor;
		pagePending.current = true;
		setLoadingMore(true);
		setError(undefined);
		try {
			const result = await window.electronAPI.cloudShareManage({
				token,
				endpoint,
				action: "list",
				cursor,
			});
			if (generation !== loadGeneration.current) return;
			if (!result.success)
				throw new Error(result.error || uiText("ui.couldNotLoadMoreRecordings"));
			if (result.nextCursor === cursor)
				throw new Error(uiText("ui.couldNotAdvanceToTheNextRecordingsPage"));
			setRecordings((current) => {
				const known = new Set(current.map((recording) => recording.code));
				return [
					...current,
					...(result.videos || []).filter((recording) => {
						if (known.has(recording.code)) return false;
						known.add(recording.code);
						return true;
					}),
				];
			});
			setNextCursor(result.nextCursor);
		} catch (cause) {
			if (generation === loadGeneration.current) {
				setError(cause instanceof Error ? cause.message : String(cause));
				setErrorSource("more");
			}
		} finally {
			if (generation === loadGeneration.current) {
				pagePending.current = false;
				setLoadingMore(false);
			}
		}
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: A new share URL must refresh this library.
	useEffect(() => {
		if (expanded) void load();
		return () => {
			loadGeneration.current += 1;
		};
	}, [expanded, load, refreshKey]);
	const remove = async (code: string) => {
		if (pagePending.current) return;
		if (!window.confirm(uiText("ui.deleteThisSharedRecordingThisCannotBeUndone"))) return;
		const generation = loadGeneration.current;
		const deletedUrl = recordings.find((recording) => recording.code === code)?.url;
		setDeleting(code);
		setError(undefined);
		try {
			const result = await window.electronAPI.cloudShareManage({
				token,
				endpoint,
				action: "delete",
				shareCode: code,
			});
			if (!result.success)
				throw new Error(result.error || uiText("ui.couldNotDeleteRecording"));
			if (deletedUrl) {
				try {
					removeProjectShareLinksByUrl(deletedUrl);
				} catch (cause) {
					toast.error(uiText("ui.couldNotSaveLibraryPreferences"));
					console.warn(
						"Recording deleted, but its saved project links could not be cleared",
						cause,
					);
				}
			}
			// A confirmed server mutation remains valid after navigating to another library.
			notifyShareCapacityChanged();
			if (generation !== loadGeneration.current) return;
			setRecordings((current) => current.filter((recording) => recording.code !== code));
		} catch (cause) {
			if (generation === loadGeneration.current) {
				setError(cause instanceof Error ? cause.message : String(cause));
				setErrorSource("action");
			}
		} finally {
			if (generation === loadGeneration.current) setDeleting(undefined);
		}
	};
	const errorFeedback = error ? (
		<Alert status="danger" role="alert" className="mb-4">
			<Alert.Content>
				<Alert.Description>
					<LocalizedError
						error={error}
						summary={uiText(
							errorSource === "more"
								? "ui.couldNotLoadMoreRecordings"
								: errorSource === "load"
									? "ui.couldNotLoadSharedRecordings"
									: "ui.couldNotCompleteAction",
						)}
					/>
				</Alert.Description>
				<ErrorReportButton error={error} context="cloud-library" />
				{errorSource === "load" || errorSource === "more" ? (
					<Button
						variant="secondary"
						size="sm"
						className="mt-2"
						isDisabled={loading || loadingMore || Boolean(deleting)}
						onPress={() => void (errorSource === "more" ? loadMore() : load())}
					>
						{errorSource === "more"
							? uiText("ui.retryLoadingMoreRecordings")
							: uiText("ui.retryLoadingRecordings")}
					</Button>
				) : null}
			</Alert.Content>
		</Alert>
	) : null;
	const pagination =
		nextCursor && !loading ? (
			<div className="mt-5 flex flex-col items-center gap-2">
				<p className="text-xs text-muted">
					{uiText("ui.loadedRecordingsHint", undefined, {
						count: recordings.length,
						number: new Intl.NumberFormat(locale).format(recordings.length),
					})}
				</p>
				<Button
					variant="ghost"
					onPress={() => void loadMore()}
					isDisabled={loadingMore || Boolean(deleting)}
				>
					{loadingMore
						? uiText("ui.loadingMoreRecordings")
						: uiText("ui.loadMoreRecordings")}
				</Button>
			</div>
		) : null;
	if (standalone) {
		const entries = recordings
			.map((recording) => ({
				path: recording.code,
				name: recording.title,
				updatedAt: parseSharedRecordingDate(recording.createdAt),
				thumbnailPath: recording.ready
					? new URL(`/thumb/${recording.code}`, endpoint).href
					: null,
				isCurrent: false,
				isInProjectsDirectory: false,
				recording,
			}))
			.filter(
				(entry) =>
					entry.name
						.toLocaleLowerCase(locale)
						.includes(query.trim().toLocaleLowerCase(locale)) &&
					(period === "all" ||
						entry.updatedAt >= Date.now() - (period === "week" ? 7 : 30) * 86400000),
			)
			.sort((a, b) => compareLibraryEntries(a, b, sort, locale, new Map(), sortDirection));
		const run = async (action: () => Promise<unknown>) => {
			try {
				await action();
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));
				setErrorSource("action");
			}
		};
		return (
			<div className="-mx-7 lg:-mx-10">
				<DashboardAnnouncements />
				<DashboardToolbar
					title={uiText("ui.sharedLinks")}
					query={query}
					setQuery={setQuery}
					isRaw={false}
					onImportFile={load}
					run={run}
					busy={loading || Boolean(deleting)}
					actionLabel={uiText("ui.refresh")}
					action="refresh"
				/>
				<DashboardFilters
					hideSelection
					mediaSorts={false}
					isRaw={false}
					period={period}
					setPeriod={setPeriod}
					sort={sort}
					setSort={setSort}
					sortDirection={sortDirection}
					setSortDirection={setSortDirection}
					selecting={selecting}
					setSelecting={setSelecting}
					selected={selected}
					setSelected={setSelected}
					visible={entries}
					busy={loading || Boolean(deleting)}
					deleteEntries={async () => undefined}
				/>
				<div className="px-7 lg:px-10">
					{errorFeedback}
					{loading ? (
						<LibrarySkeleton />
					) : entries.length ? (
						<ul
							aria-label={uiText("ui.sharedProjects")}
							className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] min-[1440px]:grid-cols-4 gap-x-7 gap-y-10 lg:gap-x-9"
						>
							{entries.map((entry) => (
								<Fragment key={entry.path}>
									<ProjectCard
										entry={entry}
										webUrl={entry.recording.url}
										webReady={entry.recording.ready}
										accountLabel={accountLabel}
										busy={Boolean(deleting) || loadingMore}
										selecting={false}
										selected={[]}
										toggleSelected={() => undefined}
										openEntry={() =>
											void run(async () => {
												const result =
													await window.electronAPI.openExternalUrl(
														entry.recording.url,
													);
												if (!result.success)
													throw new Error(
														result.error ||
															uiText("ui.couldNotOpenLink2"),
													);
											})
										}
										run={run}
										onShareProject={async () => undefined}
										onRenameProject={async (path) => path}
										folders={[]}
										save={() => undefined}
										assignFolder={() => undefined}
										onDelete={() => void remove(entry.path)}
									/>
								</Fragment>
							))}
						</ul>
					) : error ? null : (
						<div className="flex min-h-64 flex-col items-center justify-center gap-3 py-8 text-center text-sm text-muted-foreground">
							<h2 className="text-base font-medium text-foreground">
								{query.trim() || period !== "all"
									? uiText("ui.noMatchingSharedRecordings")
									: uiText("ui.noSharedRecordingsYet")}
							</h2>
							<p className="max-w-md">
								{query.trim() || period !== "all"
									? uiText("ui.tryAnotherSearchOrClearFiltersToSee")
									: uiText("ui.recordAVideoThenChoosePublishAndLink")}
							</p>
							{query.trim() || period !== "all" ? (
								<Button
									variant="secondary"
									onPress={() => {
										setQuery("");
										setPeriod("all");
									}}
								>
									{uiText("ui.clearFilters")}
								</Button>
							) : (
								<Button
									variant="secondary"
									onPress={() =>
										void run(() => window.electronAPI.showRecordingHud())
									}
								>
									{uiText("ui.recordAVideo")}
								</Button>
							)}
						</div>
					)}
					{pagination}
				</div>
			</div>
		);
	}

	return (
		<section className="space-y-3 border-b border-foreground/10 pb-4">
			<div className="flex items-center justify-between gap-2">
				{standalone ? (
					<h2 className="text-lg font-semibold">{uiText("ui.sharedRecordings")}</h2>
				) : (
					<Button
						variant="ghost"
						size="sm"
						onPress={() => setExpanded((value) => !value)}
						aria-expanded={expanded}
					>
						{expanded
							? uiText("ui.hideSharedRecordings")
							: uiText("ui.manageSharedRecordings")}
					</Button>
				)}
				{expanded && (
					<Button
						variant="ghost"
						size="sm"
						isIconOnly
						aria-label={uiText("ui.refreshRecordings")}
						isDisabled={loading || Boolean(deleting)}
						onPress={() => void load()}
					>
						<ArrowClockwise className="size-4" />
					</Button>
				)}
			</div>
			{expanded && (
				<>
					<p className="text-xs text-muted">
						{loading
							? uiText("ui.loadingRecordings")
							: uiText(
									nextCursor ? "ui.recordingsShown" : "ui.cloudRecordings",
									undefined,
									{
										count: recordings.length,
										number: new Intl.NumberFormat(locale).format(
											recordings.length,
										),
									},
								)}
					</p>
					{loading ? (
						<LibrarySkeleton />
					) : (
						<ul
							className={
								standalone ? "space-y-2" : "max-h-64 space-y-2 overflow-y-auto"
							}
						>
							{recordings.map((recording) => (
								<li
									key={recording.code}
									className="rounded-lg border border-foreground/10 p-3"
								>
									<div className="flex items-center gap-3">
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-medium">
												{recording.title}
											</p>
											<p className="text-xs text-muted">
												{new Intl.NumberFormat(locale, {
													maximumFractionDigits: 1,
												}).format(recording.size / 1024 / 1024)}{" "}
												{uiText("ui.mb")}
												{!recording.ready && uiText("ui.IncompleteUpload")}
											</p>
										</div>
										{recording.ready && (
											<Button
												variant="ghost"
												size="sm"
												isIconOnly
												aria-label={uiText("ui.openNamed", undefined, {
													name: recording.title,
												})}
												onPress={() =>
													void window.electronAPI.openExternalUrl(
														recording.url,
													)
												}
											>
												<ArrowSquareOut className="size-4" />
											</Button>
										)}
										<Button
											variant="ghost"
											size="sm"
											isIconOnly
											aria-label={uiText("ui.deleteNamed", undefined, {
												name: recording.title,
											})}
											isDisabled={Boolean(deleting) || loadingMore}
											className="text-danger"
											onPress={() => void remove(recording.code)}
										>
											<Trash className="size-4" />
										</Button>
									</div>
								</li>
							))}
							{!recordings.length && !error && (
								<li className="text-sm text-muted">
									{uiText("ui.noSharedRecordingsYet2")}
								</li>
							)}
						</ul>
					)}
					{pagination}
					{errorFeedback}
				</>
			)}
		</section>
	);
}
