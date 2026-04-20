import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useState } from "react";
import { MdCheck } from "react-icons/md";
import { useScopedT } from "../../contexts/I18nContext";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import styles from "./SourceSelector.module.css";

interface DesktopSource {
	id: string;
	name: string;
	thumbnail: string | null;
	display_id: string;
	appIcon: string | null;
	originalName: string;
	sourceType: "screen" | "window";
	appName?: string;
	windowTitle?: string;
}

function toProcessedDesktopSource(source: DesktopSource): ProcessedDesktopSource {
	return {
		id: source.id,
		name: source.originalName,
		thumbnail: source.thumbnail,
		display_id: source.display_id,
		appIcon: source.appIcon,
		originalName: source.originalName,
		sourceType: source.sourceType,
		appName: source.appName,
		windowTitle: source.windowTitle,
	};
}

function parseSourceMetadata(source: ProcessedDesktopSource) {
	if (source.sourceType === "window" && (source.appName || source.windowTitle)) {
		return {
			sourceType: "window" as const,
			appName: source.appName,
			windowTitle: source.windowTitle ?? source.name,
			displayName: source.windowTitle ?? source.name,
		};
	}

	const sourceType: "screen" | "window" = source.id.startsWith("window:") ? "window" : "screen";
	if (sourceType === "window") {
		const [appNamePart, ...windowTitleParts] = source.name.split(" — ");
		const appName = appNamePart?.trim() || undefined;
		const windowTitle = windowTitleParts.join(" — ").trim() || source.name.trim();

		return {
			sourceType,
			appName,
			windowTitle,
			displayName: windowTitle,
		};
	}

	return {
		sourceType,
		appName: undefined,
		windowTitle: undefined,
		displayName: source.name,
	};
}

