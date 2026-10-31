import { parseSharedRecordingDate } from "./sharedRecordingDate";
import { FREE_RECORDING_LIMIT, notifyShareCapacityChanged } from "./shareCapacity";
import { LibrarySkeleton } from "../dashboard/LibrarySkeleton";
import { ProjectCard } from "../dashboard/ProjectCard";
import { DashboardToolbar } from "../dashboard/DashboardToolbar";
import { DashboardFilters } from "../dashboard/DashboardFilters";
import { DashboardAnnouncements } from "../dashboard/DashboardAnnouncements";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button } from "@heroui/react";
import { ArrowClockwise, ArrowSquareOut, Trash } from "@/components/ui/icons";

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
	const [query, setQuery] = useState("");
	const [period, setPeriod] = useState("all");
	const [sort, setSort] = useState("recent");
	const [selected, setSelected] = useState<string[]>([]);
	const [selecting, setSelecting] = useState(false);
	const [expanded, setExpanded] = useState(standalone);
	const [recordings, setRecordings] = useState<Recording[]>([]);
	const [loading, setLoading] = useState(false);
	const [deleting, setDeleting] = useState<string>();
	const [error, setError] = useState<string>();
	const loadGeneration = useRef(0);
	const load = useCallback(async () => {
		const generation = ++loadGeneration.current;
		setLoading(true);
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
				throw new Error(result.error || "Could not load shared recordings.");
			setRecordings(result.videos || []);
		} catch (cause) {
			if (generation === loadGeneration.current)
				setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (generation === loadGeneration.current) setLoading(false);
		}
	}, [token, endpoint]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: A new share URL must refresh this library.
	useEffect(() => {
		if (expanded) void load();
		return () => {
			loadGeneration.current += 1;
		};
	}, [expanded, load, refreshKey]);
	const remove = async (code: string) => {
		if (!window.confirm("Delete this shared recording? This cannot be undone.")) return;
		setDeleting(code);
		setError(undefined);
		try {
			const result = await window.electronAPI.cloudShareManage({
				token,
				endpoint,
				action: "delete",
				shareCode: code,
			});
			if (!result.success) throw new Error(result.error || "Could not delete recording.");
			notifyShareCapacityChanged();
			setRecordings((current) => current.filter((recording) => recording.code !== code));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setDeleting(undefined);
		}
	};
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
					entry.name.toLowerCase().includes(query.toLowerCase()) &&
					(period === "all" ||
						entry.updatedAt >= Date.now() - (period === "week" ? 7 : 30) * 86400000),
			)
			.sort((a, b) =>
				sort === "name" ? a.name.localeCompare(b.name) : b.updatedAt - a.updatedAt,
			);
		const run = async (action: () => Promise<unknown>) => {
			try {
				await action();
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
		};
		return (
			<div className="-mx-7 lg:-mx-10">
				<DashboardAnnouncements />
				<DashboardToolbar
					query={query}
					setQuery={setQuery}
					isRaw={false}
					onImportFile={load}
					run={run}
					busy={loading || Boolean(deleting)}
					actionLabel="Refresh"
					action="refresh"
				/>
				<DashboardFilters
					hideSelection
					isRaw={false}
					period={period}
					setPeriod={setPeriod}
					sort={sort}
					setSort={setSort}
					selecting={selecting}
					setSelecting={setSelecting}
					selected={selected}
					setSelected={setSelected}
					visible={entries}
					busy={loading || Boolean(deleting)}
					deleteEntries={async () => undefined}
				/>
				<div className="px-7 lg:px-10">
					{error && (
						<p role="alert" className="mb-4 text-sm text-danger">
							{error}
						</p>
					)}
					{loading ? (
						<LibrarySkeleton />
					) : entries.length ? (
						<ul
							aria-label="Shared projects"
							className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-x-7 gap-y-10 lg:gap-x-9"
						>
							{entries.map((entry) => (
								<Fragment key={entry.path}>
									<ProjectCard
										entry={entry}
										webUrl={entry.recording.url}
										webReady={entry.recording.ready}
										accountLabel={accountLabel}
										busy={Boolean(deleting)}
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
														result.error || "Could not open link.",
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
					) : (
						<div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
							<span aria-hidden="true" className="text-4xl">
								🦗
							</span>
							<p>
								{query || period !== "all"
									? "No matching projects"
									: "It's looking empty in here..."}
							</p>
						</div>
					)}
				</div>
			</div>
		);
	}

	return (
		<section className="space-y-3 border-b border-foreground/10 pb-4">
			<div className="flex items-center justify-between gap-2">
				{standalone ? (
					<h2 className="text-lg font-semibold">Shared recordings</h2>
				) : (
					<Button
						variant="ghost"
						size="sm"
						onPress={() => setExpanded((value) => !value)}
						aria-expanded={expanded}
					>
						{expanded ? "Hide shared recordings" : "Manage shared recordings"}
					</Button>
				)}
				{expanded && (
					<Button
						variant="ghost"
						size="sm"
						isIconOnly
						aria-label="Refresh recordings"
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
							? "Loading recordings…"
							: `${recordings.length} of ${FREE_RECORDING_LIMIT} recordings · 1 GB each · Free links expire after 14 days`}
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
												{(recording.size / 1024 / 1024).toFixed(1)} MB
												{!recording.ready && " · Incomplete upload"}
											</p>
										</div>
										{recording.ready && (
											<Button
												variant="ghost"
												size="sm"
												isIconOnly
												aria-label={`Open ${recording.title}`}
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
											aria-label={`Delete ${recording.title}`}
											isDisabled={Boolean(deleting)}
											className="text-danger"
											onPress={() => void remove(recording.code)}
										>
											<Trash className="size-4" />
										</Button>
									</div>
								</li>
							))}
							{!recordings.length && !error && (
								<li className="text-sm text-muted">No shared recordings yet.</li>
							)}
						</ul>
					)}
					{error && (
						<Alert status="danger">
							<Alert.Content>
								<Alert.Description>{error}</Alert.Description>
							</Alert.Content>
						</Alert>
					)}
				</>
			)}
		</section>
	);
}
