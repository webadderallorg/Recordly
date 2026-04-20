import minimalCursorUrl from "../../../Minimal Cursor.svg";
import tahoeCursorUrl from "../../assets/cursors/Cursor=Default.svg";
import type { CursorStyle } from "./types";

export { minimalCursorUrl, tahoeCursorUrl };

export function CursorStylePreview({
	style,
	previewUrls,
}: {
	style: CursorStyle;
	previewUrls: Partial<Record<string, string>>;
}) {
	const previewSrc =
		style === "tahoe"
			? (previewUrls.tahoe ?? tahoeCursorUrl)
			: style === "figma"
				? (previewUrls.figma ?? minimalCursorUrl)
				: style === "mono"
					? (previewUrls.mono ?? tahoeCursorUrl)
					: previewUrls[style];

	if (style === "tahoe") {
		return (
			<img
				src={previewSrc}
				alt=""
				className="h-7 w-7 object-contain drop-shadow-[0_8px_12px_rgba(15,23,42,0.18)]"
				draggable={false}
			/>
		);
	}

	if (style === "figma") {
		return <img src={previewSrc} alt="" className="h-7 w-7 object-contain" draggable={false} />;
	}

	if (style === "dot") {
		return (
			<span className="h-[14px] w-[14px] rounded-full border-[2.5px] border-neutral-800 bg-white shadow-[0_8px_12px_rgba(15,23,42,0.16)]" />
		);
	}

	return (
		<img
			src={previewSrc ?? tahoeCursorUrl}
			alt=""
			className="h-7 w-7 object-contain"
			draggable={false}
		/>
	);
}
