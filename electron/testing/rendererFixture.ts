import path from "node:path";
import { pathToFileURL } from "node:url";

export const testAppPath = path.resolve("recordly-test-app");
export const testAppDocument = pathToFileURL(path.join(testAppPath, "dist", "index.html")).href;
