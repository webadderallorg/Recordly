import { Checkbox, Label, Modal } from "@heroui/react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/contexts/I18nContext";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import {
	matchesCleanupDate,
	scanCleanup,
	type CleanupDateFilter,
	type CleanupRule,
	type CleanupScan,
} from "./libraryCleanup";
import { ProjectThumbnail } from "./ProjectThumbnail";
import { RawThumbnail } from "./RawRecordings";

export function LibraryCleanupDialog({
	entries,
	projects,
	scope,
	isRaw,
	onClose,
	onSelect,
}: {
	entries: ProjectLibraryEntry[];
	projects: ProjectLibraryEntry[];
	scope: ProjectLibraryEntry[];
	isRaw: boolean;
	onClose: () => void;
	onSelect: (paths: string[]) => void;
}) {
	const { t, locale } = useI18n();
	const [rule, setRule] = useState<CleanupRule>(isRaw ? "unused" : "untouched");
	const [dates, setDates] = useState<CleanupDateFilter>({
		period: "older30",
		basis: isRaw ? "created" : "edited",
		from: "",
		to: "",
	});
	const [scan, setScan] = useState<CleanupScan | null>(null);
	const [error, setError] = useState(false);
	const [excluded, setExcluded] = useState<string[]>([]);
	useEffect(() => {
		let cancelled = false;
		setScan(null);
		setError(false);
		setExcluded([]);
		void scanCleanup(rule, entries, projects, isRaw, () => cancelled)
			.then((result) => {
				if (!cancelled) setScan(result);
			})
			.catch(() => {
				if (!cancelled) setError(true);
			});
		return () => {
			cancelled = true;
		};
	}, [rule, entries, projects, isRaw]);
	const invalidDates =
		dates.period === "custom" && Boolean(dates.from && dates.to && dates.from > dates.to);
	const matches = useMemo(
		() =>
			invalidDates
				? []
				: scope.filter(
						(entry) =>
							scan?.candidates.has(entry.path) && matchesCleanupDate(entry, dates),
					),
		[scope, scan, dates, invalidDates],
	);
	const selected = matches.filter((entry) => !excluded.includes(entry.path));
	const names = new Map(entries.map((entry) => [entry.path, entry.name]));

	return (
		<Modal
			isOpen
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<Modal.Backdrop variant="blur">
				<Modal.Container size="lg">
					<Modal.Dialog aria-label={t("ui.cleanup.title", "Clean up library")}>
						<Modal.CloseTrigger />
						<Modal.Header>
							<Modal.Heading>
								{t("ui.cleanup.title", "Clean up library")}
							</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="space-y-4">
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<Select
									aria-label={t("ui.cleanup.find", "Find")}
									value={rule}
									onValueChange={(value) => setRule(value as CleanupRule)}
								>
									<Label>{t("ui.cleanup.find", "Find")}</Label>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">
											{t("ui.cleanup.all", "All items")}
										</SelectItem>
										<SelectItem value={isRaw ? "unused" : "untouched"}>
											{isRaw
												? t("ui.cleanup.unused", "Not in saved projects")
												: t("ui.cleanup.untouched", "Unedited projects")}
										</SelectItem>
										<SelectItem value="duplicates">
											{t("ui.cleanup.duplicates", "Duplicates of original")}
										</SelectItem>
									</SelectContent>
								</Select>
								<Select
									aria-label={t("ui.cleanup.age", "Age")}
									value={dates.period}
									onValueChange={(period) =>
										setDates({
											...dates,
											period: period as CleanupDateFilter["period"],
										})
									}
								>
									<Label>{t("ui.cleanup.age", "Age")}</Label>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">
											{t("ui.cleanup.anyTime", "Any time")}
										</SelectItem>
										<SelectItem value="older7">
											{t("ui.cleanup.older7", "Older than 7 days")}
										</SelectItem>
										<SelectItem value="older30">
											{t("ui.cleanup.older30", "Older than 30 days")}
										</SelectItem>
										<SelectItem value="older90">
											{t("ui.cleanup.older90", "Older than 90 days")}
										</SelectItem>
										<SelectItem value="custom">
											{t("ui.cleanup.custom", "Custom date range")}
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{!isRaw && (
								<Select
									aria-label={t("ui.cleanup.dateBasis", "Date based on")}
									value={dates.basis}
									onValueChange={(basis) =>
										setDates({
											...dates,
											basis: basis as CleanupDateFilter["basis"],
										})
									}
								>
									<Label>{t("ui.cleanup.dateBasis", "Date based on")}</Label>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="edited">{t("ui.lastEdited")}</SelectItem>
										<SelectItem value="created">
											{t("ui.lastCreated")}
										</SelectItem>
									</SelectContent>
								</Select>
							)}
							{dates.period === "custom" && (
								<div className="grid grid-cols-2 gap-3">
									<label className="space-y-1 text-sm">
										{t("ui.cleanup.from", "From")}
										<Input
											type="date"
											aria-label={t("ui.cleanup.from", "From")}
											value={dates.from}
											max={dates.to || undefined}
											onChange={(e) =>
												setDates({ ...dates, from: e.target.value })
											}
										/>
									</label>
									<label className="space-y-1 text-sm">
										{t("ui.cleanup.to", "Through")}
										<Input
											type="date"
											aria-label={t("ui.cleanup.to", "Through")}
											value={dates.to}
											min={dates.from || undefined}
											onChange={(e) =>
												setDates({ ...dates, to: e.target.value })
											}
										/>
									</label>
								</div>
							)}
							{invalidDates && (
								<p role="alert" className="text-sm text-danger">
									{t(
										"ui.cleanup.invalidDates",
										"The end date must be on or after the start date.",
									)}
								</p>
							)}
							{error ? (
								<p role="alert" className="text-sm text-danger">
									{t(
										"ui.cleanup.scanError",
										"Could not scan the library. Close and reopen cleanup to try again.",
									)}
								</p>
							) : !scan ? (
								<p role="status" className="text-sm text-muted-foreground">
									{t("ui.cleanup.scanning", "Checking saved projects and media…")}
								</p>
							) : (
								<>
									{scan.skipped > 0 && (
										<p role="status" className="text-xs text-warning">
											{scan.incomplete
												? t(
														"ui.cleanup.incomplete",
														"Some projects could not be checked. Source cleanup is unavailable until they can be read.",
													)
												: t(
														"ui.cleanup.skipped",
														"Unreadable projects or media were excluded from suggestions.",
													)}
										</p>
									)}
									<div className="flex items-center justify-between gap-3 text-sm">
										<span role="status">
											{t("ui.cleanup.matchCount", "Matches: {{count}}", {
												count: new Intl.NumberFormat(locale).format(
													matches.length,
												),
											})}
										</span>
										<Button
											size="sm"
											variant="ghost"
											disabled={!matches.length}
											onClick={() =>
												setExcluded(
													selected.length === matches.length
														? matches.map((entry) => entry.path)
														: [],
												)
											}
										>
											{selected.length === matches.length &&
											matches.length > 0
												? t("ui.cleanup.deselectAll", "Deselect all")
												: t(
														"ui.cleanup.selectMatches",
														"Select all matches",
													)}
										</Button>
									</div>
									<ul
										className="custom-scrollbar max-h-56 space-y-1 overflow-y-auto rounded-xl bg-default/30 p-2"
										aria-label={t("ui.cleanup.matches", "Cleanup matches")}
									>
										{matches.map((entry) => (
											<li
												key={entry.path}
												className="rounded-lg p-2 hover:bg-default/50"
											>
												<Checkbox
													className="w-full"
													isSelected={!excluded.includes(entry.path)}
													onChange={(checked) =>
														setExcluded((previous) =>
															checked
																? previous.filter(
																		(path) =>
																			path !== entry.path,
																	)
																: [...previous, entry.path],
														)
													}
												>
													<Checkbox.Content className="w-full min-w-0 items-center">
														<Checkbox.Control>
															<Checkbox.Indicator />
														</Checkbox.Control>
														<div
															className="pointer-events-none w-20 shrink-0 sm:w-24"
															aria-hidden="true"
														>
															{entry.rawSource ? (
																<RawThumbnail
																	entry={entry.rawSource}
																	active={false}
																/>
															) : (
																<ProjectThumbnail
																	key={`${entry.thumbnailPath}-${entry.updatedAt}`}
																	path={entry.thumbnailPath}
																	projectPath={entry.path}
																	revision={entry.updatedAt}
																/>
															)}
														</div>
														<div className="flex min-w-0 flex-1 flex-col items-start gap-1">
															<Label className="break-all text-sm">
																{entry.name}
															</Label>
															<span className="text-xs text-muted-foreground">
																{new Intl.DateTimeFormat(locale, {
																	dateStyle: "medium",
																}).format(
																	(dates.basis === "created"
																		? entry.createdAt
																		: entry.updatedAt) ??
																		entry.updatedAt,
																)}
															</span>
															{scan.keepers.has(entry.path) && (
																<span className="break-all text-xs text-muted-foreground">
																	{t(
																		"ui.cleanup.keeping",
																		"Keeping: {{name}}",
																		{
																			name:
																				names.get(
																					scan.keepers.get(
																						entry.path,
																					)!,
																				) ??
																				scan.keepers.get(
																					entry.path,
																				)!,
																		},
																	)}
																</span>
															)}
														</div>
													</Checkbox.Content>
												</Checkbox>
											</li>
										))}
										{!matches.length && (
											<li className="p-4 text-center text-sm text-muted-foreground">
												{t(
													"ui.cleanup.noMatches",
													"No matches. Try a different rule or date range.",
												)}
											</li>
										)}
									</ul>
								</>
							)}
						</Modal.Body>
						<Modal.Footer>
							<Button variant="ghost" onClick={onClose}>
								{t("ui.cancel")}
							</Button>
							<Button
								disabled={!scan || error || invalidDates || !selected.length}
								onClick={() => onSelect(selected.map((entry) => entry.path))}
							>
								{t("ui.cleanup.useSelection", "Use selection ({{count}})", {
									count: new Intl.NumberFormat(locale).format(selected.length),
								})}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
