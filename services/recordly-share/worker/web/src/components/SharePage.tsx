import ThemeToggle from "./ThemeToggle";
import { Avatar, Button, Input, Label, Skeleton, TextField, toast } from "@heroui/react";
import { ChatCircleIcon, LockKeyIcon, ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	fetchShareData,
	fetchReactions,
	postReaction,
	verifyPassword,
	isShareData,
	isPasswordRequired,
	isExpired,
	formatDate,
	formatTimestamp,
	type ShareData,
	type Comment,
	type Reaction,
} from "../scripts/api";
import SharePlayer from "./SharePlayer";
import ShareFeedback from "./ShareFeedback";
import { CenteredCard, Notice, CopyButton, Notifications } from "./ShareUI";

const reactions = [
	{ emoji: "👍", label: "Like" },
	{ emoji: "❤️", label: "Love" },
	{ emoji: "😂", label: "Laugh" },
	{ emoji: "😮", label: "Surprised" },
	{ emoji: "🔥", label: "Fire" },
	{ emoji: "👏", label: "Applause" },
];

function Recording({ data }: { data: ShareData }) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const composerRef = useRef<HTMLTextAreaElement>(null);
	const [time, setTime] = useState(0);
	const [duration, setDuration] = useState(data.video.duration);
	const [comments, setComments] = useState<Comment[]>([]);
	const [reactionEvents, setReactionEvents] = useState<Reaction[]>([]);
	const counts = reactionEvents.reduce<Record<string, number>>((result, item) => {
		result[item.emoji] = (result[item.emoji] || 0) + 1;
		return result;
	}, {});
	const [reacting, setReacting] = useState<string | null>(null);
	const [selectedTab, setSelectedTab] = useState("comments");
	const [mobileView, setMobileView] = useState("watch");
	const seek = useCallback((value: number) => {
		const video = videoRef.current;
		if (video && Number.isFinite(video.duration)) {
			video.currentTime = Math.max(0, Math.min(video.duration, value));
			setTime(video.currentTime);
		}
	}, []);

	useEffect(() => {
		let cancelled = false;
		fetchReactions(data.shareCode)
			.then((items) => {
				if (!cancelled) setReactionEvents((current) => [...items, ...current]);
			})
			.catch(() => {
				/* Feedback remains available if counts fail to load. */
			});
		return () => {
			cancelled = true;
		};
	}, [data.shareCode]);

	async function react(emoji: string) {
		if (reacting) return;
		setReacting(emoji);
		const timestamp = videoRef.current?.currentTime || 0;
		try {
			if (!(await postReaction(data.shareCode, timestamp, emoji))) throw new Error();
			setReactionEvents((current) => [
				...current,
				{ timestamp, emoji, created_at: new Date().toISOString() },
			]);
			toast.success(`${emoji} Reaction at ${formatTimestamp(timestamp)}`);
		} catch {
			toast.danger("Could not add your reaction. Try again.");
		} finally {
			setReacting(null);
		}
	}

	const { video } = data;
	return (
		<div className="recording-app" data-mobile-view={mobileView}>
			{mobileView === "feedback" && (
				<div className="mobile-feedback-back">
					<Button size="sm" variant="secondary" onPress={() => setMobileView("watch")}>
						Back to video
					</Button>
				</div>
			)}
			<div className="share-workspace">
				<main className="recording-column">
					<div className="recording-heading viewer-heading">
						<div className="viewer-identity">
							<Avatar
								aria-label={data.creator?.name || "Recording creator"}
								className="!size-[48px] shrink-0 !rounded-full bg-accent/15 text-accent"
							>
								<Avatar.Fallback className="!rounded-full bg-accent/15 text-xs font-medium text-accent">
									{data.creator?.name
										.split(/\s+/)
										.filter(Boolean)
										.slice(0, 2)
										.map((part) => part[0])
										.join("")
										.toUpperCase() || "?"}
								</Avatar.Fallback>
							</Avatar>
							<div className="viewer-caption">
								<h1 className="recording-title" title={video.title}>
									{video.title}
								</h1>
								<div className="recording-meta">
									<span>{formatDate(video.created_at)}</span>
									<span>
										{video.view_count.toLocaleString()}{" "}
										{video.view_count === 1 ? "view" : "views"}
									</span>
								</div>
							</div>
						</div>
						<div className="viewer-heading-actions">
							<ThemeToggle />
							<CopyButton time={time} />
						</div>
					</div>
					<SharePlayer
						data={data}
						videoRef={videoRef}
						comments={comments}
						reactions={reactionEvents}
						time={time}
						duration={duration}
						onTime={setTime}
						onDuration={setDuration}
						seek={seek}
					/>
					<div className="reaction-rail">
						<div className="reaction-buttons" aria-label="Reactions">
							{reactions.map(({ emoji, label }) => (
								<Button
									key={emoji}
									size="sm"
									variant="ghost"
									aria-label={`${label}${counts[emoji] ? `, ${counts[emoji]} ${counts[emoji] === 1 ? "reaction" : "reactions"}` : ""}`}
									isDisabled={reacting !== null}
									onPress={() => void react(emoji)}
								>
									<span aria-hidden="true">{emoji}</span>
									{counts[emoji] > 0 && <span>{counts[emoji]}</span>}
								</Button>
							))}
						</div>
						<Button
							className="mobile-comment-button"
							size="sm"
							variant="primary"
							onPress={() => {
								setSelectedTab("comments");
								setMobileView("feedback");
								requestAnimationFrame(() =>
									composerRef.current?.focus({ preventScroll: true }),
								);
							}}
						>
							<ChatCircleIcon size={17} />
							Comment
						</Button>
					</div>
				</main>
				<aside aria-label="Recording feedback">
					<ShareFeedback
						data={data}
						time={time}
						duration={duration}
						comments={comments}
						setComments={setComments}
						seek={seek}
						composerRef={composerRef}
						selectedTab={selectedTab}
						setSelectedTab={setSelectedTab}
					/>
				</aside>
			</div>
		</div>
	);
}

