import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CountdownDelayIcon } from "@/components/launch/CountdownDelayIcon";
import { HudInteractionContext } from "@/components/launch/contexts/HudInteractionContext";
import { HudTooltip } from "@/components/launch/HudTooltip";
import styles from "@/components/launch/LaunchWindow.module.css";
import { CountdownPopover } from "@/components/launch/popovers/CountdownPopover";
import { LaunchPopoverCoordinatorProvider } from "@/components/launch/popovers/LaunchPopoverCoordinator";
import { MicPopover } from "@/components/launch/popovers/MicPopover";
import { WebcamPopover } from "@/components/launch/popovers/WebcamPopover";
import { RecordButton } from "@/components/launch/RecordButton";
import { Button } from "@/components/ui/button";
import { House, MicrophoneIcon, VideoCameraSlashIcon, XIcon } from "@/components/ui/icons";
import { I18nProvider } from "@/contexts/I18nContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import "@/components/launch/launchTheme.css";
import "@/index.css";

window.electronAPI = {
	onCountdownTick: () => () => undefined,
	getActiveCountdown: async () => ({ success: false }),
} as unknown as typeof window.electronAPI;

// Mirrors the idle controls in LaunchWindow without the Electron-backed hooks.
function Preview() {
	const [action, setAction] = useState("");
	const [countdownDelay, setCountdownDelay] = useState(0);
	const [countdownActive, setCountdownActive] = useState(false);
	return (
		<main className="relative flex h-screen flex-col items-center justify-end bg-background pb-20">
			<button
				type="button"
				aria-label="Behind HUD"
				className="absolute inset-0"
				onClick={() => setAction("behind")}
			/>
			<output aria-label="Last action" className="relative">
				{action}
			</output>
			<div
				data-hud-surface
				className={`${styles.bar} ${styles.recordingBar} launch-theme relative`}
			>
				<div role="group" aria-label="Recording setup" className={styles.recordingControls}>
					<RecordButton
						countdownActive={countdownActive}
						countdownDelay={countdownDelay}
						disabled={false}
						onRecord={() => {
							setAction("record");
							setCountdownActive(countdownDelay > 0);
						}}
						onCancel={() => {
							setAction("cancel");
							setCountdownActive(false);
						}}
					/>
					<MicPopover
						systemAudioEnabled={false}
						onToggleSystemAudio={() => undefined}
						microphoneEnabled
						onDisableMicrophone={() => undefined}
						devices={[]}
						onSelectDevice={() => undefined}
						trigger={
							<Button
								variant="ghost"
								size="icon"
								iconSize="lg"
								aria-label="Audio settings"
							>
								<MicrophoneIcon weight="fill" className="size-5" />
							</Button>
						}
					/>
					<WebcamPopover
						cameraPermission="granted"
						webcamEnabled={false}
						onDisableWebcam={() => undefined}
						canToggleFloatingPreview={false}
						showFloatingWebcamPreview={false}
						onToggleFloatingPreview={() => undefined}
						showWebcamControls={false}
						roundness={50}
						setWebcamPreviewNode={() => undefined}
						videoDevices={[]}
						onSelectVideoDevice={() => undefined}
						trigger={
							<Button
								variant="ghost"
								size="icon"
								iconSize="lg"
								aria-label="Camera settings"
							>
								<VideoCameraSlashIcon className="size-5" />
							</Button>
						}
					/>
					<CountdownPopover
						countdownDelay={countdownDelay}
						onSelectDelay={setCountdownDelay}
						trigger={
							<Button
								variant="ghost"
								size="icon"
								iconSize="lg"
								aria-label="Countdown delay"
							>
								<CountdownDelayIcon seconds={countdownDelay} className="size-5" />
							</Button>
						}
					/>
					<HudTooltip label="Home">
						<Button variant="ghost" size="icon" iconSize="lg" aria-label="Home">
							<House weight="fill" className="size-5" />
						</Button>
					</HudTooltip>
					<HudTooltip label="Hide HUD">
						<Button
							variant="ghost"
							size="icon"
							iconSize="lg"
							aria-label="Hide HUD"
							onClick={() => setAction("hide")}
						>
							<XIcon className="size-5" />
						</Button>
					</HudTooltip>
				</div>
			</div>
		</main>
	);
}

createRoot(document.getElementById("root")!).render(
	<ThemeProvider>
		<I18nProvider>
			<LaunchPopoverCoordinatorProvider>
				<HudInteractionContext.Provider
					value={{ onMouseEnter: () => undefined, onMouseLeave: () => undefined }}
				>
					<Preview />
				</HudInteractionContext.Provider>
			</LaunchPopoverCoordinatorProvider>
		</I18nProvider>
	</ThemeProvider>,
);
