/** Keep the selected seconds readable inside the stopwatch face. */
export function CountdownDelayIcon({
	seconds,
	className,
}: {
	seconds: number;
	className?: string;
}) {
	return (
		<svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
			<circle cx="12" cy="14" r="8.5" stroke="currentColor" strokeWidth="1.5" />
			<path
				d="M10 2h4M12 2v3.5M18.5 7.5 20 6"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
			<text
				x="12"
				y="14"
				fill="currentColor"
				fontSize="9"
				fontWeight="600"
				textAnchor="middle"
				dominantBaseline="central"
			>
				{seconds}
			</text>
		</svg>
	);
}