export function SourceSelector() {
	const t = useScopedT("launch");
	const [sources, setSources] = useState<DesktopSource[]>([]);
	const [selectedSource, setSelectedSource] = useState<DesktopSource | null>(null);
	const [activeTab, setActiveTab] = useState<"screens" | "windows">("screens");
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		async function fetchSources() {
			setLoading(true);
			try {
				const rawSources = await window.electronAPI.getSources({
					types: ["screen", "window"],
					thumbnailSize: { width: 320, height: 180 },
					fetchWindowIcons: true,
				});
				setSources(
					rawSources.map((source) => {
						const metadata = parseSourceMetadata(source);

						return {
							id: source.id,
							name: metadata.displayName,
							thumbnail: source.thumbnail ?? null,
							display_id: source.display_id ?? "",
							appIcon: source.appIcon ?? null,
							originalName: source.name,
							sourceType: metadata.sourceType,
							appName: metadata.appName,
							windowTitle: metadata.windowTitle ?? source.name,
						};
					}),
				);
			} catch (error) {
				console.error("Error loading sources:", error);
			} finally {
				setLoading(false);
			}
		}
		fetchSources();
	}, []);

	const screenSources = sources.filter((s) => s.id.startsWith("screen:"));
	const windowSources = sources.filter((s) => s.id.startsWith("window:"));

	useEffect(() => {
		if (loading) {
			return;
		}

		if (screenSources.length === 0 && windowSources.length > 0) {
			setActiveTab("windows");
			return;
		}

		if (windowSources.length === 0 && screenSources.length > 0) {
			setActiveTab("screens");
		}
	}, [loading, screenSources.length, windowSources.length]);

	const handleSourceSelect = (source: DesktopSource) => setSelectedSource(source);
	const handleSourceKeyDown = (
		event: ReactKeyboardEvent<HTMLDivElement>,
		source: DesktopSource,
	) => {
		if (event.key !== "Enter" && event.key !== " ") {
			return;
		}

		event.preventDefault();
		handleSourceSelect(source);
	};

	const handleShare = async () => {
		if (selectedSource) {
			await window.electronAPI.selectSource(toProcessedDesktopSource(selectedSource));
		}
	};

	if (loading) {
		return (
			<div
				className={`h-full flex items-center justify-center ${styles.glassContainer}`}
				style={{ minHeight: "100vh" }}
			>
				<div className="text-center">
					<div className="animate-spin rounded-full h-6 w-6 border-b-2 border-zinc-600 mx-auto mb-2" />
					<p className="text-xs text-zinc-300">{t("sourceSelector.loadingSources")}</p>
				</div>
			</div>
		);
	}

	return (
		<div
			className={`min-h-screen flex flex-col items-center justify-center ${styles.glassContainer}`}
		>
			<div className="flex-1 flex flex-col w-full max-w-xl" style={{ padding: 0 }}>
				<Tabs
					value={activeTab}
					onValueChange={(value) => setActiveTab(value as "screens" | "windows")}
				>
					<TabsList className="grid grid-cols-2 mb-3 bg-zinc-900/40 rounded-full">
						<TabsTrigger
							value="screens"
							className="data-[state=active]:bg-[#2563EB] data-[state=active]:text-white text-zinc-200 rounded-full text-xs py-1"
						>
							{t("sourceSelector.screens")} ({screenSources.length})
						</TabsTrigger>
						<TabsTrigger
							value="windows"
							className="data-[state=active]:bg-[#2563EB] data-[state=active]:text-white text-zinc-200 rounded-full text-xs py-1"
						>
							{t("sourceSelector.windows")} ({windowSources.length})
						</TabsTrigger>
					</TabsList>
					<div className="h-72 flex flex-col justify-stretch">
						<TabsContent value="screens" className="h-full">
							<div
								className={`grid grid-cols-2 gap-2 h-full overflow-y-auto pr-1 relative ${styles.sourceGridScroll}`}
							>
								{screenSources.length === 0 && (
									<div className="col-span-2 text-center text-xs text-zinc-500 py-8">
										{t("sourceSelector.noScreensAvailable")}
									</div>
								)}
								{screenSources.map((source) => {
									const isSelected = selectedSource?.id === source.id;

									return (
										<Card
											key={source.id}
											className={`${styles.sourceCard} ${isSelected ? styles.selected : ""} cursor-pointer h-fit p-2 scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent`}
											style={{ margin: 8, width: "90%", maxWidth: 220 }}
											onClick={() => handleSourceSelect(source)}
											onKeyDown={(event) =>
												handleSourceKeyDown(event, source)
											}
											role="button"
											tabIndex={0}
											aria-pressed={isSelected}
										>
											<div className="p-1">
												<div className="relative mb-1">
													<img
														src={source.thumbnail || ""}
														alt={source.name}
														className="w-full aspect-video object-cover rounded border border-zinc-800"
													/>
													{isSelected && (
														<div className="absolute -top-1 -right-1">
															<div className="w-4 h-4 bg-[#2563EB] rounded-full flex items-center justify-center shadow-md">
																<MdCheck className={styles.icon} />
															</div>
														</div>
													)}
												</div>
												<div className={styles.name + " truncate"}>
													{source.name}
												</div>
											</div>
										</Card>
									);
								})}
							</div>
						</TabsContent>
						<TabsContent value="windows" className="h-full">
							<p className="text-[10px] text-zinc-500 mb-1 px-1">
								{t("sourceSelector.windowsNote")}
							</p>
							<div
								className={`grid grid-cols-2 gap-2 h-full overflow-y-auto pr-1 relative ${styles.sourceGridScroll}`}
							>
								{windowSources.length === 0 && (
									<div className="col-span-2 text-center text-xs text-zinc-500 py-8">
										{t("sourceSelector.noWindowsAvailable")}
									</div>
								)}
								{windowSources.map((source) => {
									const isSelected = selectedSource?.id === source.id;

									return (
										<Card
											key={source.id}
											className={`${styles.sourceCard} ${isSelected ? styles.selected : ""} cursor-pointer h-fit p-2 scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent`}
											style={{ margin: 8, width: "90%", maxWidth: 220 }}
											onClick={() => handleSourceSelect(source)}
											onKeyDown={(event) =>
												handleSourceKeyDown(event, source)
											}
											role="button"
											tabIndex={0}
											aria-pressed={isSelected}
										>
											<div className="p-1">
												<div className="relative mb-1">
													{source.thumbnail ? (
														<img
															src={source.thumbnail}
															alt={source.name}
															className="w-full aspect-video object-cover rounded border border-gray-700"
														/>
													) : (
														<div className="w-full aspect-video rounded border border-gray-700 bg-zinc-900/80 flex flex-col items-center justify-center text-zinc-400 gap-2">
															{source.appIcon ? (
																<img
																	src={source.appIcon}
																	alt="App icon"
																	className="w-8 h-8 rounded-md"
																/>
															) : (
																<div className="w-8 h-8 rounded-md bg-zinc-800 border border-zinc-700" />
															)}
															<div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
																{t(
																	"sourceSelector.windowPlaceholder",
																)}
															</div>
														</div>
													)}
													{isSelected && (
														<div className="absolute -top-1 -right-1">
															<div className="w-4 h-4 bg-blue-600 rounded-full flex items-center justify-center shadow-md">
																<MdCheck className={styles.icon} />
															</div>
														</div>
													)}
												</div>
												<div className="flex items-center gap-1">
													{source.appIcon && (
														<img
															src={source.appIcon}
															alt="App icon"
															className={
																styles.icon + " flex-shrink-0"
															}
														/>
													)}
													<div className={styles.name + " truncate"}>
														{source.name}
													</div>
												</div>
											</div>
										</Card>
									);
								})}
							</div>
						</TabsContent>
					</div>
				</Tabs>
			</div>
			<div className="border-t border-zinc-800 p-2 w-full max-w-xl">
				<div className="flex justify-center gap-2">
					<Button
						variant="outline"
						onClick={() => window.close()}
						className="px-4 py-1 text-xs bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700"
					>
						{t("sourceSelector.cancel")}
					</Button>
					<Button
						onClick={handleShare}
						disabled={!selectedSource}
						className="px-4 py-1 text-xs bg-[#2563EB] text-white hover:bg-[#2563EB]/80 disabled:opacity-50 disabled:bg-zinc-700"
					>
						{t("sourceSelector.share")}
					</Button>
				</div>
			</div>
		</div>
	);
}
