import { LocalizedError } from "@/components/feedback/LocalizedError";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { errorSourceName, projectLoadError } from "../project/projectLoadError";
import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import { LoadingTransition } from "@/components/ui/loading-transition";
import { LibrarySkeleton } from "./LibrarySkeleton";
import { SharedRecordings } from "../cloud/SharedRecordings";
import { CLOUD_SHARE_ENDPOINT } from "../cloud/endpoint";
import { RecordNewButton } from "./RecordNewButton";
import { RawPreview } from "./RawRecordings";
import { Cloud, ImageSquare } from "@/components/ui/icons";

import { Button } from "@/components/ui/button";

import { DashboardSettings } from "./DashboardSettings";

import { ProjectCard } from "./ProjectCard";
import { RecentSharedVideos } from "./RecentSharedVideos";
import type { DashboardProps } from "./types";

import type { DashboardModel } from "./useDashboardModel";

export function DashboardGrid({
	onImportFile,
	loading,
	libraryError,
	onRetryLibraryLoad,
	isRaw,
	rawPreview,
	setRawPreview,
	rawLoading,
	rawError,
	refreshRaw,
	error,
	errorSource,
	errorRecordingSource,
	section,
	settingsCategory,
	settingsRequest,
	setSection,
	accountLabel,
	accountId,
	authToken,
	onSignIn,
	onShareProject,
	visible,
	busy,
	selecting,
	toggleSelected,
	onRenameProject,
	folders,
	save,
	assignFolder,
	selected,
	openEntry,
	hasActiveFilters,
	hasContentFilters,
	activeFolder,
	clearFilters,
	run,
	deleteEntries,
}: Pick<
	DashboardProps & DashboardModel,
	| "loading"
	| "libraryError"
	| "onRetryLibraryLoad"
	| "onImportFile"
	| "isRaw"
	| "rawPreview"
	| "setRawPreview"
	| "rawLoading"
	| "rawError"
	| "refreshRaw"
	| "error"
	| "errorSource"
	| "errorRecordingSource"
	| "section"
	| "setSection"
	| "settingsCategory"
	| "settingsRequest"
	| "accountLabel"
	| "accountId"
	| "authToken"
	| "onSignIn"
	| "onShareProject"
	| "visible"
	| "busy"
	| "selecting"
	| "toggleSelected"
	| "onRenameProject"
	| "folders"
	| "save"
	| "assignFolder"
	| "selected"
	| "openEntry"
	| "hasActiveFilters"
	| "hasContentFilters"
	| "activeFolder"
	| "clearFilters"
	| "deleteEntries"
	| "run"
>) {
	const { t: uiText } = useUiLocale();
	return (
		<>
			<main className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-7 pb-10 lg:px-10">
				{error && (
					<div className="mb-4 rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm">
						<p role="alert" className="text-danger">
							{projectLoadError(error).title}
							{errorSource ? `: ${errorSourceName(errorSource)}` : ""}
						</p>
						<p className="mt-2 text-muted-foreground">
							{projectLoadError(error).description}
						</p>
						{errorRecordingSource && errorRecordingSource !== errorSource && (
							<p className="mt-2 select-text break-words text-muted-foreground">
								{uiText("ui.recordingSource", "Recording: {{name}}", {
									name: errorSourceName(errorRecordingSource),
								})}
							</p>
						)}
						<div className="mt-3">
							<ErrorReportButton error={error} context="project-load" />
						</div>
						<details className="mt-2 text-muted-foreground">
							<summary className="cursor-pointer">{uiText("ui.showDetails")}</summary>
							<p className="mt-2 break-words">{error}</p>
						</details>
					</div>
				)}
				{isRaw && rawError && section !== "settings" && section !== "shared" && (
					<div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-danger/20 bg-danger/5 p-4">
						<p role="alert" className="text-sm text-danger">
							<LocalizedError error={rawError} />{" "}
							<ErrorReportButton error={rawError} context="raw-library" />
						</p>
						<Button
							variant="secondary"
							disabled={rawLoading}
							onClick={() => void refreshRaw()}
						>
							{rawLoading ? uiText("ui.retrying") : uiText("ui.retryLoadingRawFiles")}
						</Button>
					</div>
				)}
				{!isRaw && libraryError && section !== "settings" && section !== "shared" && (
					<div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-danger/20 bg-danger/5 p-4">
						<div role="alert" className="min-w-0 text-sm text-danger">
							<LocalizedError
								error={libraryError}
								summary={uiText("ui.couldNotLoadProjects")}
							/>
							<ErrorReportButton error={libraryError} context="project-library" />
						</div>
						{onRetryLibraryLoad && (
							<Button
								variant="secondary"
								disabled={loading}
								onClick={() => void onRetryLibraryLoad()}
							>
								{loading
									? uiText("ui.retrying")
									: uiText("ui.retryLoadingProjects")}
							</Button>
						)}
					</div>
				)}
				{section === "projects" &&
					!hasActiveFilters &&
					authToken &&
					CLOUD_SHARE_ENDPOINT && (
						<RecentSharedVideos
							key={authToken}
							token={authToken}
							endpoint={CLOUD_SHARE_ENDPOINT}
							onViewAll={() => setSection("shared")}
						/>
					)}
				{section === "projects" && !hasActiveFilters && (
					<h2 className="mb-4 text-lg font-medium text-foreground">{uiText("ui.all")}</h2>
				)}
				{section === "settings" ? (
					<DashboardSettings
						key={settingsRequest}
						initialCategory={settingsCategory}
						onImportFile={onImportFile}
					/>
				) : section === "shared" ? (
					authToken && CLOUD_SHARE_ENDPOINT ? (
						<div>
							<SharedRecordings
								key={authToken}
								token={authToken}
								endpoint={CLOUD_SHARE_ENDPOINT}
								accountLabel={accountLabel}
								standalone
							/>
						</div>
					) : (
						<div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
							<Cloud weight="fill" className="size-8 opacity-40" />
							<p>
								{authToken
									? uiText("ui.cloudSharingIsNotAvailableInThisBuild")
									: uiText("ui.signInToManageSharedVideos")}
							</p>
							{!authToken && (
								<Button variant="secondary" onClick={onSignIn}>
									{uiText("ui.signIn")}
								</Button>
							)}
						</div>
					)
				) : (
					<LoadingTransition
						loading={Boolean(isRaw ? rawLoading : loading)}
						fallback={<LibrarySkeleton />}
					>
						{visible.length ? (
							<ul
								aria-label={
									isRaw ? uiText("ui.rawFiles") : uiText("ui.yourProjects")
								}
								className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] min-[1440px]:grid-cols-4 gap-x-7 gap-y-10 pt-2 lg:gap-x-9"
							>
								{visible.map((entry) => (
									<ProjectCard
										key={entry.path}
										onDelete={() => void deleteEntries([entry.path])}
										{...{
											accountLabel,
											accountId,
											entry,
											busy,
											selecting,
											selected,
											toggleSelected,
											openEntry,
											run,
											onShareProject,
											onRenameProject,
											folders,
											save,
											assignFolder,
										}}
									/>
								))}
							</ul>
						) : (isRaw ? rawError : error || libraryError) ? null : (
							<div className="flex min-h-64 flex-col items-center justify-center gap-3 py-8 text-center text-sm text-muted-foreground">
								<ImageSquare
									aria-hidden="true"
									weight="fill"
									className="size-8 opacity-30"
								/>
								<h2 className="text-base font-medium text-foreground">
									{hasContentFilters
										? isRaw
											? uiText("ui.noMatchingRawFiles")
											: uiText("ui.noMatchingProjects")
										: activeFolder
											? uiText("ui.thisFolderIsEmpty")
											: isRaw
												? uiText("ui.noRawRecordingsYet")
												: uiText("ui.noProjectsYet")}
								</h2>
								<p className="max-w-md">
									{hasContentFilters
										? uiText("ui.tryADifferentSearchOrClearFiltersTo")
										: activeFolder
											? uiText("ui.addFilesToFolder", undefined, {
													name: activeFolder.name,
												})
											: isRaw
												? uiText(
														"ui.startARecordingToKeepTheOriginalScreen",
													)
												: uiText(
														"ui.recordYourFirstVideoOrImportAnExisting",
													)}
								</p>
								{hasContentFilters ? (
									<Button variant="secondary" onClick={clearFilters}>
										{uiText("ui.clearFilters")}
									</Button>
								) : activeFolder ? (
									<Button variant="secondary" onClick={clearFilters}>
										{isRaw
											? uiText("ui.viewAllRawFiles")
											: uiText("ui.viewAllProjects")}
									</Button>
								) : (
									<div className="mt-2 flex flex-wrap justify-center gap-2">
										<RecordNewButton busy={busy} run={run} first={!isRaw} />
										{!isRaw && (
											<Button
												variant="secondary"
												disabled={busy}
												onClick={() => void run(onImportFile)}
											>
												{uiText("ui.importVideo")}
											</Button>
										)}
									</div>
								)}
							</div>
						)}
					</LoadingTransition>
				)}
				<RawPreview entry={rawPreview} onClose={() => setRawPreview(null)} />
			</main>
		</>
	);
}
