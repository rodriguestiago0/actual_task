import { log } from "../log.js";

/** Options without the defaults Actual sometimes stores: {} and { splitIndex: 0 }. */
function setOptions(options = {}) {
  const { splitIndex, ...rest } = options;
  const set = splitIndex ? { splitIndex, ...rest } : rest;
  return Object.keys(set).length > 0 ? set : null;
}

const canonical = ({ field, op, value, type, options }) =>
  JSON.stringify([field, op, value, type, setOptions(options)]);

const actionsKey = (rule) => rule.actions.map(canonical).sort().join("\n");

const lower = (value) => (typeof value === "string" ? value.toLowerCase() : value);

// The condition that varies between rules merged on several conditions, by preference.
const VARYING_FIELDS = ["payee", "description", "imported_payee", "account", "category"];

/**
 * For a rule whose conditions must all match: one "is"/"is one of" condition that can vary between
 * merged rules, with every other condition (the context) the same, e.g. "payee is A and amount
 * < 0". Returns { field, type, exact, contains: [], context, index } or null.
 */
function contextMatcher({ conditions }) {
  for (const field of VARYING_FIELDS) {
    const onField = conditions.filter((c) => c.field === field);
    if (onField.length !== 1) continue;
    const [{ op, value, type, options }] = onField;
    const values = op === "oneOf" ? value : [value];
    if (!["is", "oneOf"].includes(op) || setOptions(options) || !Array.isArray(values)) continue;
    if (values.length === 0 || values.some((v) => v == null || v === "")) continue;
    const index = conditions.indexOf(onField[0]);
    const context = conditions.filter((_, i) => i !== index);
    return { field, type, exact: values, contains: [], context, index };
  }
  return null;
}

/**
 * What a rule matches, when it can be folded into another rule: one field compared with "is",
 * "is one of" or (for text) "contains", any of which may match, or one varying condition in a rule
 * whose other conditions must all match too. Returns { field, type, exact, contains, context }
 * or null.
 */
function matcher(rule) {
  const { conditions, conditionsOp } = rule;
  if (conditions.length === 0) return null;
  if (conditions.length > 1 && conditionsOp !== "or") return contextMatcher(rule);
  const [{ field, type }] = conditions;
  const exact = [];
  const contains = [];
  for (const { field: f, type: t, op, value, options } of conditions) {
    if (f !== field || t !== type || setOptions(options)) return null;
    const values = op === "oneOf" ? value : [value];
    if (!Array.isArray(values) || values.length === 0) return null;
    if (values.some((v) => v == null || v === "")) return null;
    if (op === "is" || op === "oneOf") exact.push(...values);
    else if (op === "contains" && type === "string") contains.push(value);
    else return null;
  }
  return { field, type, exact, contains, context: [] };
}

/** The conditions matching any of the given values, using "or" when "contains" is needed. */
function mergedConditions(rule, { field, type, context, index }, exact, contains) {
  if (context.length > 0) {
    const condition =
      exact.length === 1
        ? { ...rule.conditions[index], op: "is", value: exact[0] }
        : { ...rule.conditions[index], op: "oneOf", value: exact };
    return {
      conditionsOp: "and",
      conditions: rule.conditions.map((c, i) => (i === index ? condition : c)),
    };
  }
  const conditions = [
    ...(exact.length === 1 ? [{ field, op: "is", value: exact[0], type }] : []),
    ...(exact.length > 1 ? [{ field, op: "oneOf", value: exact, type }] : []),
    ...contains.map((value) => ({ field, op: "contains", value, type })),
  ];
  return { conditionsOp: conditions.length > 1 ? "or" : "and", conditions };
}

/**
 * Plans rule clean-ups:
 * - rules that only compare one field with "is", "is one of" or "contains" and have the same
 *   actions are merged into one rule, e.g. "payee is A → Coffee" and "payee is B → Coffee" become
 *   "payee is one of A, B → Coffee", and "imported payee contains X → payee P" and "imported
 *   payee is Y → payee P" become "imported payee is Y or contains X → payee P";
 * - rules whose conditions must all match are merged the same way when they differ only in one
 *   "is"/"is one of" condition (payee first), e.g. "payee is A and amount < 0 → Loan" and "payee
 *   is B and amount < 0 → Loan" become "payee is one of A, B and amount < 0 → Loan";
 * - other rules that are exact duplicates are deleted, keeping one.
 *
 * Merging changes the order Actual applies rules in, so rules that can match the same text with
 * different actions are reported as conflicts and left alone: the same value (e.g. "payee is A →
 * Coffee" and "payee is A → Restaurant"), or a "contains" value found in another rule's value
 * (e.g. "contains Continente → Continente" and "is Continente Bom Dia → Bom Dia").
 */
