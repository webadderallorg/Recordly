import { ToggleButton } from "@heroui/react";
import {
	type AriaAttributes,
	cloneElement,
	isValidElement,
	type ReactElement,
	type ReactNode,
	useId,
} from "react";
import { AudioLevelMeter } from "@/components/ui/audio-level-meter";
import { Button } from "@/components/ui/button";
import { MicrophoneIcon, MicrophoneSlashIcon } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAudioLevelMeter } from "@/hooks/useAudioLevelMeter";
import { HudTooltip } from "../HudTooltip";
import styles from "../LaunchWindow.module.css";
import "../launchTheme.css";
import { useHudInteraction } from "../contexts/HudInteractionContext";
import type { DeviceOption } from "./launchPopoverTypes";

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
	const content = (
		<>
			<span className="shrink-0">
				{isValidElement(icon)
					? cloneElement(icon as ReactElement<{ weight?: string }>, {
							weight: selected ? "fill" : "regular",
						})
					: icon}
			</span>
			<span className="truncate">{children}</span>
			{trailing}
		</>
	);
	return selected === undefined ? (
		<Button variant="ghost" className="w-full justify-start gap-3" onClick={onClick}>
			{content}
		</Button>
	) : (
		<ToggleButton
			variant="ghost"
			isSelected={selected}
			className="w-full justify-start gap-3"
			onClick={onClick}
		>
			{content}
		</ToggleButton>
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
		<ToggleButton
			variant="ghost"
			isSelected={selected}
			className="w-full justify-start gap-3"
			onClick={onSelect}
		>
			<span className="shrink-0">
				{selected ? (
					<MicrophoneIcon weight="fill" size={16} />
				) : (
					<MicrophoneSlashIcon size={16} />
				)}
			</span>
			<span className="truncate flex-1">{device.label}</span>
			<AudioLevelMeter level={level} className="w-16 shrink-0" />
		</ToggleButton>
	);
}

export function HudPopover({
	open,
	onOpenChange,
	trigger,
	children,
	align = "center",
	label,
	tooltip,
	description,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	trigger: ReactElement;
	children: ReactNode;
	align?: "start" | "center" | "end";
	label?: string;
	tooltip?: string;
	description?: string;
}) {
	const { onMouseEnter } = useHudInteraction();
	const descriptionId = useId();
	const describedTrigger = description
		? cloneElement(trigger as ReactElement<AriaAttributes>, {
				"aria-describedby": descriptionId,
			})
		: trigger;
	return (
		<Popover open={open} onOpenChange={onOpenChange} modal={true}>
			<PopoverTrigger asChild>
				{tooltip ? (
					<HudTooltip label={tooltip} suppressed={open}>
						{describedTrigger}
					</HudTooltip>
				) : (
					describedTrigger
				)}
			</PopoverTrigger>
			{description && (
				<span id={descriptionId} className="sr-only">
					{description}
				</span>
			)}
			<PopoverContent
				aria-label={label}
				className={`launch-theme ${styles.menuCard} ${styles.electronNoDrag}`}
				style={{ display: "flex", flexDirection: "column" }}
				data-hud-interactive
				unstyled
				side="top"
				align={align}
				sideOffset={8}
				avoidCollisions
				collisionPadding={10}
				usePortal={false}
				onMouseEnter={onMouseEnter}
			>
				{children}
			</PopoverContent>
		</Popover>
	);
}
