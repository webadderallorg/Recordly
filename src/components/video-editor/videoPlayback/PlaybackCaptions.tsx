import { Fragment } from "react";
import {
	getCaptionBackground,
	getCaptionDisplayText,
	getCaptionPreset,
	getCaptionWordColor,
	getCaptionWordOutline,
} from "../captionPresets";
import {
	CAPTION_LINE_HEIGHT,
	CAPTION_WORD_HIGHLIGHT,
	getCaptionPadding,
	getCaptionScaledFontSize,
	getCaptionScaledRadius,
	getCaptionTextMaxWidth,
	getCaptionWordVisualState,
} from "../captionStyle";
import type { PlaybackViewInput } from "./PlaybackView";
export function PlaybackCaptions(
	input: Pick<
		PlaybackViewInput,
		| "isGap"
		| "activeCaptionLayout"
		| "autoCaptionSettings"
		| "onEditAutoCaption"
		| "captionBoxRef"
		| "isCaptionEditing"
		| "te"
		| "beginCaptionEdit"
		| "captionFontFamily"
		| "overlayRef"
		| "captionEditSession"
		| "captionEditInputRef"
		| "setCaptionEditSession"
		| "captionEditSessionRef"
		| "commitCaptionEdit"
		| "cancelCaptionEdit"
		| "captionEditTextMetrics"
	>,
) {
	const {
		isGap,
		activeCaptionLayout,
		autoCaptionSettings,
		onEditAutoCaption,
		captionBoxRef,
		isCaptionEditing,
		te,
		beginCaptionEdit,
		captionFontFamily,
		overlayRef,
		captionEditSession,
		captionEditInputRef,
		setCaptionEditSession,
		captionEditSessionRef,
		commitCaptionEdit,
		cancelCaptionEdit,
		captionEditTextMetrics,
	} = input;
	const preset = getCaptionPreset(autoCaptionSettings?.style);
	const fontSize = autoCaptionSettings
		? getCaptionScaledFontSize(
				autoCaptionSettings.fontSize,
				overlayRef.current?.clientWidth || 960,
				autoCaptionSettings.maxWidth,
			)
		: 0;
	const boxWidth = activeCaptionLayout
		? Math.max(...activeCaptionLayout.visibleLines.map((line) => line.width), 0) +
			getCaptionPadding(fontSize).x * 2
		: 0;
	return !isGap && activeCaptionLayout && autoCaptionSettings ? (
		<div
			className="absolute inset-x-0 flex justify-center"
			style={{
				bottom: `${autoCaptionSettings.bottomOffset}%`,
				pointerEvents: onEditAutoCaption ? "auto" : "none",
			}}
		>
			<div
				style={{
					maxWidth: `${autoCaptionSettings.maxWidth}%`,
					opacity: activeCaptionLayout.opacity,
					transform: `translateY(${activeCaptionLayout.translateY}px) scale(${activeCaptionLayout.scale})`,
					transformOrigin: "center center",
				}}
			>
				<div
					ref={captionBoxRef}
					className="focus-visible:outline-2 focus-visible:outline-accent"
					role={onEditAutoCaption && !isCaptionEditing ? "button" : undefined}
					tabIndex={onEditAutoCaption && !isCaptionEditing ? 0 : undefined}
					aria-label={
						onEditAutoCaption && !isCaptionEditing
							? te("editCurrentCaption", "Edit current caption")
							: undefined
					}
					onClick={(event) => event.stopPropagation()}
					onDoubleClick={(event) => {
						event.stopPropagation();
						if (!isCaptionEditing) {
							beginCaptionEdit();
						}
					}}
					onPointerDown={(event) => {
						event.stopPropagation();
					}}
					onKeyDown={(event) => {
						if (!onEditAutoCaption || isCaptionEditing) {
							return;
						}

						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							beginCaptionEdit();
						}
					}}
					style={{
						width: captionEditSession ? undefined : `${boxWidth}px`,
						backgroundColor: getCaptionBackground(autoCaptionSettings),
						fontFamily: captionFontFamily,
						fontSize: `${getCaptionScaledFontSize(
							autoCaptionSettings.fontSize,
							overlayRef.current?.clientWidth || 960,
							autoCaptionSettings.maxWidth,
						)}px`,
						lineHeight: CAPTION_LINE_HEIGHT,
						textAlign: "center",
						fontWeight: preset.fontWeight,
						padding: `${
							getCaptionPadding(
								getCaptionScaledFontSize(
									autoCaptionSettings.fontSize,
									overlayRef.current?.clientWidth || 960,
									autoCaptionSettings.maxWidth,
								),
							).y
						}px ${
							getCaptionPadding(
								getCaptionScaledFontSize(
									autoCaptionSettings.fontSize,
									overlayRef.current?.clientWidth || 960,
									autoCaptionSettings.maxWidth,
								),
							).x
						}px`,
						borderRadius: `${getCaptionScaledRadius(
							autoCaptionSettings.boxRadius,
							getCaptionScaledFontSize(
								autoCaptionSettings.fontSize,
								overlayRef.current?.clientWidth || 960,
								autoCaptionSettings.maxWidth,
							),
						)}px`,
						boxSizing: "border-box",
						clipPath: "none",
						cursor: onEditAutoCaption && !isCaptionEditing ? "text" : undefined,
						pointerEvents: onEditAutoCaption ? "auto" : undefined,
					}}
				>
					{captionEditSession ? (
						<textarea
							ref={captionEditInputRef}
							value={captionEditSession.draft}
							onChange={(event) => {
								const draft = event.target.value;
								setCaptionEditSession((session) => {
									const nextSession = session ? { ...session, draft } : session;
									captionEditSessionRef.current = nextSession;
									return nextSession;
								});
							}}
							onBlur={commitCaptionEdit}
							onClick={(event) => event.stopPropagation()}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									cancelCaptionEdit();
									return;
								}

								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									event.currentTarget.blur();
								}
							}}
							rows={Math.max(1, activeCaptionLayout.visibleLines.length)}
							aria-label={te("editCurrentCaption", "Edit current caption")}
							style={{
								display: "block",
								width: `${
									captionEditTextMetrics?.widthPx ??
									Math.max(
										48,
										activeCaptionLayout.visibleLines.reduce(
											(width, line) => Math.max(width, line.width),
											0,
										),
									)
								}px`,
								maxWidth: `${
									captionEditTextMetrics?.maxTextWidthPx ??
									getCaptionTextMaxWidth(
										overlayRef.current?.clientWidth || 960,
										autoCaptionSettings.maxWidth,
										getCaptionScaledFontSize(
											autoCaptionSettings.fontSize,
											overlayRef.current?.clientWidth || 960,
											autoCaptionSettings.maxWidth,
										),
									)
								}px`,
								minHeight: `${
									Math.max(1, activeCaptionLayout.visibleLines.length) *
									(
										captionEditTextMetrics?.fontSize ??
											getCaptionScaledFontSize(
												autoCaptionSettings.fontSize,
												overlayRef.current?.clientWidth || 960,
												autoCaptionSettings.maxWidth,
											)
									) *
									CAPTION_LINE_HEIGHT
								}px`,
								resize: "none",
								border: "0",
								outline: "0",
								padding: "0",
								margin: "0",
								overflow: "hidden",
								background: "transparent",
								color: autoCaptionSettings.textColor,
								font: "inherit",
								lineHeight: "inherit",
								textAlign: "center",
							}}
						/>
					) : (
						activeCaptionLayout.visibleLines.map((line) => (
							<div
								key={`${activeCaptionLayout.blockKey}-${line.startWordIndex}`}
								style={{
									display: "block",
									height: `${CAPTION_LINE_HEIGHT}em`,
									whiteSpace: "nowrap",
								}}
							>
								{line.words.map((word) => {
									const visualState = getCaptionWordVisualState(
										activeCaptionLayout.hasWordTimings,
										word.state,
									);

									return (
										<Fragment
											key={`${activeCaptionLayout.blockKey}-${word.index}`}
										>
											{word.leadingSpace ? " " : ""}
											<span
												data-caption-word-state={word.state}
												data-caption-word-highlight={
													visualState.isHighlighted ? "" : undefined
												}
												style={{
													display: "inline-block",
													position: "relative",
													zIndex: visualState.isHighlighted ? 1 : 0,
													verticalAlign: "baseline",
													lineHeight: 1,
													fontSize: "1em",
													color: getCaptionWordColor(
														autoCaptionSettings,
														visualState,
													),
												}}
											>
												<span
													data-caption-word-visual=""
													style={{
														display: "inline-block",
														position: "relative",
													}}
												>
													{visualState.isHighlighted &&
														preset.highlightFill && (
															<span
																aria-hidden="true"
																style={{
																	position: "absolute",
																	pointerEvents: "none",
																	inset: `-${CAPTION_WORD_HIGHLIGHT.paddingYEm}em -${CAPTION_WORD_HIGHLIGHT.paddingXEm}em`,
																	borderRadius: `${CAPTION_WORD_HIGHLIGHT.radiusEm}em`,
																	background:
																		preset.highlightFill,
																}}
															/>
														)}
													<span
														style={{
															position: "relative",
															WebkitTextStroke: getCaptionWordOutline(
																autoCaptionSettings,
																visualState,
															)
																? `${getCaptionWordOutline(autoCaptionSettings, visualState)}em #000000`
																: undefined,
															paintOrder: "stroke fill",
														}}
													>
														{getCaptionDisplayText(
															word.text,
															autoCaptionSettings.style,
														)}
													</span>
												</span>
											</span>
										</Fragment>
									);
								})}
							</div>
						))
					)}
				</div>
			</div>
		</div>
	) : null;
}