export function planRuleMerges(rules) {
  const candidates = rules
    .map((rule) => ({ rule, match: matcher(rule) }))
    .filter(({ match }) => match);
  const scopeKey = ({ rule, match }) =>
    JSON.stringify([
      rule.stage ?? null,
      match.field,
      match.type,
      match.context.map(canonical).sort(),
    ]);

  const conflicts = [];
  for (const scope of Map.groupBy(candidates, scopeKey).values()) {
    const exact = scope.flatMap((c) => c.match.exact.map((value) => ({ c, value: lower(value) })));
    const contains = scope.flatMap((c) =>
      c.match.contains.map((value) => ({ c, value: lower(value) })),
    );
    const clash = (a, b) => actionsKey(a.c.rule) !== actionsKey(b.c.rule);

    for (const entries of Map.groupBy(exact, ({ value }) => value).values()) {
      if (entries.some((entry) => clash(entry, entries[0]))) {
        conflicts.push({ value: entries[0].value, rules: entries.map(({ c }) => c.rule) });
      }
    }
    for (const needle of contains) {
      for (const other of [...exact, ...contains]) {
        // equal "contains" values are found from both sides; report them once
        const reported = other.value === needle.value && other.c.rule.id < needle.c.rule.id;
        if (clash(needle, other) && other.value.includes(needle.value) && !reported) {
          conflicts.push({ value: needle.value, rules: [needle.c.rule, other.c.rule] });
        }
      }
    }
  }
  const conflicted = new Set(conflicts.flatMap(({ rules }) => rules.map((rule) => rule.id)));
  for (const conflict of conflicts) conflict.rules = [...new Set(conflict.rules)];

  const merges = [];
  const sameActions = Map.groupBy(
    candidates.filter(({ rule }) => !conflicted.has(rule.id)),
    (candidate) => `${scopeKey(candidate)}\n${actionsKey(candidate.rule)}`,
  );
  for (const group of sameActions.values()) {
    if (group.length < 2) continue;
    const [target, ...rest] = group.toSorted((a, b) => a.rule.id.localeCompare(b.rule.id));
    // first spelling wins, as Actual compares text case-insensitively
    const unique = (values) => [...Map.groupBy(values, lower).values()].map(([first]) => first);
    const exact = unique(group.flatMap(({ match }) => match.exact));
    const contains = unique(group.flatMap(({ match }) => match.contains));
    merges.push({
      rule: { ...target.rule, ...mergedConditions(target.rule, target.match, exact, contains) },
      removeIds: rest.map(({ rule }) => rule.id),
    });
  }

  const folded = new Set(candidates.map(({ rule }) => rule.id));
  const duplicates = Map.groupBy(
    rules.filter((rule) => !folded.has(rule.id)),
    (rule) =>
      JSON.stringify([
        rule.stage ?? null,
        rule.conditionsOp,
        rule.conditions.map(canonical).sort(),
        actionsKey(rule),
      ]),
  );
  for (const group of duplicates.values()) {
    if (group.length < 2) continue;
    const [target, ...rest] = group.toSorted((a, b) => a.id.localeCompare(b.id));
    merges.push({ rule: target, removeIds: rest.map((rule) => rule.id) });
  }

  return { merges, conflicts };
}

/** Describes rule parts with payee, category and account names instead of IDs. */
async function describer(api) {
  const names = new Map(
    [...(await api.getPayees()), ...(await api.getCategories()), ...(await api.getAccounts())].map(
      ({ id, name }) => [id, name],
    ),
  );
  const name = (value) =>
    Array.isArray(value) ? value.map(name).join(", ") : (names.get(value) ?? JSON.stringify(value));
  const describe = (parts, joiner) =>
    parts.map(({ field, op, value }) => `${field} ${op} ${name(value)}`).join(` ${joiner} `);
  return (rule) =>
    `if ${describe(rule.conditions, rule.conditionsOp)} then ${describe(rule.actions, "and")}`;
}

export async function mergeRules(api) {
  const { merges, conflicts } = planRuleMerges(await api.getRules());
  const describe = await describer(api);

  for (const { value, rules } of conflicts) {
    log.warn(
      `Not merging ${rules.length} rules that can match ${JSON.stringify(value)} with different actions:\n` +
        rules.map((rule) => `  ${describe(rule)}`).join("\n"),
    );
  }

  for (const { rule, removeIds } of merges) {
    log.info(`Merge ${removeIds.length + 1} rules into: ${describe(rule)}`);
    await api.updateRule(rule);
    for (const id of removeIds) await api.deleteRule(id);
  }

  const removed = merges.reduce((count, { removeIds }) => count + removeIds.length, 0);
  log.info(`Removed ${removed} rules`);
}
