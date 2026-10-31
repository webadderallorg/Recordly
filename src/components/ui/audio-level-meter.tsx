import { Meter } from "@heroui/react";
export function AudioLevelMeter({ level, className }: { level: number; className?: string }) {
	return (
		<Meter
			aria-label="Microphone level"
			value={Math.min(100, Math.max(0, level))}
			minValue={0}
			maxValue={100}
			size="sm"
			color={level > 85 ? "danger" : level > 65 ? "warning" : "accent"}
			className={className}
		>
			<Meter.Track>
				<Meter.Fill />
			</Meter.Track>
		</Meter>
	);
}
