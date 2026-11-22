import { useId } from "react";
import { WallpaperGlassFilter } from "../WallpaperGlassFilter";
import "./ProjectPreviewGlass.css";

/** Reuse the wallpaper lens for still frames and live project previews. */
export function ProjectPreviewGlass() {
	const id = `project-preview-glass-${useId().replace(/:/g, "")}`;
	return (
		<>
			<WallpaperGlassFilter id={id} />
			<div
				aria-hidden="true"
				className="project-preview-glass-lens"
				style={{ backdropFilter: `url(#${id})` }}
			/>
		</>
	);
}