export default function SharePage() {
	const [data, setData] = useState<ShareData | null>(null);
	const [view, setView] = useState<"loading" | "password" | "expired" | "error" | "recording">(
		"loading",
	);
	const [title, setTitle] = useState("Protected recording");
	const [password, setPassword] = useState("");
	const [unlocking, setUnlocking] = useState(false);
	const [error, setError] = useState("");

	const load = useCallback(async () => {
		setView("loading");
		try {
			const code = location.pathname.split("/").filter(Boolean).pop() || "";
			const result = await fetchShareData(code);
			if (isExpired(result)) {
				setView("expired");
				document.title = "Recording unavailable — Recordly";
			} else if (isPasswordRequired(result)) {
				setView("password");
				setTitle(result.title);
				document.title = `${result.title} — Recordly`;
			} else if (isShareData(result)) {
				setData(result);
				setView("recording");
				document.title = `${result.video.title} — Recordly`;
			} else setView("error");
		} catch {
			setView("error");
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load]);

	async function unlock() {
		if (unlocking) return;
		setUnlocking(true);
		setError("");
		try {
			const code = location.pathname.split("/").filter(Boolean).pop() || "";
			if (await verifyPassword(code, password)) await load();
			else setError("That password didn’t match. Please try again.");
		} catch {
			setError("Could not unlock the recording. Please try again.");
		} finally {
			setUnlocking(false);
		}
	}

	return (
		<>
			<Notifications />
			{view === "loading" ? (
				<div className="recording-app">
					<div
						className="share-workspace"
						aria-label="Loading recording"
						aria-busy="true"
					>
						<div className="recording-column">
							<div>
								<Skeleton className="loading-title" />
								<Skeleton className="loading-meta" />
							</div>
							<Skeleton className="loading-video" />
						</div>
						<Skeleton className="loading-sidebar" />
					</div>
				</div>
			) : view === "recording" && data ? (
				<Recording data={data} />
			) : (
				<CenteredCard>
					{view === "password" ? (
						<>
							<LockKeyIcon size={28} />
							<h1>{title}</h1>
							<p>This recording is password protected.</p>
							<form
								className="gate-form"
								onSubmit={(e) => {
									e.preventDefault();
									void unlock();
								}}
							>
								<TextField
									value={password}
									onChange={setPassword}
									isRequired
									isDisabled={unlocking}
								>
									<Label>Password</Label>
									<Input
										type="password"
										autoComplete="current-password"
										autoFocus
									/>
								</TextField>
								{error && <Notice>{error}</Notice>}
								<Button
									type="submit"
									isPending={unlocking}
									isDisabled={!password || unlocking}
								>
									{unlocking ? "Unlocking…" : "Unlock recording"}
								</Button>
							</form>
						</>
					) : view === "expired" ? (
						<>
							<h1>Recording unavailable</h1>
							<p>
								This link has expired or the recording has been removed. Ask the
								creator for a new link.
							</p>
						</>
					) : (
						<>
							<h1>Couldn’t load the recording</h1>
							<p>Check your connection and try again.</p>
							<Button onPress={() => void load()}>
								<ArrowClockwiseIcon size={16} />
								Try again
							</Button>
						</>
					)}
				</CenteredCard>
			)}
		</>
	);
}
