import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	buildCaptionBlock,
	type CaptionBlock,
	type CaptionFrameSize,
	ensureCaptionSettingsFontLoaded,
	getCaptionBlockCenter,
	paintCaptionBlock,
} from "@/lib/captions/captionPainter";
import type { CaptionEditTarget } from "../captionEditing";
import { CAPTION_LINE_HEIGHT, getCaptionScaledRadius } from "../captionStyle";
import type { AutoCaptionSettings, CaptionCue } from "../types";
import { type CaptionEditSession, useCaptionEditSession } from "./useCaptionEditSession";

export interface CaptionOverlayHandle {
	cancelEdit: () => void;
}

interface CaptionOverlayProps {
	cues: CaptionCue[];
	settings: AutoCaptionSettings | null;
	currentTimeSec: number;
	onEditCaption?: (target: CaptionEditTarget, text: string) => void;
	onBeginEdit: () => void;
}

function useElementSize(ref: React.RefObject<HTMLElement>): CaptionFrameSize {
	const [size, setSize] = useState<CaptionFrameSize>({ width: 0, height: 0 });
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
		update();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);
	return size;
}

/** Re-renders once the caption face has loaded so canvas text never keeps a fallback font. */
function useCaptionFontVersion(settings: AutoCaptionSettings | null, frameWidth: number) {
	const [version, setVersion] = useState(0);
	useEffect(() => {
		if (!settings?.enabled || frameWidth <= 0) return;
		let cancelled = false;
		void ensureCaptionSettingsFontLoaded(settings, frameWidth).then(() => {
			if (!cancelled) setVersion((current) => current + 1);
		});
		return () => {
			cancelled = true;
		};
	}, [settings, frameWidth]);
	return version;
}

function useCaptionCanvasPaint(
	canvasRef: React.RefObject<HTMLCanvasElement>,
	options: {
		block: CaptionBlock | null;
		settings: AutoCaptionSettings | null;
		frame: CaptionFrameSize;
	},
) {
	const { block, settings, frame } = options;
	useLayoutEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;
		const pixelRatio = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.round(frame.width * pixelRatio));
		const height = Math.max(1, Math.round(frame.height * pixelRatio));
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
		ctx.clearRect(0, 0, frame.width, frame.height);
		if (block && settings) paintCaptionBlock(ctx, block, settings);
	}, [canvasRef, block, settings, frame]);
}

function CaptionEditBox(props: {
	block: CaptionBlock;
	settings: AutoCaptionSettings;
	frame: CaptionFrameSize;
	session: CaptionEditSession;
	inputRef: React.RefObject<HTMLTextAreaElement>;
	measureContext: CanvasRenderingContext2D | null;
	onDraftChange: (draft: string) => void;
	onCommit: () => void;
	onCancel: () => void;
}) {
	const { block, settings, frame, session, measureContext } = props;
	const { typography } = block;
	if (measureContext) measureContext.font = typography.font;
	const draftWidth = Math.max(
		...session.draft
			.split(/\r?\n/)
			.map((line) => measureContext?.measureText(line || " ").width ?? block.boxWidth),
	);
	const width = Math.min(
		frame.width * (settings.maxWidth / 100) + typography.padding.x * 2,
		Math.max(block.boxWidth, draftWidth + typography.padding.x * 2 + 2),
	);
	const { centerX, centerY } = getCaptionBlockCenter(settings, frame, {
		width,
		height: block.boxHeight,
	});

	return (
		<div
			className="absolute"
			style={{
				left: centerX - width / 2,
				top: centerY - block.boxHeight / 2,
				width,
				padding: `${typography.padding.y}px ${typography.padding.x}px`,
				boxSizing: "border-box",
				backgroundColor: `rgba(0, 0, 0, ${Math.max(0.6, settings.backgroundOpacity)})`,
				borderRadius: getCaptionScaledRadius(settings.boxRadius, typography.fontSize),
				pointerEvents: "auto",
			}}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<textarea
				ref={props.inputRef}
				value={session.draft}
				rows={Math.max(1, block.layout.visibleLines.length)}
				aria-label="Edit current caption"
				onChange={(event) => props.onDraftChange(event.target.value)}
				onBlur={props.onCommit}
				onClick={(event) => event.stopPropagation()}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						props.onCancel();
					} else if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						event.currentTarget.blur();
					}
				}}
				style={{
					display: "block",
					width: "100%",
					resize: "none",
					border: 0,
					outline: 0,
					padding: 0,
					margin: 0,
					overflow: "hidden",
					background: "transparent",
					color: settings.textColor,
					font: typography.font,
					lineHeight: CAPTION_LINE_HEIGHT,
					textAlign: settings.horizontalAlign,
					textTransform: settings.uppercase ? "uppercase" : "none",
				}}
			/>
		</div>
	);
}

