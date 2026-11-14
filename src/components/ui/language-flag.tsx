import type { AppLocale } from "@/i18n/config";

const countries: Record<AppLocale, string> = {
	en: "GB",
	es: "ES",
	fr: "FR",
	de: "DE",
	it: "IT",
	nl: "NL",
	ko: "KR",
	ja: "JP",
	"pt-BR": "BR",
	"zh-CN": "CN",
	"zh-TW": "TW",
	tr: "TR",
};

function star(cx: number, cy: number, radius: number, rotation = -90) {
	return Array.from({ length: 10 }, (_, index) => {
		const angle = ((rotation + index * 36) * Math.PI) / 180;
		const r = index % 2 ? radius * 0.382 : radius;
		return `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`;
	}).join(" ");
}

/** Decorative, bundled flags keep the language names accessible on every platform. */
export function LanguageFlag({ locale }: { locale: AppLocale }) {
	return (
		<svg
			aria-hidden="true"
			focusable="false"
			data-country={countries[locale]}
			width="24"
			height="16"
			viewBox="0 0 24 16"
			className="shrink-0 overflow-hidden rounded-[2px] shadow-[0_0_0_1px_rgb(0_0_0/0.08)]"
		>
			<rect width="24" height="16" fill="white" />
			{locale === "en" && (
				<>
					<path fill="#012169" d="M0 0h24v16H0z" />
					<path stroke="white" strokeWidth="4" d="m0 0 24 16M24 0 0 16" />
					<path stroke="#c8102e" strokeWidth="1.5" d="m0 0 24 16M24 0 0 16" />
					<path stroke="white" strokeWidth="6" d="M12 0v16M0 8h24" />
					<path stroke="#c8102e" strokeWidth="3.5" d="M12 0v16M0 8h24" />
				</>
			)}
			{locale === "es" && (
				<>
					<path fill="#aa151b" d="M0 0h24v16H0z" />
					<path fill="#f1bf00" d="M0 4h24v8H0z" />
					<path fill="#aa151b" d="M5 6h3v3a1.5 1.5 0 0 1-3 0z" />
					<path fill="#f1bf00" d="M5.6 6.6h.6v1.1h-.6zm1.2 1.4h.6v1h-.6z" />
					<path stroke="#aa151b" strokeWidth=".5" d="M4 6v4m5-4v4M5 5.3h3" />
				</>
			)}
			{(locale === "fr" || locale === "it") && (
				<>
					<path fill={locale === "fr" ? "#002395" : "#009246"} d="M0 0h8v16H0z" />
					<path fill={locale === "fr" ? "#ed2939" : "#ce2b37"} d="M16 0h8v16h-8z" />
				</>
			)}
			{(locale === "de" || locale === "nl") && (
				<>
					<path fill={locale === "de" ? "#000" : "#ae1c28"} d="M0 0h24v5.333H0z" />
					<path fill={locale === "de" ? "#d00" : "#fff"} d="M0 5.333h24v5.334H0z" />
					<path fill={locale === "de" ? "#ffce00" : "#21468b"} d="M0 10.667h24V16H0z" />
				</>
			)}
			{locale === "ja" && <circle cx="12" cy="8" r="4.5" fill="#bc002d" />}
			{locale === "ko" && (
				<>
					<g transform="rotate(33.69 12 8)">
						<circle cx="12" cy="8" r="4" fill="#cd2e3a" />
						<path fill="#0047a0" d="M8 8a4 4 0 0 0 8 0 2 2 0 0 0-4 0 2 2 0 0 1-4 0" />
					</g>
					<g fill="none" stroke="#000" strokeWidth=".7">
						<path transform="rotate(-56 5 4)" d="M3.5 2.8h3m-3 1.2h3m-3 1.2h3" />
						<path
							transform="rotate(56 19 12)"
							d="M17.5 10.8h1.2m.6 0h1.2m-3 1.2h1.2m.6 0h1.2m-3 1.2h1.2m.6 0h1.2"
						/>
						<path
							transform="rotate(56 19 4)"
							d="M17.5 2.8h1.2m.6 0h1.2m-3 1.2h3m-3 1.2h1.2m.6 0h1.2"
						/>
						<path
							transform="rotate(-56 5 12)"
							d="M3.5 10.8h3m-3 1.2h1.2m.6 0h1.2m-3 1.2h3"
						/>
					</g>
				</>
			)}
			{locale === "pt-BR" && (
				<>
					<path fill="#009b3a" d="M0 0h24v16H0z" />
					<path fill="#fedf00" d="m12 2 10 6-10 6L2 8z" />
					<circle cx="12" cy="8" r="3.7" fill="#002776" />
					<path fill="none" stroke="white" strokeWidth="1" d="M8.4 7.2q4-.5 7 2.6" />
					<g fill="white">
						<circle cx="11" cy="9.5" r=".3" />
						<circle cx="13" cy="10" r=".3" />
						<circle cx="14" cy="7" r=".3" />
					</g>
				</>
			)}
			{locale === "zh-CN" && (
				<>
					<path fill="#de2910" d="M0 0h24v16H0z" />
					<g fill="#ffde00">
						<polygon points={star(4, 4, 2.4)} />
						{[
							[8, 1.6],
							[9.6, 3.2],
							[9.6, 5.6],
							[8, 7.2],
						].map(([x, y]) => (
							<polygon
								key={y}
								points={star(x, y, 0.8, (Math.atan2(4 - y, 4 - x) * 180) / Math.PI)}
							/>
						))}
					</g>
				</>
			)}
			{locale === "zh-TW" && (
				<>
					<path fill="#fe0000" d="M0 0h24v16H0z" />
					<path fill="#000095" d="M0 0h12v8H0z" />
					<g fill="white">
						{Array.from({ length: 12 }, (_, i) => (
							<path
								key={i}
								transform={`rotate(${i * 30} 6 4)`}
								d="m6 1 .6 1.8H5.4z"
							/>
						))}
						<circle cx="6" cy="4" r="1.4" stroke="#000095" strokeWidth=".3" />
					</g>
				</>
			)}
			{locale === "tr" && (
				<>
					<path fill="#e30a17" d="M0 0h24v16H0z" />
					<circle cx="9" cy="8" r="4.2" fill="white" />
					<circle cx="10.2" cy="8" r="3.36" fill="#e30a17" />
					<polygon points={star(13.6, 8, 1.4, 180)} fill="white" />
				</>
			)}
		</svg>
	);
}
