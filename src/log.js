import { format } from "node:util";
import { stringToBoolean } from "./bool.js";

// Read on use: .env is loaded after this module is imported. Not an error when invalid, as other
// tools read DEBUG too (e.g. DEBUG=express:*).
function debugEnabled() {
  try {
    return stringToBoolean(process.env.DEBUG);
  } catch {
    return false;
  }
}

function write(stream, level, args) {
  stream.write(`${new Date().toISOString()} ${level} ${format(...args)}\n`);
}

export const log = {
  debug: (...args) => debugEnabled() && write(process.stdout, "DEBUG", args),
  info: (...args) => write(process.stdout, "INFO", args),
  warn: (...args) => write(process.stderr, "WARN", args),
  error: (...args) => write(process.stderr, "ERROR", args),
};

/** The Actual API logs heavily through console; keep that output only when DEBUG is set. */
export function silenceLibraryLogs() {
  if (debugEnabled()) return;
  console.log = console.info = console.debug = () => {};
}
