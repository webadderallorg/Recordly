import { Button, Tabs } from "@heroui/react";
import { LinkSimpleIcon } from "@phosphor-icons/react";
import type { ShareData } from "../scripts/api";
import { formatTimestamp } from "../scripts/api";
import { copyLink } from "./ShareUI";
import PagedPanel from "./PagedPanel";

export default function ShareDetails({
	data,
	time,
	seek,
}: {
	data: ShareData;
	time: number;
	seek: (time: number) => void;
}) {
	const overview = (
		<PagedPanel label="Overview">
			{data.creator?.bio && (
				<section className="recording-details">
					<h2>About the creator</h2>
					<p>{data.creator.bio}</p>
				</section>
			)}
			<section className="recording-details">
				<h2>Recording</h2>
				<p>{data.video.summary || data.video.title}</p>
			</section>
			{data.chapters.length > 0 && (
				<section className="recording-details">
					<h2>Chapters</h2>
					<div className="chapter-list">
						{data.chapters.map((chapter, i) => (
							<Button
								key={i}
								size="sm"
								variant="ghost"
								onPress={() => seek(chapter.timestamp)}
							>
								<span className="timestamp">
									{formatTimestamp(chapter.timestamp)}
								</span>
								{chapter.title}
							</Button>
						))}
					</div>
				</section>
			)}
		</PagedPanel>
	);

	if (data.segments.length === 0) {
		return <div className="viewer-details-tabs feedback-tabs">{overview}</div>;
	}

	return (
		<Tabs defaultSelectedKey="overview" className="viewer-details-tabs feedback-tabs">
			<Tabs.ListContainer>
				<Tabs.List aria-label="Recording information">
					<Tabs.Tab id="overview">
						Overview
						<Tabs.Indicator />
					</Tabs.Tab>
					{data.segments.length > 0 && (
						<Tabs.Tab id="transcript">
							Transcript
							<Tabs.Indicator />
						</Tabs.Tab>
					)}
				</Tabs.List>
			</Tabs.ListContainer>
			<Tabs.Panel id="overview">
				{overview}
			</Tabs.Panel>
			{data.segments.length > 0 && (
				<Tabs.Panel id="transcript">
					<PagedPanel label="Transcript">
						{data.segments.map((segment, i) => (
							<article
								key={i}
								className="transcript-item"
								data-active={time >= segment.start_time && time < segment.end_time}
							>
								<div className="transcript-heading">
									<Button
										size="sm"
										variant="ghost"
										onPress={() => seek(segment.start_time)}
									>
										<span className="timestamp">
											{formatTimestamp(segment.start_time)}
										</span>
									</Button>
									{segment.speaker && <span>{segment.speaker}</span>}
									<Button
										size="sm"
										variant="ghost"
										isIconOnly
										className="copy-timestamp"
										aria-label={`Copy link to ${formatTimestamp(segment.start_time)}`}
										onPress={() => void copyLink(segment.start_time)}
									>
										<LinkSimpleIcon size={15} />
									</Button>
								</div>
								<Button
									variant="ghost"
									className="transcript-seek"
									onPress={() => seek(segment.start_time)}
								>
									{segment.text}
								</Button>
							</article>
						))}
					</PagedPanel>
				</Tabs.Panel>
			)}
		</Tabs>
	);
}
