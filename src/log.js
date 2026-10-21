import { format } from "node:util";

const debugEnabled = Boolean(process.env.DEBUG);

function write(stream, level, args) {
  stream.write(`${new Date().toISOString()} ${level} ${format(...args)}\n`);
}

export const log = {
  debug: (...args) => debugEnabled && write(process.stdout, "DEBUG", args),
  info: (...args) => write(process.stdout, "INFO", args),
  warn: (...args) => write(process.stderr, "WARN", args),
  error: (...args) => write(process.stderr, "ERROR", args),
};

/** The Actual API logs heavily through console; keep that output only when DEBUG is set. */
export function silenceLibraryLogs() {
  if (debugEnabled) return;
  console.log = console.info = console.debug = () => {};
}
