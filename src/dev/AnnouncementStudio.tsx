import {
	cloneElement,
	isValidElement,
	type ReactNode,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import {
	ArrowClockwise,
	ArrowSquareOut,
	Copy,
	DownloadSimple,
	Megaphone,
} from "@/components/ui/icons";
import {
	buildAnnouncement,
	buildDashboardBanner,
	defaults,
	restoreDraft,
	STORAGE_KEY,
	type StudioDraft,
	validateDraft,
} from "./announcementStudioModel";
import "@/index.css";
import "./announcement-studio.css";

const sizes = {
	desktop: [1440, 900],
	laptop: [1024, 768],
	compact: [768, 900],
	narrow: [390, 844],
} as const;
function Field({ label, children }: { label: string; children: ReactNode }) {
	const id = useId();
	return (
		<div className="studio-field">
			<label htmlFor={id}>{label}</label>
			{isValidElement<{ id?: string }>(children) ? cloneElement(children, { id }) : children}
		</div>
	);
}

function Studio() {
	const [draft, setDraft] = useState(() =>
		(() => {
			try {
				return restoreDraft(localStorage.getItem(STORAGE_KEY));
			} catch {
				return { ...defaults };
			}
		})(),
	);
	const [theme, setTheme] = useState<"dark" | "light">("dark");
	const [surface, setSurface] = useState<"dashboard" | "editor">("dashboard");
	const [width, setWidth] = useState(1440);
	const [height, setHeight] = useState(900);
	const [scale, setScale] = useState(1);
	const [previewMedia, setPreviewMedia] = useState<{ path: string; url: string } | null>(null);
	const [status, setStatus] = useState("");
	const [saveError, setSaveError] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [ready, setReady] = useState(false);
	const frame = useRef<HTMLIFrameElement>(null);
	const stage = useRef<HTMLDivElement>(null);
	const fullSize = useRef<Window | null>(null);
	const announcement = useMemo(() => buildAnnouncement(draft), [draft]);
	const errors = useMemo(() => validateDraft(draft), [draft]);
	const mediaUrl = previewMedia?.path === draft.mediaUrl ? previewMedia.url : draft.mediaUrl;
	const dashboard = draft.presentation === "dashboard-banner";
	const payload = useMemo(
		() => ({
			type: "recordly-studio:update",
			theme,
			surface: dashboard ? "dashboard" : draft.presentation === "banner" ? "editor" : surface,
			aspectRatio: draft.aspectRatio || undefined,
			announcement: dashboard
				? null
				: {
						...announcement,
						...(announcement.media
							? { media: { ...announcement.media, url: mediaUrl } }
							: {}),
					},
			dashboardBanner: dashboard ? buildDashboardBanner(draft, mediaUrl) : undefined,
		}),
		[draft, announcement, dashboard, theme, surface, mediaUrl],
	);
	const output = JSON.stringify(
		dashboard
			? buildDashboardBanner(draft)
			: {
					settings: draft.aspectRatio ? { aspectRatio: draft.aspectRatio } : {},
					announcements: [announcement],
				},
		null,
		2,
	);
	const update = <K extends keyof StudioDraft>(key: K, value: StudioDraft[K]) =>
		setDraft((d) => ({ ...d, [key]: value }));
	useEffect(() => {
		document.documentElement.classList.add("dark");
		document.documentElement.dataset.theme = "dark";
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
			setSaveError(false);
		} catch {
			setSaveError(true);
		}
	}, [draft]);
	useEffect(() => {
		const listener = (event: MessageEvent) => {
			if (
				event.origin === window.location.origin &&
				(event.source === frame.current?.contentWindow ||
					event.source === fullSize.current) &&
				event.data?.type === "recordly-studio:ready"
			) {
				setReady(true);
				(event.source as Window)?.postMessage(payload, window.location.origin);
			}
		};
		window.addEventListener("message", listener);
		return () => window.removeEventListener("message", listener);
	}, [payload]);
	useEffect(() => {
		if (ready) frame.current?.contentWindow?.postMessage(payload, window.location.origin);
		if (fullSize.current && !fullSize.current.closed)
			fullSize.current.postMessage(payload, window.location.origin);
	}, [ready, payload]);
	useEffect(() => {
		if (!stage.current) return;
		const observer = new ResizeObserver(([entry]) =>
			setScale(Math.min(1, Math.max(0.1, (entry.contentRect.width - 24) / width))),
		);
		observer.observe(stage.current);
		return () => observer.disconnect();
	}, [width]);
	const upload = async (file?: File) => {
		if (!file) return;
		setUploading(true);
		setStatus("");
		try {
			const response = await fetch("/__studio/media", {
				method: "POST",
				headers: { "Content-Type": file.type },
				body: file,
			});
			if (!response.ok) throw new Error(await response.text());
			const { url } = await response.json();
			const path = `/${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
			setPreviewMedia({ path, url });
			setDraft((d) => ({
				...d,
				mediaUrl: path,
				mediaType: file.type.startsWith("video/") ? "video" : "image",
				mediaAlt: d.mediaAlt || file.name,
			}));
			setStatus(
				"Media loaded for this session. Copy the original file into public/ before integrating the JSON.",
			);
		} catch (e) {
			setStatus(`Upload failed: ${String(e)}`);
		} finally {
			setUploading(false);
		}
	};
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(output);
			setStatus("JSON copied.");
		} catch {
			setStatus("Clipboard unavailable. Download JSON instead.");
		}
	};
	const download = () => {
		const url = URL.createObjectURL(new Blob([output], { type: "application/json" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = `${draft.id || "announcement"}.json`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};
	return (
		<main className="studio-app">
			<header className="studio-header">
				<div className="studio-brand">
					<Megaphone className="size-6" />
					<div>
						<h1>Announcement Studio</h1>
						<p>Compose in Recordly’s current UI</p>
					</div>
				</div>
				<div className="studio-actions">
					<span className="studio-save">
						{saveError ? "Draft could not be saved" : "Draft saved locally"}
					</span>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => {
							setDraft({ ...defaults });
							setPreviewMedia(null);
							setStatus("Draft reset.");
						}}
					>
						Reset draft
					</Button>
				</div>
			</header>
			<div className="studio-layout">
				<aside className="studio-controls">
					<section className="studio-card">
						<h2>Announcement</h2>
						<Field label="Placement">
							<select
								value={draft.presentation}
								onChange={(e) =>
									update(
										"presentation",
										e.target.value as StudioDraft["presentation"],
									)
								}
							>
								<option value="popup">Popup</option>
								<option value="notification">Notification</option>
								<option value="banner">Editor header banner</option>
								<option value="dashboard-banner">Dashboard image banner</option>
							</select>
						</Field>
						<Field label="ID">
							<input
								value={draft.id}
								maxLength={100}
								onChange={(e) => update("id", e.target.value)}
							/>
						</Field>
						<Field label="Title">
							<input
								value={draft.title}
								maxLength={160}
								onChange={(e) => update("title", e.target.value)}
							/>
						</Field>
						<Field label="Message">
							<textarea
								rows={4}
								value={draft.body}
								maxLength={2000}
								onChange={(e) => update("body", e.target.value)}
							/>
						</Field>
						{dashboard && (
							<p className="studio-help">
								Dashboard banners show your image at 6:1. Title is used as fallback
								alt text; message is not displayed.
							</p>
						)}
					</section>
					{(draft.presentation === "popup" || dashboard) && (
						<section className="studio-card">
							<h2>Media</h2>
							{!dashboard && (
								<Field label="Media type">
									<select
										value={draft.mediaType}
										onChange={(e) =>
											update(
												"mediaType",
												e.target.value as StudioDraft["mediaType"],
											)
										}
									>
										<option value="none">No media</option>
										<option value="image">Image</option>
										<option value="video">Video</option>
									</select>
								</Field>
							)}
							<Field
								label={
									uploading
										? "Loading media…"
										: "Choose local media (up to 50 MB)"
								}
							>
								<input
									type="file"
									accept={
										dashboard
											? "image/png,image/jpeg,image/webp,image/gif,image/avif"
											: "image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime"
									}
									disabled={uploading}
									onChange={(e) => void upload(e.target.files?.[0])}
								/>
							</Field>
							<Field label="Media path or HTTPS URL">
								<input
									value={draft.mediaUrl}
									placeholder="/announcements/update.webp"
									onChange={(e) => {
										setPreviewMedia(null);
										update("mediaUrl", e.target.value);
									}}
								/>
							</Field>
							<Field label="Image description">
								<input
									value={draft.mediaAlt}
									onChange={(e) => update("mediaAlt", e.target.value)}
								/>
							</Field>
							{!dashboard && (
								<>
									<Field label="Media layout">
										<select
											value={draft.mediaMode}
											onChange={(e) =>
												update(
													"mediaMode",
													e.target.value as StudioDraft["mediaMode"],
												)
											}
										>
											<option value="banner">Above content</option>
											<option value="cover">Full cover</option>
										</select>
									</Field>
									{draft.mediaType === "video" && (
										<Field label="Poster image URL">
											<input
												value={draft.posterUrl}
												onChange={(e) =>
													update("posterUrl", e.target.value)
												}
											/>
										</Field>
									)}
									<Field label="Popup aspect ratio">
										<select
											value={draft.aspectRatio}
											onChange={(e) => update("aspectRatio", e.target.value)}
										>
											<option value="">App default (4:3)</option>
											{["16:9", "4:3", "1:1", "3:4", "9:16"].map((r) => (
												<option key={r}>{r}</option>
											))}
										</select>
									</Field>
								</>
							)}
							<p className="studio-help">
								Uploads stay in memory for this session. Export uses the public path
								above; add the original media to Recordly’s public folder.
							</p>
						</section>
					)}
					<section className="studio-card">
						<h2>Action & controls</h2>
						<label className="studio-check">
							<input
								type="checkbox"
								checked={draft.actionEnabled}
								onChange={(e) => update("actionEnabled", e.target.checked)}
							/>
							Show action
						</label>
						{draft.actionEnabled && (
							<>
								<Field label="Action label">
									<input
										value={draft.actionLabel}
										maxLength={80}
										onChange={(e) => update("actionLabel", e.target.value)}
									/>
								</Field>
								<Field label="Action type">
									<select
										value={draft.actionType}
										onChange={(e) =>
											update(
												"actionType",
												e.target.value as StudioDraft["actionType"],
											)
										}
									>
										<option value="section">Editor section</option>
										<option value="url">External HTTPS link</option>
									</select>
								</Field>
								<Field label="Destination">
									{draft.actionType === "section" ? (
										<select
											value={draft.actionDestination}
											onChange={(e) =>
												update("actionDestination", e.target.value)
											}
										>
											{[
												"scene",
												"cursor",
												"webcam",
												"captions",
												"settings",
												"extensions",
											].map((s) => (
												<option key={s}>{s}</option>
											))}
										</select>
									) : (
										<input
											value={draft.actionDestination}
											placeholder="https://recordly.dev"
											onChange={(e) =>
												update("actionDestination", e.target.value)
											}
										/>
									)}
								</Field>
							</>
						)}
						{!dashboard && (
							<>
								{draft.presentation !== "notification" && (
									<label className="studio-check">
										<input
											type="checkbox"
											checked={draft.showClose}
											onChange={(e) => update("showClose", e.target.checked)}
										/>
										Show close button
									</label>
								)}
								{draft.presentation === "popup" && (
									<label className="studio-check">
										<input
											type="checkbox"
											checked={draft.showDismiss}
											onChange={(e) =>
												update("showDismiss", e.target.checked)
											}
										/>
										Show dismiss button
									</label>
								)}
							</>
						)}
						<p className="studio-help">
							Preview actions are intercepted. Replay restores dismissed
							announcements.
						</p>
					</section>
					{!dashboard && (
						<section className="studio-card">
							<h2>Delivery</h2>
							<Field label="Audience">
								<select
									value={draft.audience}
									onChange={(e) =>
										update(
											"audience",
											e.target.value as StudioDraft["audience"],
										)
									}
								>
									<option value="editor">Editor</option>
									<option value="all">All</option>
								</select>
							</Field>
							<Field label="Priority">
								<input
									type="number"
									min={-100}
									max={100}
									value={draft.priority}
									onChange={(e) => update("priority", Number(e.target.value))}
								/>
							</Field>
							<Field label="Starts at (local time)">
								<input
									type="datetime-local"
									value={draft.startsAt}
									onChange={(e) => update("startsAt", e.target.value)}
								/>
							</Field>
							<Field label="Ends at (local time)">
								<input
									type="datetime-local"
									value={draft.endsAt}
									onChange={(e) => update("endsAt", e.target.value)}
								/>
							</Field>
							<Field label="Maximum impressions (0 = unlimited)">
								<input
									type="number"
									min={0}
									max={100}
									value={draft.maxImpressions}
									onChange={(e) =>
										update("maxImpressions", Number(e.target.value))
									}
								/>
							</Field>
							<label className="studio-check">
								<input
									type="checkbox"
									checked={draft.autoHide}
									onChange={(e) => update("autoHide", e.target.checked)}
								/>
								Auto-hide
							</label>
							{draft.autoHide && (
								<Field label="Display duration (seconds)">
									<input
										type="number"
										min={3}
										max={300}
										value={draft.displayDurationSeconds}
										onChange={(e) =>
											update("displayDurationSeconds", Number(e.target.value))
										}
									/>
								</Field>
							)}
							<p className="studio-help">
								Preview bypasses dates, audience and impression limits so you can
								always see the draft. Runtime supports dates and impression limits;
								repeat, snooze and time windows from the old studio are not
								supported.
							</p>
						</section>
					)}
				</aside>
				<section className="studio-workspace">
					<section className="studio-preview-card">
						<div className="studio-preview-heading">
							<div>
								<h2>Live app preview</h2>
								<p>Real components · real responsive breakpoints</p>
							</div>
							<Button
								variant="secondary"
								size="sm"
								onClick={() =>
									frame.current?.contentWindow?.postMessage(
										payload,
										window.location.origin,
									)
								}
							>
								<ArrowClockwise /> Replay
							</Button>
						</div>
						<div className="studio-toolbar">
							<Field label="View">
								<select
									disabled={dashboard || draft.presentation === "banner"}
									value={
										dashboard
											? "dashboard"
											: draft.presentation === "banner"
												? "editor"
												: surface
									}
									onChange={(e) => setSurface(e.target.value as typeof surface)}
								>
									<option value="dashboard">Dashboard</option>
									<option value="editor">Editor</option>
								</select>
							</Field>
							<Field label="Theme">
								<select
									value={theme}
									onChange={(e) => setTheme(e.target.value as typeof theme)}
								>
									<option value="dark">Dark</option>
									<option value="light">Light</option>
								</select>
							</Field>
							<Field label="Viewport">
								<select
									aria-label="Viewport preset"
									defaultValue="desktop"
									onChange={(e) => {
										const s = sizes[e.target.value as keyof typeof sizes];
										setWidth(s[0]);
										setHeight(s[1]);
									}}
								>
									{Object.entries(sizes).map(([name, [w, h]]) => (
										<option key={name} value={name}>
											{name} · {w} × {h}
										</option>
									))}
								</select>
							</Field>
							<Field label="Width">
								<input
									aria-label="Viewport width"
									type="number"
									min={320}
									max={2560}
									value={width}
									onChange={(e) =>
										setWidth(
											Math.max(
												320,
												Math.min(2560, Number(e.target.value) || 320),
											),
										)
									}
								/>
							</Field>
							<Field label="Height">
								<input
									aria-label="Viewport height"
									type="number"
									min={400}
									max={1440}
									value={height}
									onChange={(e) =>
										setHeight(
											Math.max(
												400,
												Math.min(1440, Number(e.target.value) || 400),
											),
										)
									}
								/>
							</Field>
						</div>
						<div className="studio-stage" ref={stage}>
							<div
								className="studio-frame-space"
								style={{ width: width * scale, height: height * scale }}
							>
								<iframe
									ref={frame}
									src="/announcement-preview.html"
									title="Recordly announcement preview"
									style={{
										width,
										height,
										transform: `scale(${scale})`,
										transformOrigin: "top left",
									}}
								/>
							</div>
						</div>
						<div className="studio-preview-footer">
							<span>
								{width} × {height} CSS pixels · {Math.round(scale * 100)}% zoom
								{!ready && " · Loading preview…"}
							</span>
							<button
								type="button"
								className="studio-full-size"
								onClick={() => {
									fullSize.current = window.open(
										`/announcement-preview.html#draft=${encodeURIComponent(JSON.stringify(payload))}`,
										"recordly-studio-full-size",
									);
									if (fullSize.current)
										fullSize.current.postMessage(
											payload,
											window.location.origin,
										);
								}}
							>
								Open full size <ArrowSquareOut className="size-3" />
							</button>
						</div>
					</section>
					<section className="studio-card studio-output">
						<div className="studio-preview-heading">
							<div>
								<h2>
									{dashboard
										? "Dashboard banner config"
										: "Announcement feed JSON"}
								</h2>
								<p>
									{dashboard
										? "Use in dashboard/announcementConfig.ts."
										: "Matches the current Recordly feed schema."}
								</p>
							</div>
							<div className="studio-actions">
								<Button
									variant="secondary"
									size="sm"
									disabled={errors.length > 0}
									onClick={download}
								>
									<DownloadSimple /> Download
								</Button>
								<Button
									size="sm"
									disabled={errors.length > 0}
									onClick={() => void copy()}
								>
									<Copy /> Copy JSON
								</Button>
							</div>
						</div>
						{errors.length > 0 && (
							<ul className="studio-errors" role="alert">
								{errors.map((e) => (
									<li key={e}>{e}</li>
								))}
							</ul>
						)}
						<p className="studio-status" role="status">
							{status}
						</p>
						<pre>
							<code>{output}</code>
						</pre>
					</section>
				</section>
			</div>
		</main>
	);
}
createRoot(document.getElementById("root")!).render(<Studio />);
