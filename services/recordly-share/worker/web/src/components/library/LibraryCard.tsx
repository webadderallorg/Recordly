import { Avatar, Button, Dropdown } from "@heroui/react";
import {
	CheckIcon,
	DotsThreeIcon,
	FolderSimpleIcon,
	ImageSquareIcon,
	PlusIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { parseUTC, type LibraryVideo } from "../../scripts/library";

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
}: {
	video: LibraryVideo;
	folders: LibraryFolder[];
	assignFolder: (code: string, id: string) => void;
	selecting: boolean;
	selected: boolean;
	toggleSelected: () => void;
	busy: boolean;
	renew: () => void;
	remove: () => void;
	copy: () => void;
}) {
	const [failed, setFailed] = useState(false);
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
				<Avatar
					aria-label="Your library"
					className="!size-[48px] shrink-0 !rounded-full bg-accent/15 text-accent"
				>
					<Avatar.Fallback className="!rounded-full bg-accent/15 text-xs font-medium text-accent">
						LP
					</Avatar.Fallback>
				</Avatar>
				<div className="h-12 min-w-0 flex-1">
					<p
						title={video.title}
						className="truncate pr-8 text-[12px] font-medium leading-5"
					>
						{video.title}
					</p>
					<div className="mt-1 flex h-6 min-w-0 items-center gap-2">
						<p className="shrink-0 text-[11px] text-muted-foreground">
							{parseUTC(video.created_at).toLocaleDateString(undefined, {
								month: "short",
								day: "numeric",
							})}
						</p>
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
								className="h-6 min-w-0 shrink-0 gap-1.5 rounded-full px-2.5 text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100"
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
							<Dropdown.Item id="renew" onAction={renew}>
								Renew share link
							</Dropdown.Item>
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
