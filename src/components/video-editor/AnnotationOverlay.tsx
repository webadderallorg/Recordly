import { useScopedT } from "@/contexts/I18nContext";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { cn } from "@/lib/utils";
import { getArrowComponent } from "./ArrowSvgs";
import { type AnnotationRegion, BASE_PREVIEW_WIDTH, BLUR_ANNOTATION_STRENGTH } from "./types";

type Rect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

type SceneTransform = {
	scale: number;
	x: number;
	y: number;
};

interface AnnotationOverlayProps {
	annotation: AnnotationRegion;
	isSelected: boolean;
	containerWidth: number;
	containerHeight: number;
	recordingRect: Rect;
	sceneTransform: SceneTransform;
	interactionScale?: number;
	onPositionChange: (id: string, position: { x: number; y: number }) => void;
	onSizeChange: (id: string, size: { width: number; height: number }) => void;
	onClick: (id: string) => void;
	onContentChange?: (id: string, content: string) => void;
	onDelete?: (id: string) => void;
	onTextEditStart?: () => void;
	zIndex: number;
	isSelectedBoost: boolean; // Boost z-index when selected for easy editing
}

function positivePercent(value: number) {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.max(1, value);
}

/** Render an annotation in preview space with editor drag and resize controls. */
export function AnnotationOverlay({
	annotation,
	isSelected,
	containerWidth,
	containerHeight,
	recordingRect,
	sceneTransform,
	interactionScale = 1,
	onPositionChange,
	onSizeChange,
	onClick,
	onContentChange,
	onDelete,
	onTextEditStart,
	zIndex,
	isSelectedBoost,
}: AnnotationOverlayProps) {
	const te = useScopedT("editing");
	const safeRecordingRect =
		recordingRect.width > 0 && recordingRect.height > 0
			? recordingRect
			: { x: 0, y: 0, width: containerWidth, height: containerHeight };
	const sceneX = safeRecordingRect.x + (annotation.position.x / 100) * safeRecordingRect.width;
	const sceneY = safeRecordingRect.y + (annotation.position.y / 100) * safeRecordingRect.height;
	const sceneWidth = (annotation.size.width / 100) * safeRecordingRect.width;
	const sceneHeight = (annotation.size.height / 100) * safeRecordingRect.height;
	const x = sceneX * sceneTransform.scale + sceneTransform.x;
	const y = sceneY * sceneTransform.scale + sceneTransform.y;
	const width = sceneWidth * sceneTransform.scale;
	const height = sceneHeight * sceneTransform.scale;
	const sizeScale = (safeRecordingRect.width / BASE_PREVIEW_WIDTH) * sceneTransform.scale;

	const isDraggingRef = useRef(false);
	const dragOriginRef = useRef({ x, y });
	const rndRef = useRef<Rnd>(null);
	const textInputRef = useRef<HTMLTextAreaElement>(null);
	const [textDraft, setTextDraft] = useState<string | null>(null);
	const draftRef = useRef<string | null>(null);
	const isEditing = textDraft !== null;

	const finishTextEdit = () => {
		const draft = draftRef.current;
		if (draft === null) return;
		draftRef.current = null;
		setTextDraft(null);
		if (!draft.trim() && onDelete) onDelete(annotation.id);
		else if (draft !== annotation.content) onContentChange?.(annotation.id, draft);
	};
	const beginTextEdit = () => {
		if (isEditing || annotation.type !== "text" || !onContentChange) return;
		onClick(annotation.id);
		onTextEditStart?.();
		draftRef.current = annotation.content;
		setTextDraft(annotation.content);
	};

	useEffect(() => {
		if (!isEditing) return;
		textInputRef.current?.focus();
		textInputRef.current?.select();
	}, [isEditing]);

	const textStyle: CSSProperties = {
		color: annotation.style.color,
		backgroundColor: annotation.style.backgroundColor,
		fontSize: `${annotation.style.fontSize * sizeScale}px`,
		fontFamily: annotation.style.fontFamily,
		fontWeight: annotation.style.fontWeight,
		fontStyle: annotation.style.fontStyle,
		textDecoration: annotation.style.textDecoration,
		textAlign: annotation.style.textAlign,
		wordBreak: "break-word",
		whiteSpace: "pre-wrap",
		boxDecorationBreak: "clone",
		WebkitBoxDecorationBreak: "clone",
		padding: "0.1em 0.2em",
		borderRadius: `${4 * sizeScale}px`,
		lineHeight: "1.4",
	};

	const screenRectToRecordingPercent = (rect: Rect) => {
		const nextSceneX = (rect.x - sceneTransform.x) / sceneTransform.scale;
		const nextSceneY = (rect.y - sceneTransform.y) / sceneTransform.scale;
		const nextSceneWidth = rect.width / sceneTransform.scale;
		const nextSceneHeight = rect.height / sceneTransform.scale;

		return {
			position: {
				x:
					((nextSceneX - safeRecordingRect.x) / Math.max(1, safeRecordingRect.width)) *
					100,
				y:
					((nextSceneY - safeRecordingRect.y) / Math.max(1, safeRecordingRect.height)) *
					100,
			},
			size: {
				width: positivePercent(
					(nextSceneWidth / Math.max(1, safeRecordingRect.width)) * 100,
				),
				height: positivePercent(
					(nextSceneHeight / Math.max(1, safeRecordingRect.height)) * 100,
				),
			},
		};
	};

	const renderArrow = () => {
		const direction = annotation.figureData?.arrowDirection || "right";
		const color = annotation.figureData?.color || "#2563EB";
		const strokeWidth = annotation.figureData?.strokeWidth || 4;

		const ArrowComponent = getArrowComponent(direction);
		return <ArrowComponent color={color} strokeWidth={strokeWidth} />;
	};

	const renderContent = () => {
		switch (annotation.type) {
			case "text":
				return (
					<div
						className="w-full min-h-full flex items-center"
						style={{
							justifyContent:
								annotation.style.textAlign === "left"
									? "flex-start"
									: annotation.style.textAlign === "right"
										? "flex-end"
										: "center",
							padding: `${8 * sizeScale}px`,
						}}
					>
						{isEditing ? (
							<textarea
								ref={textInputRef}
								aria-label={te("editAnnotationText", "Edit annotation text")}
								data-annotation-text-editor
								value={textDraft}
								onChange={(event) => {
									draftRef.current = event.target.value;
									setTextDraft(event.target.value);
								}}
								onBlur={finishTextEdit}
								onPointerDown={(event) => event.stopPropagation()}
								onClick={(event) => event.stopPropagation()}
								onKeyDown={(event) => {
									event.stopPropagation();
									if (event.nativeEvent.isComposing) return;
									if (
										event.key === "Escape" ||
										(event.key === "Enter" && (event.ctrlKey || event.metaKey))
									) {
										event.preventDefault();
										finishTextEdit();
										rndRef.current?.getSelfElement()?.focus();
									}
								}}
								style={{
									...textStyle,
									width: "100%",
									minHeight: "1.4em",
									height: `${Math.max(height - 16 * sizeScale, (textDraft.split("\n").length + 1) * annotation.style.fontSize * sizeScale * 1.4)}px`,
									resize: "none",
									border: 0,
									outline: "none",
									overflow: "auto",
									cursor: "text",
								}}
							/>
						) : (
							<span data-annotation-text style={{ ...textStyle, maxWidth: "100%" }}>
								{annotation.content}
							</span>
						)}
					</div>
				);

			case "image":
				if (annotation.content && annotation.content.startsWith("data:image")) {
					return (
						<img
							src={annotation.content}
							alt={te("annotation", "Annotation")}
							className="w-full h-full object-contain"
							draggable={false}
						/>
					);
				}
				return (
					<div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
						{te("noImage", "No image")}
					</div>
				);

			case "figure":
				if (!annotation.figureData) {
					return (
						<div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
							{te("noArrowData", "No arrow data")}
						</div>
					);
				}

				return (
					<div
						className="w-full h-full flex items-center justify-center"
						style={{ padding: `${8 * sizeScale}px` }}
					>
						{renderArrow()}
					</div>
				);

			case "blur": {
				const currentBlurStrength = annotation.blurIntensity ?? BLUR_ANNOTATION_STRENGTH;
				const blurPx = currentBlurStrength * sizeScale;
				const blurStyle = `blur(${blurPx}px)`;

				return (
					<div
						data-blur-redaction
						className="h-full w-full bg-slate-400/10"
						style={{
							backdropFilter: blurStyle,
							WebkitBackdropFilter: blurStyle,
							backgroundColor: annotation.blurColor || "transparent",
							borderRadius: 0,
						}}
					/>
				);
			}

			default:
				return null;
		}
	};

	return (
		<Rnd
			ref={rndRef}
			tabIndex={0}
			aria-label={
				annotation.type === "text"
					? te("textAnnotation", "Text annotation")
					: te("annotation", "Annotation")
			}
			onDoubleClick={beginTextEdit}
			disableDragging={isEditing}
			cancel="textarea"
			data-annotation-id={annotation.id}
			position={{ x, y }}
			size={{ width, height }}
			minWidth={Math.max(1, safeRecordingRect.width * sceneTransform.scale * 0.01)}
			minHeight={Math.max(1, safeRecordingRect.height * sceneTransform.scale * 0.01)}
			scale={interactionScale}
			onDragStart={(_event, data) => {
				dragOriginRef.current = { x: data.x, y: data.y };
				onClick(annotation.id);
				isDraggingRef.current = true;
			}}
			onDragStop={(_e, d) => {
				const origin = dragOriginRef.current;
				if (Math.hypot(d.x - origin.x, d.y - origin.y) * interactionScale < 2) {
					rndRef.current?.updatePosition(origin);
				} else {
					const next = screenRectToRecordingPercent({ x: d.x, y: d.y, width, height });
					onPositionChange(annotation.id, next.position);
				}

				// Reset dragging flag after a short delay to prevent click event
				setTimeout(() => {
					isDraggingRef.current = false;
				}, 100);
			}}
			onResizeStop={(_e, _direction, ref, _delta, position) => {
				const next = screenRectToRecordingPercent({
					x: position.x,
					y: position.y,
					width: ref.offsetWidth,
					height: ref.offsetHeight,
				});
				onPositionChange(annotation.id, next.position);
				onSizeChange(annotation.id, next.size);
			}}
			onClick={() => {
				if (isDraggingRef.current) return;
				onClick(annotation.id);
			}}
			bounds="parent"
			className={cn(
				// Camera transforms and redaction bounds must update on the same frame.
				"cursor-move transition-none",
				isSelected && "ring-2 ring-[#2563EB] ring-offset-2 ring-offset-transparent",
			)}
			style={{
				zIndex: isSelectedBoost ? zIndex + 1000 : zIndex, // Boost selected annotation to ensure it's on top
				pointerEvents: "auto",
				// Selection chrome must not shrink or tint the pixels being censored.
				outline: isSelected ? "2px solid rgba(37, 99, 235, 0.8)" : "none",
				backgroundColor:
					isSelected && annotation.type !== "blur"
						? "rgba(37, 99, 235, 0.1)"
						: "transparent",
				boxShadow: isSelected ? "0 0 0 1px rgba(37, 99, 235, 0.35)" : "none",
			}}
			enableResizing={{
				topLeft: isSelected && !isEditing,
				topRight: isSelected && !isEditing,
				bottomLeft: isSelected && !isEditing,
				bottomRight: isSelected && !isEditing,
				top: false,
				right: false,
				bottom: false,
				left: false,
			}}
			resizeHandleComponent={{
				topLeft: <span data-annotation-resize="top-left" className="block size-full" />,
				topRight: <span data-annotation-resize="top-right" className="block size-full" />,
				bottomLeft: (
					<span data-annotation-resize="bottom-left" className="block size-full" />
				),
				bottomRight: (
					<span data-annotation-resize="bottom-right" className="block size-full" />
				),
			}}
			resizeHandleStyles={{
				topLeft: {
					width: "12px",
					height: "12px",
					backgroundColor: isSelected ? "white" : "transparent",
					border: isSelected ? "2px solid #2563EB" : "none",
					borderRadius: "50%",
					left: "-6px",
					top: "-6px",
					cursor: "nwse-resize",
				},
				topRight: {
					width: "12px",
					height: "12px",
					backgroundColor: isSelected ? "white" : "transparent",
					border: isSelected ? "2px solid #2563EB" : "none",
					borderRadius: "50%",
					right: "-6px",
					top: "-6px",
					cursor: "nesw-resize",
				},
				bottomLeft: {
					width: "12px",
					height: "12px",
					backgroundColor: isSelected ? "white" : "transparent",
					border: isSelected ? "2px solid #2563EB" : "none",
					borderRadius: "50%",
					left: "-6px",
					bottom: "-6px",
					cursor: "nesw-resize",
				},
				bottomRight: {
					width: "12px",
					height: "12px",
					backgroundColor: isSelected ? "white" : "transparent",
					border: isSelected ? "2px solid #2563EB" : "none",
					borderRadius: "50%",
					right: "-6px",
					bottom: "-6px",
					cursor: "nwse-resize",
				},
			}}
		>
			<div
				className={cn(
					"w-full h-full",
					annotation.type !== "blur" && "rounded-lg",
					annotation.type === "text" && "bg-transparent",
					annotation.type === "image" && "bg-transparent",
					annotation.type === "figure" && "bg-transparent",
					isSelected && "shadow-lg",
				)}
			>
				{renderContent()}
			</div>
		</Rnd>
	);
}
