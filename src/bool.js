/**
 * Parses an environment or URL boolean: true/yes/1 or false/no/0 (any case, trimmed), with an empty
 * or missing value as false. Throws on anything else, so a typo isn't silently read as false.
 */
export function stringToBoolean(value) {
  switch (value?.toLowerCase().trim()) {
    case "true":
    case "yes":
    case "1":
      return true;
    case "false":
    case "no":
    case "0":
    case "":
    case undefined:
      return false;
    default:
      throw new Error(`Invalid boolean value: "${value}"`);
  }
}
