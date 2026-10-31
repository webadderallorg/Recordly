import ThemeToggle from "./ThemeToggle";
import {
	Button,
	Card,
	Dropdown,
	Input,
	Label,
	Modal,
	Skeleton,
	TextField,
	toast,
} from "@heroui/react";
import {
	CaretDownIcon,
	CloudIcon,
	DotsThreeIcon,
	FolderSimpleIcon,
	GearSixIcon,
	LockKeyIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	SignOutIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import {
	fetchVideos,
	renewVideo,
	deleteVideo,
	parseUTC,
	type LibraryVideo,
} from "../scripts/library";
import { CenteredCard, Notice, Notifications } from "./ShareUI";
import { LibraryCard, type LibraryFolder } from "./library/LibraryCard";

export function LibraryLogin() {
	const [error, setError] = useState(false);
	useEffect(() => setError(new URLSearchParams(location.search).has("error")), []);
	return (
		<CenteredCard>
			<LockKeyIcon size={28} />
			<h1>Your library</h1>
			<p>Enter your dashboard password to manage shared recordings.</p>
			<form method="POST" action="/library/login" className="gate-form">
				<TextField name="password" isRequired>
					<Label>Password</Label>
					<Input type="password" autoComplete="current-password" autoFocus />
				</TextField>
				{error && <Notice>Incorrect password. Please try again.</Notice>}
				<Button type="submit">Unlock library</Button>
			</form>
		</CenteredCard>
	);
}

export default function LibraryPage() {
	const [section, setSection] = useState("shared");
	const [query, setQuery] = useState("");
	const [period, setPeriod] = useState("all");
	const [sort, setSort] = useState("recent");
	const [videos, setVideos] = useState<LibraryVideo[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [pending, setPending] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
	const load = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			setVideos(await fetchVideos());
		} catch {
			setError("Could not load your recordings. Please try again.");
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load]);
	async function renew(code: string) {
		setPending(code);
		try {
			const expires = await renewVideo(code);
			if (!expires) throw new Error();
			setVideos((current) =>
				current.map((video) =>
					video.share_code === code ? { ...video, expires_at: expires } : video,
				),
			);
			toast.success("Share link renewed");
		} catch {
			toast.danger("Could not renew this link. Try again.");
		} finally {
			setPending(null);
		}
	}
	async function remove(code: string) {
		setPending(code);
		try {
			if (!(await deleteVideo(code))) throw new Error();
			setVideos((current) => current.filter((video) => video.share_code !== code));
			toast.success("Recording deleted");
			return true;
		} catch {
			toast.danger("Could not delete this recording. Try again.");
			return false;
		} finally {
			setPending(null);
		}
	}
	const [folders, setFolders] = useState<LibraryFolder[]>([]);
	const [editingFolder, setEditingFolder] = useState<string | null>(null);
	const [folderName, setFolderName] = useState("");
	const [help, setHelp] = useState(false);
	const [selecting, setSelecting] = useState(false);
	const [selected, setSelected] = useState<string[]>([]);
	const [deleting, setDeleting] = useState(false);
	useEffect(() => {
		try {
			const saved: unknown = JSON.parse(
				localStorage.getItem("recordly-cloud-folders") || "[]",
			);
			if (Array.isArray(saved))
				setFolders(
					saved.filter(
						(f): f is LibraryFolder =>
							!!f &&
							typeof f.id === "string" &&
							typeof f.name === "string" &&
							Array.isArray(f.codes) &&
							f.codes.every((code: unknown) => typeof code === "string"),
					),
				);
		} catch {
			/* An unavailable or invalid local cache starts with no folders. */
		}
	}, []);
	function saveFolders(next: LibraryFolder[]) {
		setFolders(next);
		try {
			localStorage.setItem("recordly-cloud-folders", JSON.stringify(next));
		} catch {
			toast.danger("Folders could not be saved in this browser.");
		}
	}
	function assignFolder(code: string, id: string) {
		saveFolders(
			folders.map((folder) =>
				folder.id === id
					? {
							...folder,
							codes: folder.codes.includes(code)
								? folder.codes.filter((item) => item !== code)
								: [...folder.codes, code],
						}
					: folder,
			),
		);
	}
	function finishFolder() {
		if (folderName.trim())
			saveFolders(
				folders.map((folder) =>
					folder.id === editingFolder ? { ...folder, name: folderName.trim() } : folder,
				),
			);
		setEditingFolder(null);
	}
	const visible = videos
		.filter((video) => {
			const age = Date.now() - parseUTC(video.created_at).getTime();
			const folder = folders.find((folder) => folder.id === section);
			return (
				video.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
				(!folder || folder.codes.includes(video.share_code)) &&
				(period === "all" || age <= (period === "week" ? 7 : 30) * 86400000)
			);
		})
		.sort((a, b) =>
			sort === "name"
				? a.title.localeCompare(b.title)
				: parseUTC(b.created_at).getTime() - parseUTC(a.created_at).getTime(),
		);
	const busy = pending !== null || deleting;
	const navClass = (active: boolean) =>
		`h-10 w-full justify-start gap-3 px-3 text-[13px] ${active ? "bg-default/50 font-medium" : "text-muted-foreground"}`;
	async function copy(code: string) {
		try {
			await navigator.clipboard.writeText(`${location.origin}/s/${code}`);
			toast.success("Link copied");
		} catch {
			toast.danger("Could not copy the link.");
		}
	}
	return (
		<>
			<Notifications />
			<div className="library-dashboard flex h-full flex-row gap-0 rounded-none bg-background p-0 text-foreground">
				<aside
					aria-label="Library navigation"
					className="flex w-48 shrink-0 flex-col bg-transparent px-4 pb-5 pt-12 lg:w-56"
				>
					<div className="mb-4 flex h-10 items-center gap-2.5 px-3">
						<img src="/icon-64.png" alt="" className="size-7 rounded-lg" />
						<span className="text-[15px] font-semibold tracking-tight">Recordly</span>
					</div>

					<nav className="space-y-1">
						<Button
							variant="ghost"
							className={navClass(section === "shared")}
							aria-current={section === "shared" ? "page" : undefined}
							onPress={() => setSection("shared")}
						>
							<CloudIcon
								weight={section === "shared" ? "fill" : "regular"}
								className="size-[18px]"
							/>
							Shared
						</Button>
					</nav>
					<div className="mb-2 mt-9 flex items-center justify-between pl-3">
						<h2 className="text-[13px] font-semibold tracking-tight text-foreground/80">
							Folders
						</h2>
						<Button
							variant="ghost"
							isIconOnly
							className="size-7 min-w-7"
							aria-label="New folder"
							onPress={() => {
								let name = "Untitled folder",
									index = 1;
								while (folders.some((folder) => folder.name === name))
									name = `Untitled folder ${index++}`;
								const id = crypto.randomUUID();
								saveFolders([...folders, { id, name, codes: [] }]);
								setEditingFolder(id);
								setFolderName(name);
							}}
						>
							<PlusIcon className="size-3.5" />
						</Button>
					</div>
					<div className="library-folders min-h-0 flex-1 space-y-1 overflow-y-auto">
						{folders.map((folder) => (
							<div
								key={folder.id}
								className={`group flex h-10 items-center gap-1 rounded-lg px-1 ${section === folder.id ? "bg-default/70" : "hover:bg-default/40"}`}
							>
								<FolderSimpleIcon
									weight="fill"
									className="mx-2 size-4 shrink-0 text-accent"
								/>
								{editingFolder === folder.id ? (
									<form
										className="min-w-0 flex-1"
										onSubmit={(e) => {
											e.preventDefault();
											finishFolder();
										}}
									>
										<Input
											autoFocus
											aria-label="Folder name"
											maxLength={80}
											value={folderName}
											onChange={(e) => setFolderName(e.target.value)}
											onBlur={finishFolder}
											onKeyDown={(e) => {
												if (e.key === "Escape") setEditingFolder(null);
											}}
											className="h-8 w-full min-w-0 border-0 bg-transparent px-0 text-[13px] shadow-none"
										/>
									</form>
								) : (
									<Button
										variant="ghost"
										aria-current={section === folder.id ? "page" : undefined}
										onPress={() => setSection(folder.id)}
										className="h-full min-w-0 flex-1 justify-start rounded-none px-0 text-[13px]"
									>
										<span className="truncate">{folder.name}</span>
									</Button>
								)}
								<Dropdown>
									<Button
										variant="ghost"
										isIconOnly
										aria-label={`Options for ${folder.name}`}
										className="size-6 min-w-6 text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100"
									>
										<DotsThreeIcon className="size-4" />
									</Button>
									<Dropdown.Popover>
										<Dropdown.Menu aria-label="Folder options">
											<Dropdown.Item
												id="rename"
												onAction={() => {
													setEditingFolder(folder.id);
													setFolderName(folder.name);
												}}
											>
												Rename
											</Dropdown.Item>
											<Dropdown.Item
												id="remove"
												onAction={() => {
													saveFolders(
														folders.filter(
															(item) => item.id !== folder.id,
														),
													);
													if (section === folder.id) setSection("shared");
												}}
											>
												Remove folder
											</Dropdown.Item>
										</Dropdown.Menu>
									</Dropdown.Popover>
								</Dropdown>
							</div>
						))}
					</div>
					<div className="space-y-1 pt-6">
						<ThemeToggle sidebar />
						<Button
							variant="ghost"
							className={navClass(section === "settings")}
							onPress={() => setSection("settings")}
						>
							<GearSixIcon
								weight={section === "settings" ? "fill" : "regular"}
								className="size-[18px]"
							/>
							Settings
						</Button>
						<Button
							variant="ghost"
							className={navClass(false)}
							onPress={() => location.assign("/library/logout")}
						>
							<SignOutIcon className="size-[18px]" />
							Log out
						</Button>
					</div>
				</aside>
				<Card className="my-3 mr-3 flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden rounded-2xl bg-background p-0 shadow-sm">
					{section !== "settings" && (
						<>
							<header className="flex h-24 shrink-0 items-center gap-5 px-7 pt-5 lg:px-10">
								<div className="relative min-w-0 flex-1">
									<MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground/60" />
									<Input
										aria-label="Search recordings"
										placeholder="Search recordings…"
										value={query}
										onChange={(e) => setQuery(e.target.value)}
										className="h-11 w-full border-0 bg-default/30 pl-10 shadow-none"
									/>
								</div>
							</header>
							<div className="flex flex-wrap items-center gap-3 px-7 pb-7 lg:px-10">
								<div className="flex gap-2" aria-label="Time filters">
									{[
										["all", "All"],
										["week", "Last 7 days"],
										["month", "Last 30 days"],
									].map(([id, label]) => (
										<Button
											key={id}
											variant={period === id ? "secondary" : "ghost"}
											size="sm"
											aria-pressed={period === id}
											onPress={() => setPeriod(id)}
											className={`h-7 rounded-lg px-3 text-xs ${period === id ? "bg-default/60 text-foreground" : "text-muted-foreground"}`}
										>
											{label}
										</Button>
									))}
									<Button
										variant="ghost"
										isIconOnly
										className="size-7 min-w-7 text-danger"
										aria-label="Select recordings to delete"
										aria-pressed={selecting}
										onPress={() => {
											setSelecting(!selecting);
											setSelected([]);
										}}
									>
										<TrashIcon weight="fill" className="size-4" />
									</Button>
								</div>
								<div className="ml-auto">
									<Dropdown>
										<Button
											variant="ghost"
											size="sm"
											aria-label="Sort recordings"
											className="h-7 gap-2 text-xs text-muted-foreground"
										>
											{sort === "name" ? "Name" : "Last created"}
											<CaretDownIcon className="size-3" />
										</Button>
										<Dropdown.Popover>
											<Dropdown.Menu aria-label="Sort recordings">
												<Dropdown.Item
													id="recent"
													onAction={() => setSort("recent")}
												>
													Last created
												</Dropdown.Item>
												<Dropdown.Item
													id="name"
													onAction={() => setSort("name")}
												>
													Name
												</Dropdown.Item>
											</Dropdown.Menu>
										</Dropdown.Popover>
									</Dropdown>
								</div>
							</div>
							{selecting && (
								<div className="flex items-center gap-3 px-7 pb-5 text-xs lg:px-10">
									<Button
										variant="ghost"
										size="sm"
										onPress={() =>
											setSelected(visible.map((video) => video.share_code))
										}
									>
										Select all
									</Button>
									<span>{selected.length} selected</span>
									<Button
										variant="danger"
										size="sm"
										isDisabled={!selected.length || busy}
										onPress={() => setConfirmDelete(selected)}
									>
										Delete
									</Button>
									<Button
										variant="ghost"
										size="sm"
										onPress={() => {
											setSelecting(false);
											setSelected([]);
										}}
									>
										Cancel
									</Button>
								</div>
							)}
						</>
					)}
					<main className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-7 pb-10 lg:px-10">
						{section === "settings" ? (
							<div className="space-y-5 py-10">
								<h1 className="text-lg font-semibold">Library settings</h1>
								<p className="text-sm text-muted">
									Folders are saved in this browser. Recordings and share links
									are stored by your sharing service.
								</p>
								<Button variant="secondary" onPress={() => setHelp(true)}>
									How to share a recording
								</Button>
							</div>
						) : (
							<>
								{error && <Notice>{error}</Notice>}
								<ul
									aria-label="Your recordings"
									className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-x-7 gap-y-10 lg:gap-x-9"
								>
									{loading
										? [0, 1, 2].map((i) => (
												<li key={i}>
													<Skeleton className="aspect-[4/3] w-full rounded-xl" />
												</li>
											))
										: visible.map((video) => (
												<LibraryCard
													key={video.share_code}
													video={video}
													folders={folders}
													assignFolder={assignFolder}
													selecting={selecting}
													selected={selected.includes(video.share_code)}
													toggleSelected={() =>
														setSelected((current) =>
															current.includes(video.share_code)
																? current.filter(
																		(code) =>
																			code !==
																			video.share_code,
																	)
																: [...current, video.share_code],
														)
													}
													busy={busy}
													copy={() => void copy(video.share_code)}
													renew={() => void renew(video.share_code)}
													remove={() =>
														setConfirmDelete([video.share_code])
													}
												/>
											))}
								</ul>
								{!loading && !error && !visible.length && (
									<div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
										<CloudIcon weight="fill" className="size-8 opacity-40" />
										<p>
											{videos.length
												? "No recordings match this view."
												: "No shared recordings yet."}
										</p>
										<Button
											variant="secondary"
											onPress={() => {
												setQuery("");
												setPeriod("all");
												setSection("shared");
											}}
										>
											Show all recordings
										</Button>
									</div>
								)}
							</>
						)}
					</main>
				</Card>
			</div>
			<Modal isOpen={help} onOpenChange={setHelp}>
				<Modal.Backdrop>
					<Modal.Container>
						<Modal.Dialog>
							<Modal.Header>
								<Modal.Heading>Share a recording</Modal.Heading>
							</Modal.Header>
							<Modal.Body>
								<p>
									Open a project in Recordly, choose Export, then Create share
									link. Your shared recording will appear here.
								</p>
							</Modal.Body>
							<Modal.Footer>
								<Button onPress={() => setHelp(false)}>Got it</Button>
							</Modal.Footer>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
			<Modal
				isOpen={confirmDelete !== null}
				onOpenChange={(open) => {
					if (!open && !busy) setConfirmDelete(null);
				}}
			>
				<Modal.Backdrop>
					<Modal.Container>
						<Modal.Dialog>
							<Modal.Header>
								<Modal.Heading>
									Delete{" "}
									{confirmDelete?.length === 1 ? "recording" : "recordings"}?
								</Modal.Heading>
							</Modal.Header>
							<Modal.Body>
								<p>
									This permanently removes {confirmDelete?.length} recording(s)
									and their share links.
								</p>
							</Modal.Body>
							<Modal.Footer>
								<Button
									variant="secondary"
									isDisabled={busy}
									onPress={() => setConfirmDelete(null)}
								>
									Cancel
								</Button>
								<Button
									variant="danger"
									isDisabled={busy}
									isPending={deleting}
									onPress={async () => {
										setDeleting(true);
										try {
											const failed: string[] = [];
											for (const code of confirmDelete || []) {
												if (!(await remove(code))) failed.push(code);
											}
											setConfirmDelete(failed.length ? failed : null);
											setSelected(failed);
											setSelecting(failed.length > 0);
										} finally {
											setDeleting(false);
										}
									}}
								>
									Delete
								</Button>
							</Modal.Footer>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
		</>
	);
}
