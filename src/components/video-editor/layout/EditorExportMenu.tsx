import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import "./EditorExportMenu.css";
import { Tag, TagGroup } from "@heroui/react";
import { RecordlyMark } from "@/components/ui/RecordlyMark";
import { motion, useReducedMotion } from "motion/react";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { useI18n } from "@/contexts/I18nContext";
import { captureProjectThumbnailCanvas } from "@/lib/projectThumbnailCanvas";
import { CloudShareButton } from "../cloud/CloudShareButton";
import { ExportSettingsMenu } from "../ExportSettingsMenu";
import type { useExportDimensions } from "../export/useExportDimensions";
import type { useExportSession } from "../export/useExportSession";
import type { useExportSettings } from "../export/useExportSettings";
import type { useExportStatusViewModel } from "../export/useExportStatusViewModel";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { EditorExportCard } from "./EditorExportCard";
import { PublishLinkIcon, PublishSaveIcon } from "./PublishDestinationIcons";

type Props = {
	projectRevision?: string;
	projectPath?: string | null;
	projectSourcePath?: string | null;
	t: ReturnType<typeof useI18n>["t"];
	videoPlaybackRef?: RefObject<VideoPlaybackRef | null>;
	exportSettings: ReturnType<typeof useExportSettings>;
	exportSession: ReturnType<typeof useExportSession>;
	exportDimensions: ReturnType<typeof useExportDimensions>;
	exportStatus: ReturnType<typeof useExportStatusViewModel>;
	hasCaptionsForSidecar: boolean;
	nvidiaCudaExportAvailable: boolean;
	experimentalNvidiaCudaExport: boolean;
	setExperimentalNvidiaCudaExport: (enabled: boolean) => void;
	handleOpenExportDropdown: () => void;
	handleExportDropdownClose: () => void;
	handleCancelExport: () => void;
	handleRetrySaveExport: () => void;
	handleStartExportFromDropdown: () => void;
	revealExportedFile: () => void;
	projectTitle: string;
	prepareExportForShare: () => Promise<string | undefined>;
	onRequestShareSignIn: () => void;
	shareRequestNonce: number;
	authToken?: string;
	accountId?: string;
};

