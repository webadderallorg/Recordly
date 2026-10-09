import { EventEmitter } from "node:events";

export const recordingSignals = new EventEmitter<{ videoPath: [path: string, sender: unknown] }>();
