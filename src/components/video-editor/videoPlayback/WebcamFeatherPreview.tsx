import { type ReactNode, useId, useLayoutEffect, useRef } from "react";
import { DEFAULT_WEBCAM_ROUNDNESS, type WebcamShape } from "../types";
import { getWebcamCornerRadiusPx } from "../webcamOverlay";
import { getWebcamShapeSvgPath } from "../webcamShapePath";

/** Geometry-based transparency gradient plus a little blur at the camera edge. */
export function WebcamFeatherPreview({
	children,
	enabled = true,
	shape = "squircle",
	roundness = DEFAULT_WEBCAM_ROUNDNESS,
}: {
	children: ReactNode;
	enabled?: boolean;
	shape?: WebcamShape;
	roundness?: number;
}) {
	const id = `webcam-feather-${useId().replace(/:/g, "")}`;
	const layerRef = useRef<HTMLDivElement>(null);
	const pathRef = useRef<SVGPathElement>(null);
	useLayoutEffect(() => {
		const layer = layerRef.current;
		if (!layer) return;
		const update = () => {
			const camera = layer.querySelector<HTMLElement>("[data-webcam-overlay]");
			if (!camera || !pathRef.current) return;
			const width = Number.parseFloat(camera.style.width);
			const height = Number.parseFloat(camera.style.height);
			const x = Number.parseFloat(camera.style.left);
			const y = Number.parseFloat(camera.style.top);
			if (![width, height, x, y].every(Number.isFinite) || width <= 0 || height <= 0) return;
			const inset = Math.min(8, width / 8, height / 8);
			const radius = getWebcamCornerRadiusPx(roundness, width, height, shape);
			const path = getWebcamShapeSvgPath({
				x: x + inset,
				y: y + inset,
				width: width - inset * 2,
				height: height - inset * 2,
				radius: Math.max(0, radius - inset),
				shape,
			});
			if (pathRef.current.getAttribute("d") !== path) pathRef.current.setAttribute("d", path);
		};
		update();
		const observer = new MutationObserver(update);
		observer.observe(layer, {
			attributes: true,
			attributeFilter: ["style"],
			childList: true,
			subtree: true,
		});
		return () => observer.disconnect();
	}, [shape, roundness]);
	return (
		<>
			<svg
				width="100%"
				height="100%"
				aria-hidden="true"
				className="pointer-events-none absolute inset-0"
			>
				<defs>
					<path id={`${id}-contour`} ref={pathRef} />
					<filter id={`${id}-gradient`} colorInterpolationFilters="sRGB">
						<feGaussianBlur stdDeviation="3" />
					</filter>
					<mask
						id={`${id}-fade`}
						maskUnits="userSpaceOnUse"
						x="0"
						y="0"
						width="100%"
						height="100%"
						style={{ maskType: "alpha" }}
					>
						<use href={`#${id}-contour`} fill="white" filter={`url(#${id}-gradient)`} />
					</mask>
					<mask
						id={`${id}-edge`}
						maskUnits="userSpaceOnUse"
						x="0"
						y="0"
						width="100%"
						height="100%"
						style={{ maskType: "alpha" }}
					>
						<use
							href={`#${id}-contour`}
							fill="none"
							stroke="white"
							strokeWidth="8"
							filter={`url(#${id}-gradient)`}
						/>
					</mask>
				</defs>
			</svg>
			<div
				ref={layerRef}
				data-webcam-feather-preview
				className="pointer-events-none absolute inset-0"
				style={{ mask: enabled ? `url(#${id}-fade)` : undefined }}
			>
				{children}
				{enabled && (
					<span
						aria-hidden="true"
						className="pointer-events-none absolute inset-0"
						style={{ mask: `url(#${id}-edge)`, backdropFilter: "blur(3px)" }}
					/>
				)}
			</div>
		</>
	);
}
