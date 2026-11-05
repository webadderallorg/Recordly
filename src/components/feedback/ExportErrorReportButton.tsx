import { ErrorReportButton } from "./ErrorReportButton";

export function ExportErrorReportButton({
	error,
	format,
}: {
	error: string;
	format: "mp4" | "gif";
}) {
	return <ErrorReportButton error={error} context="export" format={format} />;
}
