import {
	Avatar,
	Button,
	Card,
	Chip,
	Label,
	Spinner,
	Tabs,
	TextArea,
	TextField,
	toast,
} from "@heroui/react";
import { ChatCircleIcon, ClockIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type Dispatch,
	type SetStateAction,
	type RefObject,
} from "react";
import {
	fetchCommentsForViewer,
	CommentSignInError,
	type CommentAccountState,
	formatDate,
	formatTimestamp,
	postComment,
	type Comment,
	type ShareData,
} from "../scripts/api";
import { timestampParts } from "../scripts/shareModel";
import { Notice } from "./ShareUI";
import PagedPanel from "./PagedPanel";
import CommentAccount from "./CommentAccount";
import OwnCommentActions from "./OwnCommentActions";

interface Props {
	data: ShareData;
	time: number;
	duration: number;
	comments: Comment[];
	setComments: Dispatch<SetStateAction<Comment[]>>;
	seek: (time: number) => void;
	composerRef: RefObject<HTMLTextAreaElement | null>;
	selectedTab: string;
	setSelectedTab: (tab: string) => void;
}

export default function ShareFeedback({
	data,
	time,
	duration,
	comments,
	setComments,
	seek,
	composerRef,
	selectedTab,
	setSelectedTab,
}: Props) {
	const [account, setAccount] = useState<CommentAccountState | null>(null);
	const accountRef = useRef(account);
	const [ownershipKey, setOwnershipKey] = useState<string>();
	const ownershipKeyRef = useRef(ownershipKey);
	const commentsRef = useRef(comments);
	const shareCodeRef = useRef(data.shareCode);
	useLayoutEffect(() => {
		accountRef.current = account;
		ownershipKeyRef.current = ownershipKey;
		commentsRef.current = comments;
		shareCodeRef.current = data.shareCode;
	}, [account, ownershipKey, comments, data.shareCode]);
	const [reload, setReload] = useState(0);
	const mutationVersion = useRef(0);
	const [reauthenticate, setReauthenticate] = useState(0);
	const draftKey = `recordly-comment-draft:${data.shareCode}`;
	const [draftLoaded, setDraftLoaded] = useState(false);
	const [text, setText] = useState("");
	const [lockedTime, setLockedTime] = useState<number | null>(null);
	const draftRevision = useRef(0);
	const [posting, setPosting] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [moreLoading, setMoreLoading] = useState(false);
	const activeIndex = comments.reduce(
		(found, comment, i) => (comment.timestamp <= time + 0.3 ? i : found),
		-1,
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: auth and explicit reload transitions restart the request; refs retain committed ownership.
	useEffect(() => {
		let cancelled = false;
		const requestVersion = mutationVersion.current;
		const viewer = accountRef.current;
		setOwnershipKey(undefined);
		setLoading(true);
		setPage(1);
		fetchCommentsForViewer(data.shareCode, 1, 50, viewer)
			.then((result) => {
				if (
					cancelled ||
					viewer?.key !== accountRef.current?.key ||
					shareCodeRef.current !== data.shareCode
				)
					return;
				if (requestVersion !== mutationVersion.current) {
					setReload((current) => current + 1);
					return;
				}
				setOwnershipKey(result.ownershipKey);
				setComments([...result.comments].sort((a, b) => a.timestamp - b.timestamp));
				setTotal(result.total);
				setLoading(false);
			})
			.catch(() => {
				if (
					!cancelled &&
					viewer?.key === accountRef.current?.key &&
					shareCodeRef.current === data.shareCode
				) {
					setError("Comments could not be loaded. Reload the page to try again.");
					setLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [data.shareCode, account?.key, reload, setComments]);

	useEffect(() => {
		draftRevision.current++;
		try {
			const saved = sessionStorage.getItem(draftKey);
			if (saved) {
				const draft = JSON.parse(saved);
				if (
					typeof draft.text === "string" &&
					draft.text.length <= 2000 &&
					Number.isFinite(draft.time) &&
					draft.time >= 0
				) {
					setText(draft.text);
					setLockedTime(draft.time);
				}
			}
		} catch {
			/* The composer remains usable without storage. */
		}
		setDraftLoaded(true);
	}, [draftKey]);
	useEffect(() => {
		if (!draftLoaded) return;
		try {
			if (text)
				sessionStorage.setItem(
					draftKey,
					JSON.stringify({ text, time: lockedTime ?? time }),
				);
			else sessionStorage.removeItem(draftKey);
		} catch {
			/* Keep the in-memory draft when storage is unavailable. */
		}
	}, [draftLoaded, draftKey, text, lockedTime, time]);

	async function loadMore() {
		const viewer = accountRef.current;
		setMoreLoading(true);
		try {
			const version = mutationVersion.current;
			const result = await fetchCommentsForViewer(data.shareCode, page + 1, 50, viewer);
			if (
				viewer?.key !== accountRef.current?.key ||
				version !== mutationVersion.current ||
				shareCodeRef.current !== data.shareCode
			)
				return;
			const inheritOwnership = ownershipKeyRef.current === result.ownershipKey;
			setOwnershipKey(result.ownershipKey);
			setComments((current) =>
				[
					...new Map(
						[
							...(inheritOwnership
								? current
								: current.map((comment) => ({ ...comment, can_manage: false }))),
							...result.comments,
						].map((comment) => [comment.id, comment]),
					).values(),
				].sort((a, b) => a.timestamp - b.timestamp || a.id - b.id),
			);
			setTotal(result.total);
			setPage(page + 1);
		} catch {
			if (viewer?.key === accountRef.current?.key && shareCodeRef.current === data.shareCode)
				toast.danger("Could not load more comments. Try again.");
		} finally {
			setMoreLoading(false);
		}
	}

	async function submit() {
		if (
			data.video.feedback_enabled === false ||
			posting ||
			!account ||
			account.needsDisplayName ||
			!text.trim()
		)
			return;
		const timestamp = lockedTime ?? time;
		const viewer = account;
		const submittedText = text;
		const revision = draftRevision.current;
		setPosting(true);
		setError("");
		try {
			const accessToken = await viewer.getAccessToken();
			if (accountRef.current?.key !== viewer.key || shareCodeRef.current !== data.shareCode)
				return;
			const result = await postComment(
				data.shareCode,
				timestamp,
				submittedText.trim(),
				accessToken,
			);
			if (draftRevision.current === revision || shareCodeRef.current !== data.shareCode) {
				try {
					const saved = JSON.parse(sessionStorage.getItem(draftKey) || "null");
					if (saved?.text === submittedText && saved.time === timestamp)
						sessionStorage.removeItem(draftKey);
				} catch {
					/* Successful posting does not depend on draft storage. */
				}
			}
			if (shareCodeRef.current !== data.shareCode) return;
			mutationVersion.current++;
			const currentViewer = accountRef.current;
			const inheritOwnership = ownershipKeyRef.current === currentViewer?.key;
			const known = commentsRef.current.some((comment) => comment.id === result.id);
			setOwnershipKey(currentViewer?.key);
			setComments((current) =>
				[
					...new Map(
						[
							...(inheritOwnership
								? current
								: current.map((comment) => ({ ...comment, can_manage: false }))),
							{
								id: result.id,
								can_manage: currentViewer?.key === viewer.key,
								timestamp,
								author_name: result.author_name,
								text: submittedText.trim(),
								created_at: new Date().toISOString().slice(0, 19),
							},
						].map((comment) => [comment.id, comment]),
					).values(),
				].sort((a, b) => a.timestamp - b.timestamp),
			);
			if (!known) setTotal((current) => current + 1);
			// The new account's list may have completed before the server inserted this post.
			if (currentViewer?.key !== viewer.key) setReload((current) => current + 1);
			if (draftRevision.current === revision) {
				setText("");
				setLockedTime(null);
			}
			toast.success(`Comment posted at ${formatTimestamp(timestamp)}`);
		} catch (cause) {
			if (accountRef.current?.key !== viewer.key || shareCodeRef.current !== data.shareCode)
				return;
			if (cause instanceof CommentSignInError) setReauthenticate((current) => current + 1);
			setError(
				cause instanceof Error
					? cause.message
					: "Could not post your comment. Your draft is saved here—please try again.",
			);
		} finally {
			setPosting(false);
		}
	}

	return (
		<Card className="feedback-card">
			<Tabs
				selectedKey={selectedTab}
				onSelectionChange={(key) => setSelectedTab(String(key))}
				className="feedback-tabs"
			>
				<Tabs.ListContainer>
					<Tabs.List aria-label="Recording feedback">
						<Tabs.Tab id="comments">
							Comments
							{total > 0 && (
								<Chip size="sm" variant="soft">
									{total}
								</Chip>
							)}
							<Tabs.Indicator />
						</Tabs.Tab>
					</Tabs.List>
				</Tabs.ListContainer>
				<Tabs.Panel id="comments">
					<PagedPanel label="Comments">
						{loading ? (
							<div className="empty-feedback">
								<Spinner aria-label="Loading comments" />
							</div>
						) : !comments.length ? (
							<div className="empty-feedback">
								<ChatCircleIcon size={28} />
								<h2>
									{data.video.feedback_enabled === false
										? "No comments yet"
										: "Start the conversation"}
								</h2>
								<p>
									{data.video.feedback_enabled === false
										? "The creator has turned off new comments."
										: "Leave feedback at the exact moment you’re watching."}
								</p>
							</div>
						) : (
							comments.map((comment, i) => (
								<article
									className="comment-item"
									data-active={i === activeIndex}
									key={comment.id}
								>
									<div className="comment-heading">
										<Avatar size="sm">
											<Avatar.Fallback>
												{comment.author_name.slice(0, 2).toUpperCase()}
											</Avatar.Fallback>
										</Avatar>
										<strong>{comment.author_name}</strong>
										<Button
											size="sm"
											variant="ghost"
											aria-label={`Jump to ${formatTimestamp(comment.timestamp)}`}
											onPress={() => seek(comment.timestamp)}
										>
											<span className="timestamp">
												{formatTimestamp(comment.timestamp)}
											</span>
										</Button>
									</div>
									<p>
										{timestampParts(comment.text, duration).map((part, n) =>
											part.time === undefined ? (
												part.text
											) : (
												<Button
													key={n}
													size="sm"
													variant="ghost"
													className="inline-timestamp timestamp"
													onPress={() => seek(part.time!)}
												>
													{part.text}
												</Button>
											),
										)}
									</p>
									<span className="comment-date">
										{formatDate(comment.created_at)}
									</span>
									{account &&
										ownershipKey === account.key &&
										comment.can_manage && (
											<OwnCommentActions
												key={`${comment.id}:${account.key}`}
												comment={comment}
												shareCode={data.shareCode}
												account={account}
												canEdit={data.video.feedback_enabled !== false}
												onUpdated={(text) => {
													mutationVersion.current++;
													setComments((current) =>
														current.map((item) =>
															item.id === comment.id
																? { ...item, text }
																: item,
														),
													);
												}}
												onDeleted={() => {
													mutationVersion.current++;
													setComments((current) =>
														current.filter(
															(item) => item.id !== comment.id,
														),
													);
													setTotal((current) => Math.max(0, current - 1));
													// Deletion shifts API offsets; refill the first page before loading more.
													setReload((current) => current + 1);
												}}
												onReauthenticate={() =>
													setReauthenticate((current) => current + 1)
												}
											/>
										)}
								</article>
							))
						)}
						{comments.length < total && (
							<Button
								size="sm"
								variant="ghost"
								isPending={moreLoading}
								onPress={() => void loadMore()}
							>
								Load more comments
							</Button>
						)}
					</PagedPanel>
				</Tabs.Panel>
			</Tabs>
			{data.video.feedback_enabled === false && (
				<p className="p-4 text-sm text-muted">
					The creator has turned off new comments and reactions.
				</p>
			)}
			{error && (
				<div className="p-4">
					<Notice>{error}</Notice>
				</div>
			)}
			{
				<CommentAccount
					canComment={data.video.feedback_enabled !== false}
					onChange={setAccount}
					reauthenticate={reauthenticate}
					returnTo={() => `/s/${data.shareCode}?t=${Math.max(0, lockedTime ?? time)}`}
				/>
			}
			<form
				className="composer"
				hidden={
					selectedTab !== "comments" ||
					data.video.feedback_enabled === false ||
					!account ||
					account.needsDisplayName
				}
				onSubmit={(e) => {
					e.preventDefault();
					void submit();
				}}
			>
				<TextField
					name="comment"
					value={text}
					onChange={(value) => {
						draftRevision.current++;
						setText(value);
						setLockedTime(value.trim() ? (lockedTime ?? time) : null);
					}}
					isRequired
					isDisabled={posting}
				>
					<Label>Comment</Label>
					<TextArea
						ref={composerRef}
						maxLength={2000}
						placeholder="Share your thoughts…"
						onKeyDown={(e) => {
							if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
								e.preventDefault();
								void submit();
							}
						}}
					/>
				</TextField>
				<div className="composer-footer">
					<Button
						type="button"
						size="sm"
						variant="ghost"
						aria-label={`Comment timestamp ${formatTimestamp(lockedTime ?? time)}. Use current video time`}
						onPress={() => {
							draftRevision.current++;
							setLockedTime(time);
						}}
					>
						<ClockIcon size={14} />
						<span className="timestamp">{formatTimestamp(lockedTime ?? time)}</span>
					</Button>
					<Button
						type="submit"
						size="sm"
						isPending={posting}
						isDisabled={!account || !text.trim() || posting}
					>
						<PaperPlaneTiltIcon size={15} />
						{posting ? "Posting…" : "Post"}
					</Button>
				</div>
			</form>
		</Card>
	);
}
