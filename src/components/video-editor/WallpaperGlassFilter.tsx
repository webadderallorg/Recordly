import displacementMap from "@/assets/liquid-glass/displacement.png";

/** Single-pass refraction adapted from rdev/liquid-glass-react (MIT).
 * Shared by the gallery; the baked map bends only the rounded edges.
 * No animation loop, per-tile canvas, blur, or duplicate video decoding.
 */
export function WallpaperGlassFilter({ id }: { id: string }) {
	const exposure = 0.9;
	const lift = 0;
	return (
		<svg width="0" height="0" aria-hidden="true" focusable="false" className="absolute">
			<defs>
				<filter
					id={id}
					x="0"
					y="0"
					width="100%"
					height="100%"
					colorInterpolationFilters="sRGB"
				>
					<feImage
						href={displacementMap}
						x="0"
						y="0"
						width="100%"
						height="100%"
						preserveAspectRatio="none"
						result="displacement"
					/>
					<feDisplacementMap
						in="SourceGraphic"
						in2="displacement"
						scale="1.5"
						xChannelSelector="R"
						yChannelSelector="B"
						result="refracted"
					/>
					<feColorMatrix
						in="refracted"
						type="saturate"
						values="1.4"
						result="vibrant-edge"
					/>
					{/* Saturation and exposure affect only the rim, preserving the center. */}
					<feComponentTransfer in="vibrant-edge" result="lit-edge">
						<feFuncR type="linear" slope={exposure} intercept={lift} />
						<feFuncG type="linear" slope={exposure} intercept={lift} />
						<feFuncB type="linear" slope={exposure} intercept={lift} />
					</feComponentTransfer>
					<feColorMatrix
						in="displacement"
						type="matrix"
						values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 1 0 0 0"
						result="rim"
					/>
					<feComposite in="lit-edge" in2="rim" operator="in" result="edge" />
					<feComposite in="SourceGraphic" in2="rim" operator="out" result="center" />
					<feComposite in="edge" in2="center" operator="arithmetic" k2="1" k3="1" />
				</filter>
			</defs>
		</svg>
	);
}
