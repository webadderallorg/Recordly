import { Microphone as Mic, MicrophoneSlash as MicOff } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAudioLevelMeter } from "@/hooks/useAudioLevelMeter";
import { AudioLevelMeter } from "@/components/ui/audio-level-meter";
import styles from "../LaunchWindow.module.css";
import "../launchTheme.css";
import type { DeviceOption } from "./types";

export function DropdownItem({
	onClick,
	selected,
	icon,
	children,
	trailing,
}: {
	onClick: () => void;
	selected?: boolean;
	icon: ReactNode;
	children: ReactNode;
	trailing?: ReactNode;
}) {
	return (
		<button
			type="button"
			className={`${styles.ddItem} ${selected ? styles.ddItemSelected : ""}`}
			onClick={onClick}
		>
			<span className="shrink-0">{icon}</span>
			<span className="truncate">{children}</span>
			{trailing}
		</button>
	);
}

export function MicDeviceRow({
	device,
	selected,
	onSelect,
}: {
	device: DeviceOption;
	selected: boolean;
	onSelect: () => void;
}) {
	const { level } = useAudioLevelMeter({
		enabled: true,
		deviceId: device.deviceId,
	});

	return (
		<button
			type="button"
			className={`${styles.ddItem} ${selected ? styles.ddItemSelected : ""}`}
			onClick={onSelect}
		>
			<span className="shrink-0">{selected ? <Mic size={16} /> : <MicOff size={16} />}</span>
			<span className="truncate flex-1">{device.label}</span>
			<AudioLevelMeter level={level} className="w-16 shrink-0" />
		</button>
	);
}

export function HudPopover({
	open,
	onOpenChange,
	trigger,
	children,
	align = "center",
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	trigger: ReactNode;
	children: ReactNode;
	align?: "start" | "center" | "end";
}) {
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent
				className={`launch-theme ${styles.menuCard} ${styles.electronNoDrag}`}
				unstyled
				side="bottom"
				align={align}
				sideOffset={8}
				avoidCollisions
				collisionPadding={10}
				usePortal={false}
			>
				{children}
			</PopoverContent>
		</Popover>
	);
}
