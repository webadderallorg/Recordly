import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { VideoCameraSlashIcon } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import styles from "./LaunchWindow.module.css";
import "./launchTheme.css";

export function WebcamUnavailable({
	error,
	floating = false,
}: {
	error: string;
	floating?: boolean;
}) {
	const t = useScopedT("notifications");
	return (
		<div
			className={`launch-theme ${styles.webcamUnavailable}`}
			data-floating={floating || undefined}
		>
			<VideoCameraSlashIcon size={24} aria-hidden="true" />
			<p role="status">{t("webcamUnavailable", "Webcam unavailable")}</p>
			<ErrorReportButton error={error} context="webcam" compact />
		</div>
	);
}
