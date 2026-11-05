import { emailTheme } from "./theme.generated.mjs";

const { light, dark, button, fontFamily } = emailTheme;
const buttonLineHeight = 24;
const buttonPadding = (button.height - buttonLineHeight) / 2;

const assets = "https://kgmqmaivltdolfzjrjjs.supabase.co/storage/v1/object/public/email-assets";

export function escapeHtml(value) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function buildEmailHtml(item) {
	const content = item.code
		? `<p class="email-text email-code" dir="ltr" style="margin:0; color:${light.foreground}; font-family:${fontFamily}; font-size:42px; line-height:56px; font-weight:600; letter-spacing:8px; white-space:nowrap;">{{ .Token }}</p>`
		: item.action
			? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td align="center" bgcolor="${light.accent}" style="border-radius:${button.radius}px; background-color:${light.accent}; mso-padding-alt:${buttonPadding}px ${button.paddingInline}px;"><a class="email-action" href="${escapeHtml(item.actionUrl ?? "{{ .ConfirmationURL }}")}" style="display:inline-block; border-radius:${button.radius}px; background-color:${light.accent}; padding:${buttonPadding}px ${button.paddingInline}px; color:${light["accent-foreground"]}; font-size:${button.fontSize}px; line-height:${buttonLineHeight}px; font-weight:${button.fontWeight}; text-align:center; text-decoration:none;">${escapeHtml(item.action)}</a></td></tr></table>`
			: "";
	const footer =
		item.footer ??
		(item.category === "Security"
			? "This is a security notification for your Recordly account."
			: item.id === "reauth"
				? "If you didn't request this code, contact support."
				: item.id === "invite"
					? "Not expecting an invitation? You can safely ignore this email."
					: "Didn't request this? You can safely ignore this email.");
	const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(item.subject)}</title>
  <style>
    @font-face { font-family:'DM Sans'; src:url('${assets}/DMSans-Variable.ttf') format('truetype'); font-weight:100 1000; font-style:normal; font-display:swap; }
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    table { border-collapse:collapse; }
    .email-banner-dark { display:none; max-height:0; overflow:hidden; mso-hide:all; }
    @media (max-width:560px) {
      .email-heading { font-size:28px !important; line-height:36px !important; }
      .email-content { padding-left:24px !important; padding-right:24px !important; }
      .email-code { font-size:38px !important; letter-spacing:6px !important; }
    }
    @media (prefers-color-scheme:dark) {
      .email-background { background-color:${dark.surface} !important; }
      .email-text { color:${dark.foreground} !important; }
      .email-muted { color:${dark.muted} !important; }
      .email-link { color:${dark.link} !important; }
      .email-banner-light { display:none !important; max-height:0 !important; overflow:hidden !important; }
      .email-banner-dark { display:block !important; max-height:none !important; overflow:visible !important; }
    }
  </style>
  <!--[if mso]><style>body,table,td,h1,p,a { font-family:Arial,sans-serif !important; }</style><![endif]-->
</head>
<body class="email-background" style="margin:0; padding:0; width:100%; background-color:${light.surface}; color:${light.foreground}; font-family:${fontFamily};">
  <div aria-hidden="true" style="display:none; max-height:0; max-width:0; overflow:hidden; opacity:0; font-size:1px; line-height:1px; mso-hide:all;">${escapeHtml(item.preheader ?? item.subject)}</div>
  <table role="presentation" class="email-background" width="100%" cellpadding="0" cellspacing="0" style="width:100%; background-color:${light.surface};">
    <tr><td style="padding:0; font-size:0; line-height:0;">
      <img class="email-banner-light" src="${assets}/banner-light-v1.jpg" width="600" height="180" alt="" style="display:block; border:0; width:100%; height:auto; margin:0;">
      <!--[if !mso]><!--><img class="email-banner-dark" src="${assets}/banner-dark-v1.jpg" width="600" height="180" alt="" style="display:none; border:0; width:100%; height:auto; max-height:0; overflow:hidden; margin:0;"><!--<![endif]-->
    </td></tr>
    <tr><td class="email-content" align="center" style="padding:0 32px;">
      <!--[if mso]><table role="presentation" width="560"><tr><td align="center"><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%; max-width:560px; margin:0 auto;">
        <tr><td align="center" style="padding:0;">
          <h1 class="email-heading email-text" aria-label="${escapeHtml(item.heading)} Recordly" style="margin:0 0 16px; color:${light.foreground}; font-size:33px; line-height:40px; font-weight:500; letter-spacing:-1.1px;">${escapeHtml(item.heading)} <span class="email-title-brand" style="display:inline-block; white-space:nowrap;"><img src="${assets}/recordly-mark-v1.png" width="35" height="35" alt="" style="display:inline-block; width:1.05em; height:1.05em; margin:0 7px 0 0; border:0; vertical-align:-0.15em;">Recordly</span></h1>
          <p class="email-intro email-muted" style="margin:0; color:${light.muted}; font-size:15px; line-height:24px; overflow-wrap:anywhere;">${escapeHtml(item.message)}</p>
        </td></tr>
        ${item.facts?.length ? `<tr><td style="padding:24px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;">${item.facts.map(([label, value]) => `<tr><td class="email-muted" style="padding:5px 12px 5px 0; color:${light.muted}; font-size:14px; line-height:22px; vertical-align:top;">${escapeHtml(label)}</td><td class="email-text" align="right" style="padding:5px 0; color:${light.foreground}; font-size:14px; line-height:22px; overflow-wrap:anywhere;">${escapeHtml(value)}</td></tr>`).join("")}</table></td></tr>\n        ` : ""}${content ? `<tr><td align="center" style="padding:28px 0 0;">${content}</td></tr>` : ""}
        ${item.detail ? `<tr><td align="center" style="padding:20px 0 0;"><p class="email-muted" style="margin:0; color:${light.muted}; font-size:14px; line-height:23px;">${escapeHtml(item.detail)}</p></td></tr>` : ""}
        <tr><td align="center" style="padding:44px 0 32px;">
          <p class="email-muted" style="margin:0 0 10px; color:${light.muted}; font-size:12px; line-height:20px;">${escapeHtml(footer)}</p>
          <p style="margin:0; font-size:12px; line-height:20px;"><a class="email-link" href="mailto:support@recordly.dev" style="color:${light.link}; text-decoration:underline;">Contact support</a><span class="email-muted" style="color:${light.muted};"> &nbsp;·&nbsp; </span><a class="email-link" href="https://videos.recordly.dev/privacy" style="color:${light.link}; text-decoration:underline;">Privacy</a></p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>
`;
	// Apply the app font at text/table boundaries as well as body: some email
	// clients replace inherited table typography. Inline styles survive stripped CSS.
	return html
		.replace(
			/<(table|td|h1|p|a)\b([^>]*?)style="([^"]*)"/g,
			(_match, tag, attributes, style) =>
				`<${tag}${attributes}style="${style.includes("font-family:") ? style : `font-family:${fontFamily}; ${style}`}"`,
		)
		.replace(/[ \t]+$/gm, "");
}

export function buildEmailText(item) {
	const footer =
		item.footer ??
		(item.category === "Security"
			? "This is a security notification for your Recordly account."
			: item.id === "reauth"
				? "If you didn't request this code, contact support."
				: item.id === "invite"
					? "Not expecting an invitation? You can safely ignore this email."
					: "Didn't request this? You can safely ignore this email.");
	return (
		[
			`${item.heading} Recordly`,
			item.message,
			item.facts?.map(([label, value]) => `${label}: ${value}`).join("\n"),
			item.code ? "{{ .Token }}" : "",
			item.action ? `${item.action}: ${item.actionUrl ?? "{{ .ConfirmationURL }}"}` : "",
			item.detail,
			footer,
			"Contact support: support@recordly.dev\nPrivacy: https://videos.recordly.dev/privacy",
		]
			.filter(Boolean)
			.join("\n\n") + "\n"
	);
}
