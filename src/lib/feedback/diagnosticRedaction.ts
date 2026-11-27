// Scan each dot-separated token segment once. Retrying the JWT regex after
// every hyphen in an invalid token otherwise repeatedly scans the same suffix.
function redactTokens(value: string): string {
	const segments = Array.from(value.matchAll(/[\w-]+/g), (match) => ({
		start: match.index,
		end: match.index + match[0].length,
	}));
	const output: string[] = [];
	let copied = 0;
	for (let i = 0; i + 2 < segments.length; i++) {
		const first = segments[i];
		const second = segments[i + 1];
		const third = segments[i + 2];
		if (
			second.start !== first.end + 1 ||
			value[first.end] !== "." ||
			third.start !== second.end + 1 ||
			value[second.end] !== "."
		)
			continue;
		let start = first.start;
		for (; start + 3 < first.end; start++) {
			if (
				(start === first.start || value[start - 1] === "-") &&
				value.startsWith("eyJ", start)
			)
				break;
		}
		if (start + 3 >= first.end) continue;
		// The original trailing word boundary excludes final hyphens.
		let end = third.end;
		while (end > third.start && value[end - 1] === "-") end--;
		if (end === third.start) continue;
		output.push(value.slice(copied, start), "[token]");
		copied = end;
		i += 2;
	}
	output.push(value.slice(copied));
	return output.join("");
}

export function redactDiagnostic(value: string): string {
	return redactTokens(value.replace(/\b(Bearer|Basic)\s+[^\s"']+/gi, "$1 [redacted]"))
		.replace(/recordly(?:-dev)?:\/\/[^\s"']+/gi, "[auth callback]")
		.replace(
			/((?:code[_-]?verifier|code[_-]?challenge|authorization[_-]?code|captcha(?:[_-]?response)?|otp|token|password|secret|authorization|api[_-]?key)["']?\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?(?:"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)|[^\s,}]+)/gi,
			"$1[redacted]",
		)
		.replace(/(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
		.replace(
			/(?:file:\/\/[^\s"']*|(?:\/Users\/|\/home\/|\/Volumes\/|\/private\/|\/tmp\/|\/var\/|\/run\/media\/|\/media\/|\/mnt\/|[A-Z]:[\\/]|\\\\)[^\r\n"']+)/gi,
			"[local path]",
		)
		.replace(/https?:\/\/[^\s"']+/g, "[url]")
		.replace(/(^|[\s"'(=])\/(?![/\s])[^"\r\n')]+/gm, "$1[local path]")
		.slice(0, 2000);
}

/** Keep structured export entries parseable through persistence and report collection. */
export function redactDiagnosticLogEntry(line: string): string {
	const match = line.match(/^(\d\S+ info: \[export\] ([a-z-]+) )(\{.*\})$/);
	if (!match) return redactDiagnostic(line);
	const [, prefix, event, json] = match;
	try {
		const fields: Record<string, unknown> = JSON.parse(json, (key, value: unknown) => {
			// Match suffixes like the plain-text redactor, including access_token and authToken.
			return /(?:code[_-]?verifier|code[_-]?challenge|authorization[_-]?code|captcha(?:[_-]?response)?|otp|token|password|secret|authorization|api[_-]?key)$/i.test(
				key,
			)
				? "[redacted]"
				: typeof value === "string"
					? redactDiagnostic(value)
					: value;
		});
		let entry = prefix + JSON.stringify(fields);
		if (event === "complete") {
			// Retain the outcome even if JSON escaping makes the optional details too large.
			for (const field of ["lastMediaFailure", "lastRecovery", "source", "reason"]) {
				if (entry.length <= 1928) return entry;
				delete fields[field];
				entry = prefix + JSON.stringify(fields);
			}
			if (entry.length > 1928) {
				const attempt =
					typeof fields.attempt === "string" ? fields.attempt.slice(0, 16) : undefined;
				const outcome =
					typeof fields.outcome === "string" ? fields.outcome.slice(0, 16) : undefined;
				return prefix + JSON.stringify({ attempt, outcome });
			}
		}
		return entry.slice(0, 1928);
	} catch {
		return redactDiagnostic(line);
	}
}
