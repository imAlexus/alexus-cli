import type { EventSink } from "./events.js";
export const jsonlWriter =
  (stream: NodeJS.WritableStream = process.stdout): EventSink =>
  (value) => {
    stream.write(`${JSON.stringify(value)}\n`);
  };
