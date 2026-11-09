import type { CSSProperties } from "react";
import "./ExportPaperStack.css";

export function ExportPaperStack() {
	return (
		<div className="export-paper-stack" aria-hidden="true">
			{[0, 1, 2, 3].map((index) => (
				<span
					key={index}
					className="export-paper"
					style={
						{
							"--paper-delay": `${index * -0.9}s`,
							"--paper-y": `${index * -4}px`,
							"--paper-angle": `${(index - 1.5) * 3}deg`,
							zIndex: index,
						} as CSSProperties
					}
				>
					<span className="export-paper-lines" />
				</span>
			))}
		</div>
	);
}
