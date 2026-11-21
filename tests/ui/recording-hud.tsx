import { useState } from "react";
import { createRoot } from "react-dom/client";
import { HudInteractionContext } from "@/components/launch/contexts/HudInteractionContext";
import styles from "@/components/launch/LaunchWindow.module.css";
import { LaunchPopoverCoordinatorProvider } from "@/components/launch/popovers/LaunchPopoverCoordinator";
import { RecordingControls } from "@/components/launch/RecordingControls";
import { I18nProvider } from "@/contexts/I18nContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import "@/components/launch/launchTheme.css";
import "@/index.css";

function Preview() {
	const [paused, setPaused] = useState(false);
	const [action, setAction] = useState("");
	return (
		<main className="flex h-screen flex-col items-center justify-end gap-8 bg-background pb-20">
			<output aria-label="Last action">{action}</output>
			<div
				data-recording-state="recording"
				className={`${styles.bar} ${styles.recordingBar} launch-theme`}
			>
				<RecordingControls
					paused={paused}
					elapsed={65}
					formatTime={() => "01:05"}
					onPauseResume={() => setPaused((value) => !value)}
					onStopRecording={() => setAction("stop")}
					onCancelRecording={() => setAction("discard")}
				/>
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
