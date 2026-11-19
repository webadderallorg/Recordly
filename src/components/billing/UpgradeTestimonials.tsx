import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { ChatCircle, Heart, SealCheck } from "@phosphor-icons/react";
import { featuredUpgradeTestimonials as upgradeTestimonials } from "./upgradeTestimonialData";
import "./UpgradeTestimonials.css";

function TestimonialCard({ item }: { item: (typeof upgradeTestimonials)[number] }) {
	const t = useScopedT("billing");
	const { locale } = useI18n();
	const isTweet = item.platform === "X";
	const formatCount = (count: number) => new Intl.NumberFormat(locale).format(count);
	return (
		<figure className="testimonial-card" data-platform={item.platform}>
			<figcaption>
				<span className="testimonial-avatar" aria-hidden="true">
					{item.author.slice(0, 1).toUpperCase()}
					{item.avatarUrl && (
						<img
							src={item.avatarUrl}
							alt=""
							loading="lazy"
							decoding="async"
							referrerPolicy="no-referrer"
							onError={(event) => {
								event.currentTarget.hidden = true;
							}}
						/>
					)}
				</span>
				<span className="testimonial-author">
					<strong>
						<span>{item.author}</span>
						{item.verified && (
							<SealCheck
								size={15}
								weight="fill"
								className="testimonial-verified"
								aria-label={t("verified", "Verified on X")}
							/>
						)}
					</strong>
					<span>{item.handle}</span>
				</span>
				<span className="testimonial-platform-logo" role="img" aria-label={item.platform}>
					<img
						src={isTweet ? "/social/x-logo-black.png" : "/social/reddit-logo.png"}
						className={isTweet ? "testimonial-logo-light" : undefined}
						alt=""
						width={18}
						height={18}
					/>
					{isTweet && (
						<img
							src="/social/x-logo-white.png"
							className="testimonial-logo-dark"
							alt=""
							width={18}
							height={18}
						/>
					)}
				</span>
			</figcaption>
			<blockquote>{item.quote}</blockquote>
			{isTweet && item.likes != null && (
				<div className="testimonial-post-engagement">
					<span
						aria-label={t("likes", "{{count}} likes", {
							count: formatCount(item.likes),
						})}
					>
						<Heart size={18} weight="fill" aria-hidden="true" />
						{t("likes", "{{count}} likes", { count: formatCount(item.likes) })}
					</span>
					{item.replies != null && (
						<span
							aria-label={t("replies", "{{count}} replies", {
								count: formatCount(item.replies),
							})}
						>
							<ChatCircle size={16} aria-hidden="true" />
							{t("replies", "{{count}} replies", {
								count: formatCount(item.replies),
							})}
						</span>
					)}
				</div>
			)}
			<div className="testimonial-post-meta">
				<span>
					{item.publishedAt ? (
						<time dateTime={item.publishedAt}>
							{new Date(item.publishedAt).toLocaleDateString(locale, {
								month: "short",
								day: "numeric",
								year: "numeric",
							})}
						</time>
					) : isTweet ? (
						"X"
					) : (
						"r/macapps"
					)}
				</span>
			</div>
		</figure>
	);
}

export function UpgradeTestimonials() {
	const t = useScopedT("billing");
	const { locale } = useI18n();
	const rankedTestimonials = [...upgradeTestimonials].sort(
		(a, b) => (b.likes ?? -1) - (a.likes ?? -1),
	);
	const mentionsRepo = (quote: string) => /\b(?:repos?|repository|repositories)\b/i.test(quote);
	const tweets = rankedTestimonials
		.filter((item) => item.platform === "X")
		.sort(
			(a, b) =>
				Number(mentionsRepo(a.quote)) - Number(mentionsRepo(b.quote)) ||
				(b.likes ?? -1) - (a.likes ?? -1),
		);
	const reddit = rankedTestimonials.filter((item) => item.platform === "Reddit");
	const rows = [0, 1].map((rowIndex) => {
		const rowTweets = tweets.filter((_, index) => index % 2 === rowIndex);
		const rowReddit = reddit.filter((_, index) => index % 2 === rowIndex);
		return Array.from({ length: Math.max(rowTweets.length, rowReddit.length) }).flatMap(
			(_, index) => [rowTweets[index], rowReddit[index]].filter((item) => item != null),
		);
	});
	const orderedTestimonials = rows.flat();
	const columns = [0, 1, 2].map((columnIndex) =>
		orderedTestimonials.filter((_, index) => index % 3 === columnIndex),
	);
	return (
		<section
			className="upgrade-testimonials"
			aria-label={t("communityReviews", "Community reviews")}
		>
			<div
				className="testimonial-wall"
				role="region"
				aria-label={t("testimonials", "Community testimonials")}
			>
				{columns.map((column, index) => (
					<div
						className="testimonial-column"
						key={column[0].url}
						tabIndex={0}
						role="region"
						aria-label={t("testimonialColumn", "Testimonial column {{count}}", {
							count: new Intl.NumberFormat(locale).format(index + 1),
						})}
					>
						<div className="testimonial-track">
							{(index % 2 === 0 ? [true, false] : [false, true]).map((duplicate) => (
								<div
									key={String(duplicate)}
									className={`testimonial-group${duplicate ? " testimonial-duplicates" : ""}`}
									aria-hidden={duplicate || undefined}
								>
									{column.map((item) => (
										<TestimonialCard key={item.url} item={item} />
									))}
								</div>
							))}
						</div>
					</div>
				))}
			</div>
		</section>
	);
}
