import {
	Microphone as Mic,
	MicrophoneSlash as MicOff,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useAudioLevelMeter } from "@/hooks/useAudioLevelMeter";
import { AudioLevelMeter } from "@/components/ui/audio-level-meter";
import styles from "./LaunchWindow.module.css";

export function IconButton({
	onClick,
	title,
	className = "",
	buttonRef,
	children,
}: {
	onClick?: () => void;
	title?: string;
	className?: string;
	buttonRef?: React.Ref<HTMLButtonElement | null>;
	children: ReactNode;
}) {
	return (
		<button
			ref={buttonRef as React.Ref<HTMLButtonElement>}
			type="button"
			className={`${styles.ib} ${styles.electronNoDrag} ${className}`}
			onClick={onClick}
			title={title}
		>
			{children}
		</button>
	);
}

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

export function Separator({ dropdown = false }: { dropdown?: boolean }) {
	return <div className={dropdown ? styles.ddSep : styles.sep} />;
}

export function MicDeviceRow({
	device,
	selected,
	onSelect,
}: {
	device: { deviceId: string; label: string };
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