function CaptionHitArea(props: { block: CaptionBlock; onActivate: () => void }) {
	const { block } = props;
	return (
		<div
			role="button"
			tabIndex={0}
			aria-label="Edit current caption"
			className="absolute"
			style={{
				left: block.centerX - block.boxWidth / 2,
				top: block.centerY - block.boxHeight / 2,
				width: block.boxWidth,
				height: block.boxHeight,
				transform: `translateY(${block.layout.translateY}px) scale(${block.layout.scale})`,
				cursor: "text",
				pointerEvents: "auto",
			}}
			onPointerDown={(event) => event.stopPropagation()}
			onClick={(event) => {
				event.stopPropagation();
				props.onActivate();
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					props.onActivate();
				}
			}}
		/>
	);
}

/** Preview captions drawn with the same painter as exports, plus inline editing. */
export const CaptionOverlay = forwardRef<CaptionOverlayHandle, CaptionOverlayProps>(
	function CaptionOverlay({ cues, settings, currentTimeSec, onEditCaption, onBeginEdit }, ref) {
		const rootRef = useRef<HTMLDivElement>(null);
		const canvasRef = useRef<HTMLCanvasElement>(null);
		const measureContext = useMemo(
			() =>
				typeof document === "undefined"
					? null
					: document.createElement("canvas").getContext("2d"),
			[],
		);
		const frame = useElementSize(rootRef);
		const fontVersion = useCaptionFontVersion(settings, frame.width);

		// biome-ignore lint/correctness/useExhaustiveDependencies: fontVersion re-measures once the web font replaces the fallback face.
		const block = useMemo(() => {
			if (!settings || !measureContext || frame.width <= 0 || frame.height <= 0) return null;
			return buildCaptionBlock({
				cues,
				timeMs: Math.round(currentTimeSec * 1000),
				settings,
				frame,
				measureContext,
			});
		}, [cues, currentTimeSec, settings, frame, measureContext, fontVersion]);

		const edit = useCaptionEditSession({
			editTarget: block?.layout.editTarget ?? null,
			onEditCaption,
			onBeginEdit,
		});
		useImperativeHandle(ref, () => ({ cancelEdit: edit.cancelEdit }), [edit.cancelEdit]);
		useCaptionCanvasPaint(canvasRef, { block: edit.session ? null : block, settings, frame });

		return (
			<div ref={rootRef} className="pointer-events-none absolute inset-0">
				<canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
				{block && settings && edit.session ? (
					<CaptionEditBox
						block={block}
						settings={settings}
						frame={frame}
						session={edit.session}
						inputRef={edit.inputRef}
						measureContext={measureContext}
						onDraftChange={edit.setDraft}
						onCommit={edit.commitEdit}
						onCancel={edit.cancelEdit}
					/>
				) : null}
				{block && onEditCaption && !edit.session ? (
					<CaptionHitArea block={block} onActivate={edit.beginEdit} />
				) : null}
			</div>
		);
	},
);
