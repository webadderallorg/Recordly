import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEmailHtml, buildEmailText } from "../services/email/render-email.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let total = 0;
for (const directory of ["services/supabase/templates", "services/email/billing"]) {
	const folder = path.join(root, directory);
	const catalog = JSON.parse(fs.readFileSync(path.join(folder, "catalog.json"), "utf8"));
	for (const item of catalog) {
		fs.writeFileSync(path.join(folder, item.file), buildEmailHtml(item));
		fs.writeFileSync(
			path.join(folder, item.file.replace(/\.html$/, ".txt")),
			buildEmailText(item),
		);
		total++;
	}
}
console.log(`Built ${total} Recordly email templates (HTML and plain text).`);
