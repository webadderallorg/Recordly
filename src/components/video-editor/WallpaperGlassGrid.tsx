import { type CSSProperties, type HTMLAttributes, useId } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { WallpaperGlassFilter } from "./WallpaperGlassFilter";
import "./WallpaperGrid.css";

/** One shared lens for image, video, color, gradient, and upload tiles. */
export function WallpaperGlassGrid({
	children,
	...props
}: Pick<HTMLAttributes<HTMLDivElement>, "children" | "aria-label">) {
	const { theme } = useTheme();
	const filterId = `wallpaper-glass-${useId().replace(/:/g, "")}`;
	return (
		<div
			{...props}
			className="relative grid grid-cols-5 gap-2"
			data-wallpaper-glass-theme={theme}
			style={{ "--wallpaper-glass-filter": `url(#${filterId})` } as CSSProperties}
		>
			<WallpaperGlassFilter id={filterId} />
			{children}
		</div>
	);
}