export function EditorExportMenu(props: Props) {
	const { t: uiText } = useUiLocale();
	const shareLinkLabel = uiText("ui.createShareLink");
	const saveToDeviceLabel = uiText("ui.saveToDevice", "Save to device");
	const { publishDestination: destination, setPublishDestination: setDestination } =
		props.exportSettings;
	const [shareBusy, setShareBusy] = useState(false);
	const [hasStartedShare, setHasStartedShare] = useState(false);
	const [shareActivity, setShareActivity] = useState(false);
	const [shareContainer, setShareContainer] = useState<HTMLDivElement | null>(null);
	const [thumbnail, setThumbnail] = useState<string>();
	const { videoPlaybackRef } = props;
	const {
		isExporting,
		exportProgress,
		exportError,
		showExportDropdown,
		setShowExportDropdown,
		exportedFilePath,
		hasPendingExportSave,
	} = props.exportSession;
	const captureThumbnail = useCallback(() => {
		const preview = videoPlaybackRef?.current;
		const app = preview?.app;
		try {
			const canvas = app?.canvas;
			if (
				app &&
				preview?.composedFrame &&
				canvas instanceof HTMLCanvasElement &&
				canvas.width &&
				canvas.height
			) {
				app.render();
				setThumbnail(captureProjectThumbnailCanvas(canvas, canvas.width, canvas.height));
				return;
			}
		} catch {
			// The export can proceed with the format icon when the preview cannot be captured.
		}
		setThumbnail(undefined);
	}, [videoPlaybackRef]);
	const handleShareBusyChange = useCallback(
		(busy: boolean) => {
			setShareBusy(busy);
			if (busy) {
				setHasStartedShare(true);
				captureThumbnail();
				setShareActivity(true);
				setShowExportDropdown(false);
			}
		},
		[captureThumbnail, setShowExportDropdown],
	);
	const dismissShareActivity = useCallback(() => setShareActivity(false), []);
	const localExportInProgress = destination === "local" && isExporting;
	const showLocalExportCard =
		destination === "local" && (isExporting || Boolean(exportError || exportedFilePath));
	const publishMenuOpen = showExportDropdown && !showLocalExportCard && !shareBusy;
	const reducedMotion = useReducedMotion();
	const handledShareRequest = useRef(0);
	const contentRef = useRef<HTMLDivElement>(null);
	const [contentHeight, setContentHeight] = useState<number>();
	useLayoutEffect(() => {
		if (!publishMenuOpen) return;
		const content = contentRef.current;
		if (!content) return;
		// The popover scales in on entry. Its bounding rect includes that scale,
		// so measuring it would lock the wrapper to a height smaller than its content.
		const measure = () => setContentHeight(content.offsetHeight);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(content);
		return () => observer.disconnect();
	}, [publishMenuOpen]);
	useEffect(() => {
		if (props.shareRequestNonce > handledShareRequest.current) {
			handledShareRequest.current = props.shareRequestNonce;
			if (isExporting || shareBusy) return;
			setDestination("link");
			props.handleOpenExportDropdown();
		}
	}, [
		props.shareRequestNonce,
		props.handleOpenExportDropdown,
		setDestination,
		isExporting,
		shareBusy,
	]);

	const {
		t,
		exportSettings,
		exportSession,
		exportDimensions,
		exportStatus,
		hasCaptionsForSidecar,
		nvidiaCudaExportAvailable,
		experimentalNvidiaCudaExport,
		setExperimentalNvidiaCudaExport,
		handleOpenExportDropdown,
		handleExportDropdownClose,
		handleCancelExport,
		handleRetrySaveExport,
		handleStartExportFromDropdown,
		revealExportedFile,
	} = props;
	const {
		exportQuality,
		setExportQuality,
		exportEncodingMode,
		setExportEncodingMode,
		exportPipelineModel,
		mp4FrameRate,
		setMp4FrameRate,
		exportFormat,
		setExportFormat,
		gifFrameRate,
		setGifFrameRate,
		gifOptimizeSize,
		setGifOptimizeSize,
		gifLoop,
		setGifLoop,
		gifSizePreset,
		setGifSizePreset,
		includeCaptionSidecar,
		setIncludeCaptionSidecar,
	} = exportSettings;
	const { mp4OutputDimensions } = exportDimensions;

	const settingsForm = (
		<ExportSettingsMenu
			advancedExportSettings={exportSettings.advancedExportSettings}
			onAdvancedExportSettingsChange={exportSettings.setAdvancedExportSettings}
			customExportResolution={exportSettings.customExportResolution}
			onCustomExportResolutionChange={exportSettings.setCustomExportResolution}
			mp4SizeEstimate={exportSession.mp4SizeEstimate}
			exportFormat={destination === "link" ? "mp4" : exportFormat}
			onExportFormatChange={setExportFormat}
			exportEncodingMode={exportEncodingMode}
			onExportEncodingModeChange={setExportEncodingMode}
			mp4FrameRate={mp4FrameRate}
			onMp4FrameRateChange={setMp4FrameRate}
			exportPipelineModel={exportPipelineModel}
			experimentalNvidiaCudaExport={experimentalNvidiaCudaExport && nvidiaCudaExportAvailable}
			onExperimentalNvidiaCudaExportChange={setExperimentalNvidiaCudaExport}
			nvidiaCudaExportAvailable={nvidiaCudaExportAvailable}
			exportQuality={exportQuality}
			onExportQualityChange={setExportQuality}
			gifFrameRate={gifFrameRate}
			onGifFrameRateChange={setGifFrameRate}
			gifSizeEstimate={exportSession.gifSizeEstimate}
			gifOptimizeSize={gifOptimizeSize}
			onGifOptimizeSizeChange={setGifOptimizeSize}
			gifLoop={gifLoop}
			onGifLoopChange={setGifLoop}
			gifSizePreset={gifSizePreset}
			onGifSizePresetChange={setGifSizePreset}
			showCaptionSidecarOption={hasCaptionsForSidecar && exportFormat === "mp4"}
			includeCaptionSidecar={includeCaptionSidecar}
			onIncludeCaptionSidecarChange={setIncludeCaptionSidecar}
			mp4OutputDimensions={mp4OutputDimensions}
			onExport={() => {
				captureThumbnail();
				handleStartExportFromDropdown();
			}}
			hideHeading
			hideAction={destination === "link"}
			linkMode={destination === "link"}
			className="rounded-none bg-transparent px-5 pt-0 shadow-none"
		/>
	);

	return (
		<>
			<Popover
				open={publishMenuOpen}
				onOpenChange={(open) => {
					if (shareBusy || localExportInProgress) return;
					if (open) {
						dismissShareActivity();
						handleOpenExportDropdown();
					} else setShowExportDropdown(false);
				}}
				modal={true}
			>
				<PopoverTrigger asChild>
					<Button
						type="button"
						disabled={localExportInProgress || hasPendingExportSave || shareBusy}
						className="inline-flex h-9 min-w-[104px] items-center justify-center gap-2 px-4.5"
					>
						<RecordlyMark />
						<span className="text-sm font-semibold tracking-tight">
							{uiText("ui.publish")}
						</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent
					aria-label={uiText("ui.publish")}
					align="end"
					sideOffset={10}
					className="publish-menu w-[360px] max-h-[inherit] overflow-hidden p-0"
					isKeyboardDismissDisabled={shareBusy}
					shouldCloseOnInteractOutside={() => !shareBusy}
				>
					<motion.div
						initial={false}
						animate={{ height: contentHeight ?? "auto" }}
						transition={{ duration: reducedMotion ? 0 : 0.22, ease: "easeInOut" }}
						className="max-h-[inherit] overflow-hidden"
					>
						<div
							ref={contentRef}
							className="publish-menu-scroll max-h-[inherit] overflow-y-auto"
						>
							{(!isExporting || destination === "link") && (
								<div className="p-5 space-y-3">
									<h2 className="text-sm font-semibold">
										{uiText("ui.publish")}
									</h2>
									<TagGroup
										aria-label={uiText("ui.publishDestination")}
										selectionMode="single"
										disallowEmptySelection
										selectedKeys={[destination]}
										onSelectionChange={(keys) => {
											if (
												keys !== "all" &&
												keys.size > 0 &&
												!isExporting &&
												!shareBusy
											)
												setDestination(keys.has("link") ? "link" : "local");
										}}
									>
										<TagGroup.List className="flex gap-2">
											<Tag
												id="link"
												textValue={shareLinkLabel}
												isDisabled={isExporting || shareBusy}
												className="h-24 flex-1 flex-col justify-center gap-2 rounded-xl border border-foreground/10"
											>
												{({ isHovered, isDisabled }) => (
													<>
														<PublishLinkIcon
															hovered={
																isHovered &&
																!isDisabled &&
																!reducedMotion
															}
														/>
														{shareLinkLabel}
													</>
												)}
											</Tag>
											<Tag
												id="local"
												textValue={saveToDeviceLabel}
												isDisabled={isExporting || shareBusy}
												className="h-24 flex-1 flex-col justify-center gap-2 rounded-xl border border-foreground/10"
											>
												{({ isHovered, isDisabled }) => (
													<>
														<PublishSaveIcon
															hovered={
																isHovered &&
																!isDisabled &&
																!reducedMotion
															}
														/>
														{saveToDeviceLabel}
													</>
												)}
											</Tag>
										</TagGroup.List>
									</TagGroup>
								</div>
							)}
							<div>
								{destination === "link" ? (
									<div className="px-5 pb-5" ref={setShareContainer} />
								) : (
									<>{settingsForm}</>
								)}
							</div>
						</div>
					</motion.div>
				</PopoverContent>
			</Popover>
			{(hasStartedShare || (destination === "link" && publishMenuOpen)) && (
				<CloudShareButton
					inline
					projectPath={props.projectPath}
					projectSourcePath={props.projectSourcePath}
					projectRevision={props.projectRevision}
					projectTitle={props.projectTitle}
					prepareFile={props.prepareExportForShare}
					onCancelPrepare={handleCancelExport}
					preparationProgress={exportProgress?.percentage ?? 0}
					authToken={props.authToken}
					accountId={props.accountId}
					onBusyChange={handleShareBusyChange}
					onRequestSignIn={() => {
						setShowExportDropdown(false);
						props.onRequestShareSignIn();
					}}
					floatingActivity={{
						formContainer:
							publishMenuOpen && destination === "link" ? shareContainer : null,
						visible: destination === "link" && shareActivity,
						thumbnail,
						onDismiss: dismissShareActivity,
						onRetry: () => {
							dismissShareActivity();
							handleOpenExportDropdown();
						},
					}}
				/>
			)}
			{showLocalExportCard && (
				<EditorExportCard
					t={t}
					session={exportSession}
					status={exportStatus}
					format={exportFormat}
					projectTitle={props.projectTitle}
					thumbnail={thumbnail}
					onCancel={handleCancelExport}
					onDismiss={handleExportDropdownClose}
					onRetrySave={handleRetrySaveExport}
					onRevealFile={revealExportedFile}
				/>
			)}
		</>
	);
}
