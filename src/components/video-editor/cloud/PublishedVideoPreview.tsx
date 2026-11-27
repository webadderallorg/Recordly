import { useRef, useState } from "react";
import { ErrorReportButton } from "@/components/feedback/ErrorReportButton";
import { Button } from "@/components/ui/button";
import { Play } from "@/components/ui/icons";
import { useI18n } from "@/contexts/I18nContext";
export function PublishedVideoPreview({ url }: { url: string }) {
	const { t } = useI18n();
	const video = useRef<HTMLVideoElement>(null);
	const [started, setStarted] = useState(false);
	const [posterFailed, setPosterFailed] = useState(false);
	const [error, setError] = useState<string>();
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
	const code = parsed.pathname.match(/^\/s\/([a-z0-9]+)\/?$/i)?.[1];
	if (!code) return null;
	return (
		<div className="relative aspect-video overflow-hidden rounded-2xl bg-black">
			<video
				ref={video}
				src={`${parsed.origin}/v/${code}`}
				poster={posterFailed ? undefined : `${parsed.origin}/thumb/${code}`}
				aria-label={t("editor.cloud.videoPreview", "Published video preview")}
				className="h-full w-full object-contain"
				preload="metadata"
				playsInline
				controls={started}
				onPlay={() => setStarted(true)}
				onError={({ currentTarget }) => {
					const code = currentTarget.error?.code;
					setError(
						code
							? `Published video preview failed (media error ${code}).`
							: "Published video preview failed.",
					);
				}}
			/>
			{!posterFailed && (
				<img
					src={`${parsed.origin}/thumb/${code}`}
					alt=""
					className="hidden"
					onError={() => setPosterFailed(true)}
				/>
			)}
			{error ? (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-4 text-center text-xs text-white">
					<p role="status">
						{t(
							"editor.cloud.previewUnavailable",
							"Preview unavailable. Your share link is below.",
						)}
					</p>
					<ErrorReportButton error={error} context="cloud-share-preview" />
				</div>
			) : (
				!started && (
					<Button
						type="button"
						size="icon"
						aria-label={t("editor.cloud.playPreview", "Play video preview")}
						className="absolute left-1/2 top-1/2 size-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8fa8b9]/90 text-white shadow-none hover:bg-[#7c97aa]"
						onClick={() => {
							void video.current?.play().catch(() => {
								setError(
									(current) =>
										current ?? "Published video preview could not start.",
								);
							});
						}}
					>
						<Play weight="fill" className="size-6" />
					</Button>
				)
			)}
		</div>
	);
}
