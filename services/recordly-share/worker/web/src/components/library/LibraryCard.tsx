import { Button, Dropdown } from "@heroui/react";
import {
	CheckIcon,
	DotsThreeIcon,
	FolderSimpleIcon,
	ImageSquareIcon,
	PlusIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { formatDuration, parseUTC, type LibraryVideo } from "../../scripts/library";

export type LibraryFolder = { id: string; name: string; codes: string[] };
export function LibraryCard({
	video,
	folders,
	assignFolder,
	selecting,
	selected,
	toggleSelected,
	busy,
	renew,
	remove,
	copy,
	manage,
}: {
	video: LibraryVideo;
	folders: LibraryFolder[];
	assignFolder: (code: string, id: string) => void;
	selecting: boolean;
	selected: boolean;
	toggleSelected: () => void;
	busy: boolean;
	renew?: () => void;
	remove: () => void;
	copy: () => void;
	manage?: () => void;
}) {
	const [failed, setFailed] = useState(false);
	const expires = video.expires_at ? parseUTC(video.expires_at) : null;
	const expiryLabel = video.expires_at === null
		? "No scheduled expiry"
		: !expires || Number.isNaN(expires.getTime())
			? "Expiry unknown"
			: expires.getTime() <= Date.now()
				? "Expired"
				: `Expires ${expires.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
	const titleClass = "line-clamp-2 break-words pr-8 text-left text-[15px] font-semibold leading-6 text-foreground rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
	const assigned = folders.filter((folder) => folder.codes.includes(video.share_code));
	return (
		<li className="group min-w-0">
			<Button
				variant="ghost"
				isDisabled={busy}
				aria-label={video.title}
				onPress={() =>
					selecting
						? toggleSelected()
						: window.open(`/s/${video.share_code}`, "_blank", "noopener,noreferrer")
				}
				aria-pressed={selecting ? selected : undefined}
				className="relative block h-auto w-full min-w-0 rounded-xl p-0"
			>
				<div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-default/60">
					{!failed ? (
						<img
							src={`/thumb/${video.share_code}`}
							alt=""
							loading="lazy"
							draggable={false}
							onError={() => setFailed(true)}
							className="h-full w-full object-cover"
						/>
					) : (
						<ImageSquareIcon
							weight="fill"
							className="size-8 text-muted-foreground/20"
						/>
					)}
					<span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-2 py-1 text-xs font-medium text-white" aria-label={`Duration ${formatDuration(video.duration)}`}>
						{formatDuration(video.duration)}
					</span>
				</div>
				{selecting && (
					<span
						className={`absolute right-2 top-2 flex size-5 items-center justify-center rounded-md ${selected ? "bg-accent text-white" : "bg-background/90"}`}
					>
						{selected && <CheckIcon className="size-3.5" />}
					</span>
				)}
			</Button>
			<div className="relative flex items-start justify-between gap-4 pt-5">
				<div className="min-w-0 flex-1">
					{selecting ? (
						<button type="button" disabled={busy} aria-pressed={selected} onClick={toggleSelected} className={titleClass} title={video.title}>
							{video.title}
						</button>
					) : (
						<a href={`/s/${video.share_code}`} target="_blank" rel="noopener noreferrer" aria-disabled={busy || undefined} onClick={(event) => { if (busy) event.preventDefault(); }} className={titleClass} title={video.title}>
							{video.title}
						</a>
					)}
					<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
						<span>{parseUTC(video.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
						<span>{video.view_count.toLocaleString()} {video.view_count === 1 ? "view" : "views"}</span>
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
						<span>{expiryLabel}</span>
						<span>{video.is_protected ? "Password protected" : "Anyone with the link"}</span>
					</div>
					<div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
						{assigned.map((folder) => (
							<button
								key={folder.id}
								title={`Remove from ${folder.name}`}
								onClick={() => assignFolder(video.share_code, folder.id)}
								className="max-w-24 truncate rounded-full bg-default/60 px-2 py-1 text-[11px]"
							>
								{folder.name}
							</button>
						))}
						<Dropdown>
							<Button
								variant="ghost"
								size="sm"
								aria-label={`Add folder to ${video.title}`}
								className="h-6 min-w-0 shrink-0 gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground"
							>
								<PlusIcon className="size-3" />
								Add folder
							</Button>
							<Dropdown.Popover>
								<Dropdown.Menu aria-label="Assign recording folder">
									{folders.map((folder) => (
										<Dropdown.Item
											key={folder.id}
											id={folder.id}
											textValue={folder.name}
											onAction={() =>
												assignFolder(video.share_code, folder.id)
											}
										>
											<FolderSimpleIcon weight="fill" />
											{folder.name}
											{folder.codes.includes(video.share_code) && (
												<CheckIcon className="size-3" />
											)}
										</Dropdown.Item>
									))}
									{!folders.length && (
										<Dropdown.Item id="empty" isDisabled>
											Create a folder in the sidebar
										</Dropdown.Item>
									)}
								</Dropdown.Menu>
							</Dropdown.Popover>
						</Dropdown>
					</div>
				</div>
				<Dropdown>
					<Button
						variant="ghost"
						isIconOnly
						aria-label={`Options for ${video.title}`}
						isDisabled={busy}
						className="absolute right-0 top-5 size-6 min-w-6 text-muted-foreground"
					>
						<DotsThreeIcon weight="bold" className="size-5" />
					</Button>
					<Dropdown.Popover>
						<Dropdown.Menu aria-label="Recording options">
							<Dropdown.Item
								id="open"
								onAction={() =>
									window.open(
										`/s/${video.share_code}`,
										"_blank",
										"noopener,noreferrer",
									)
								}
							>
								Open recording
							</Dropdown.Item>
							<Dropdown.Item id="copy" onAction={copy}>
								Copy link
							</Dropdown.Item>
							{manage && <Dropdown.Item id="manage" onAction={manage}>Manage sharing</Dropdown.Item>}
							{renew && <Dropdown.Item id="renew" onAction={renew}>
								Renew share link
							</Dropdown.Item>}
							<Dropdown.Item id="delete" onAction={remove} className="text-danger">
								Delete recording
							</Dropdown.Item>
						</Dropdown.Menu>
					</Dropdown.Popover>
				</Dropdown>
			</div>
		</li>
	);
}
