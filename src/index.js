const core = require("@actions/core");
const github = require("@actions/github");
const {
  MARKER,
  parseInputs,
  computeWindowStart,
  aggregate,
  totalMinutes,
  renderTitle,
  renderIssueBody,
  renderSummary,
} = require("./usage");

const REPORT_LABEL = "runner-cost-report";

/** Emit safe no-op outputs (used when no token is available). */
function setNoopOutputs() {
  core.setOutput("total-minutes", "0");
  core.setOutput("report", "[]");
  core.setOutput("issue-url", "");
}

/** Fetch all workflow runs created on or after `sinceDate` (YYYY-MM-DD), paginated. */
async function listRuns(octokit, repo, sinceDate) {
  return octokit.paginate(octokit.rest.actions.listWorkflowRunsForRepo, {
    ...repo,
    created: `>=${sinceDate}`,
    per_page: 100,
  });
}

/**
 * Upsert the report issue: find an open issue labelled REPORT_LABEL whose body
 * contains the marker and update it; otherwise create one (creating the label
 * first, tolerating "already exists").
 * @returns {string} the issue's html_url.
 */
async function upsertIssue(octokit, repo, title, body) {
  const open = await octokit.paginate(octokit.rest.issues.listForRepo, {
    ...repo,
    state: "open",
    labels: REPORT_LABEL,
    per_page: 100,
  });
  // Ignore pull requests (they appear in the issues list).
  const existing = open.find((i) => !i.pull_request && (i.body || "").includes(MARKER));

  if (existing) {
    const res = await octokit.rest.issues.update({
      ...repo,
      issue_number: existing.number,
      title,
      body,
    });
    core.info(`Updated existing report issue #${existing.number}.`);
    return res.data.html_url;
  }

  // Ensure the label exists before creating the issue.
  try {
    await octokit.rest.issues.createLabel({
      ...repo,
      name: REPORT_LABEL,
      color: "0e8a16",
      description: "Automated runner-cost-reporter usage report",
    });
  } catch (e) {
    if (e.status !== 422) throw e; // 422 => label already exists, fine.
  }

  const res = await octokit.rest.issues.create({
    ...repo,
    title,
    body,
    labels: [REPORT_LABEL],
  });
  core.info(`Created report issue #${res.data.number}.`);
  return res.data.html_url;
}

async function run() {
  try {
    const inputs = parseInputs({
      windowDays: core.getInput("window-days"),
      createIssue: core.getInput("create-issue"),
      issueTitle: core.getInput("issue-title"),
      groupBy: core.getInput("group-by"),
    });

    const token = core.getInput("github-token");
    if (!token) {
      core.warning(
        "No github-token provided; cannot query the GitHub API. Emitting no-op outputs."
      );
      setNoopOutputs();
      return;
    }

    const octokit = github.getOctokit(token);
    const repo = github.context.repo;

    const nowIso = new Date().toISOString();
    const sinceIso = computeWindowStart(nowIso, inputs.windowDays);
    const sinceDate = sinceIso.slice(0, 10); // YYYY-MM-DD for the `created` filter.

    core.info(`Collecting workflow runs for ${repo.owner}/${repo.repo} since ${sinceDate}…`);
    const runs = await listRuns(octokit, repo, sinceDate);
    core.info(`Fetched ${runs.length} workflow run(s).`);

    const rows = aggregate(runs, inputs.groupBy);
    const total = Math.round(totalMinutes(rows));

    const report = rows.map((r) => ({ key: r.key, runs: r.runs, minutes: Math.round(r.minutes) }));
    core.setOutput("report", JSON.stringify(report));
    core.setOutput("total-minutes", String(total));

    const summary = renderSummary(rows, inputs.windowDays, inputs.groupBy);
    core.info(summary);

    let issueUrl = "";
    if (inputs.createIssue) {
      const title = renderTitle(inputs.issueTitle, inputs.windowDays);
      const body = renderIssueBody(rows, {
        windowDays: inputs.windowDays,
        groupBy: inputs.groupBy,
        since: sinceDate,
        until: nowIso.slice(0, 10),
        totalRuns: runs.length,
      });
      issueUrl = await upsertIssue(octokit, repo, title, body);
    } else {
      core.info("create-issue is false; skipping issue upsert.");
    }
    core.setOutput("issue-url", issueUrl);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
