// Pure logic for runner-cost-reporter. No @actions imports here so it can be
// unit-tested directly (see test/usage.test.js).

const MARKER = "<!-- runner-cost-reporter -->";

/**
 * Parse and validate the action inputs.
 * @param {object} raw  Raw string inputs: {windowDays, createIssue, issueTitle, groupBy}.
 * @returns {{windowDays: number, createIssue: boolean, issueTitle: string, groupBy: string}}
 */
function parseInputs(raw) {
  const windowDays = Number(raw.windowDays);
  if (!Number.isInteger(windowDays) || windowDays <= 0) {
    throw new Error(`Input "window-days" must be a positive integer, got "${raw.windowDays}".`);
  }

  const createIssueStr = String(raw.createIssue).trim().toLowerCase();
  if (createIssueStr !== "true" && createIssueStr !== "false") {
    throw new Error(`Input "create-issue" must be "true" or "false", got "${raw.createIssue}".`);
  }
  const createIssue = createIssueStr === "true";

  const groupBy = String(raw.groupBy).trim();
  if (groupBy !== "workflow" && groupBy !== "actor") {
    throw new Error(`Input "group-by" must be "workflow" or "actor", got "${raw.groupBy}".`);
  }

  const issueTitle = String(raw.issueTitle);

  return { windowDays, createIssue, issueTitle, groupBy };
}

/**
 * Compute the ISO start of the window: `now` minus `windowDays` days.
 * @param {string} nowIso     ISO timestamp for "now".
 * @param {number} windowDays Positive integer days.
 * @returns {string} ISO timestamp of the window start.
 */
function computeWindowStart(nowIso, windowDays) {
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) {
    throw new Error(`computeWindowStart: invalid timestamp "${nowIso}".`);
  }
  const start = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  return start.toISOString();
}

/**
 * Wall-clock duration of a workflow run in minutes (run_started_at -> updated_at).
 * Clamped to >= 0. Returns null when run_started_at is missing (caller skips it).
 * @param {object} run  A workflow run object.
 * @returns {number|null}
 */
function runDurationMinutes(run) {
  if (!run || !run.run_started_at) return null;
  const start = new Date(run.run_started_at).getTime();
  const end = new Date(run.updated_at).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const minutes = (end - start) / 60000;
  return minutes > 0 ? minutes : 0;
}

/**
 * Aggregate runs into groups, summing minutes and counting runs.
 * Runs missing run_started_at are skipped.
 * @param {object[]} runs    Workflow run objects.
 * @param {string} groupBy   "workflow" (run.name) or "actor" (run.actor.login).
 * @returns {{key: string, runs: number, minutes: number}[]} sorted by minutes desc.
 */
function aggregate(runs, groupBy) {
  const groups = new Map();
  for (const run of runs) {
    const minutes = runDurationMinutes(run);
    if (minutes === null) continue;

    let key;
    if (groupBy === "actor") {
      key = (run.actor && run.actor.login) || "(unknown)";
    } else {
      key = run.name || "(unnamed workflow)";
    }

    const existing = groups.get(key) || { key, runs: 0, minutes: 0 };
    existing.runs += 1;
    existing.minutes += minutes;
    groups.set(key, existing);
  }

  return Array.from(groups.values()).sort((a, b) => b.minutes - a.minutes);
}

/** Total minutes across all aggregate rows. */
function totalMinutes(aggregate) {
  return aggregate.reduce((sum, row) => sum + row.minutes, 0);
}

/**
 * Replace the {window} token in a title template.
 * @param {string} template
 * @param {number} windowDays
 */
function renderTitle(template, windowDays) {
  return template.replace(/\{window\}/g, String(windowDays));
}

/**
 * Render the issue body as markdown: a table of groups, a total line, an
 * honesty footer about wall-clock approximation, and the hidden marker.
 * @param {{key, runs, minutes}[]} aggregate
 * @param {{windowDays, groupBy, since, until, totalRuns}} meta
 * @returns {string}
 */
function renderIssueBody(aggregate, meta) {
  const groupLabel = meta.groupBy === "actor" ? "Actor" : "Workflow";
  const total = Math.round(totalMinutes(aggregate));
  const lines = [];

  lines.push(
    `Total ${total} runner-minutes across ${aggregate.length} ` +
      `${meta.groupBy === "actor" ? "actors" : "workflows"} in the last ${meta.windowDays} days.`
  );
  lines.push("");
  lines.push(`| ${groupLabel} | Runs | Minutes |`);
  lines.push("|---|---:|---:|");
  for (const row of aggregate) {
    lines.push(`| ${row.key} | ${row.runs} | ${Math.round(row.minutes)} |`);
  }
  lines.push("");
  lines.push(`Window: ${meta.since} → ${meta.until} (${meta.windowDays} days).`);
  lines.push("");
  lines.push(
    "> Minutes are wall-clock `run_started_at` → `updated_at` per run. This " +
      "approximates but does **not** equal GitHub's billable minutes: billing " +
      "rounds each job up to the minute, multiplies by an OS-specific factor " +
      "(2x macOS-equivalent windows, 10x macOS), and excludes queue time. Treat " +
      "these figures as a relative trend, not an invoice."
  );
  lines.push("");
  lines.push(MARKER);

  return lines.join("\n");
}

/** Human-readable one-line summary for logs / the action summary. */
function renderSummary(aggregate, windowDays, groupBy) {
  const total = Math.round(totalMinutes(aggregate));
  const noun = groupBy === "actor" ? "actors" : "workflows";
  return `Total ${total} runner-minutes across ${aggregate.length} ${noun} in the last ${windowDays} days.`;
}

module.exports = {
  MARKER,
  parseInputs,
  computeWindowStart,
  runDurationMinutes,
  aggregate,
  totalMinutes,
  renderTitle,
  renderIssueBody,
  renderSummary,
};
