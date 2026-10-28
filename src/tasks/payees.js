import { log } from "../log.js";

/** New name for a payee, or null when unchanged. */
export function cleanPayeeName(name, regex) {
  const cleaned = name.replace(new RegExp(regex, "gis"), "").replace(/ {2,}/g, " ").trim();
  return cleaned !== name ? cleaned : null;
}

/** Groups non-transfer payees by name, returning only names with duplicates. */
export function findDuplicatePayees(payees) {
  const byName = Map.groupBy(
    payees.filter((payee) => payee.transfer_acct == null),
    (payee) => payee.name,
  );
  return [...byName]
    .filter(([, group]) => group.length > 1)
    .map(([name, group]) => ({ name, ids: group.map((payee) => payee.id) }));
}

export async function fixPayees(api, { regex }) {
  // Duplicates are found from the new names, so a dry run (where renames are skipped) lists them too.
  const payees = [];
  for (const payee of await api.getPayees()) {
    const name = cleanPayeeName(payee.name, regex);
    if (name) {
      log.info(`Rename payee "${payee.name}" to "${name}"`);
      await api.updatePayee(payee.id, { name });
    }
    payees.push(name ? { ...payee, name } : payee);
  }

  for (const { name, ids } of findDuplicatePayees(payees)) {
    log.info(`Merge payees "${name}"`, ids);
    const [target, ...rest] = ids;
    await api.mergePayees(target, rest);
  }
}
