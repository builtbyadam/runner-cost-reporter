<div align="center">

# 💸 runner-cost-reporter

**Know where your Actions minutes go. A per-workflow breakdown over a rolling window, posted as an issue.**

<br>

[![Marketplace](https://img.shields.io/badge/Marketplace-runner--cost--reporter-2088FF?logo=githubactions&logoColor=white)](https://github.com/marketplace/actions/runner-cost-reporter)
[![CI](https://github.com/builtbyadam/actions/actions/workflows/test-runner-cost-reporter.yml/badge.svg)](https://github.com/builtbyadam/actions/actions/workflows/test-runner-cost-reporter.yml)
[![Release](https://img.shields.io/github/v/release/builtbyadam/runner-cost-reporter?sort=semver)](https://github.com/builtbyadam/runner-cost-reporter/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/builtbyadam/runner-cost-reporter?style=social)](https://github.com/builtbyadam/runner-cost-reporter/stargazers)

</div>

> 🪞 **This is a generated mirror** of [`builtbyadam/actions`](https://github.com/builtbyadam/actions). Issues and PRs are welcome there.

---

## The problem

CI minutes add up and nobody can say which workflow is the culprit. Without a breakdown, optimization is guesswork — and wiring up an external billing API is overkill for a quick in-repo trend.

## What it does

Totals runner minutes per workflow (or per actor) over a rolling window and, on a weekly schedule, upserts a single summary issue — so the cost is visible where the team already looks.

## Usage

Designed to run weekly on a schedule and keep one rolling report issue up to date:

```yaml
on:
  schedule:
    - cron: "0 8 * * 1" # every Monday at 08:00 UTC
  workflow_dispatch: {}

jobs:
  report:
    runs-on: ubuntu-latest
    permissions:
      actions: read
      issues: write # required because create-issue defaults to true
    steps:
      - id: usage
        uses: builtbyadam/runner-cost-reporter@v1
        with:
          window-days: "7"
          group-by: workflow
          create-issue: "true"
      - run: |
          echo "Total minutes: ${{ steps.usage.outputs.total-minutes }}"
          echo "Issue: ${{ steps.usage.outputs.issue-url }}"
```

Read-only mode (compute and expose outputs, never touch issues):

```yaml
      - uses: builtbyadam/runner-cost-reporter@v1
        with:
          create-issue: "false"
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `window-days` | | `7` | How many days back to include, counting from now. Positive integer. |
| `create-issue` | | `true` | Whether to upsert a summary issue (`true`/`false`). When `true`, requires `issues: write`. |
| `issue-title` | | `Runner usage report — last {window} days` | Title for the summary issue. `{window}` is replaced with `window-days`. |
| `group-by` | | `workflow` | Group minutes by `workflow` (workflow name) or `actor` (triggering user login). |
| `github-token` | | `${{ github.token }}` | Token used to list workflow runs and upsert the issue. Needs `actions: read`, plus `issues: write` when `create-issue` is `true`. |

## Outputs

| Output | Description |
|---|---|
| `total-minutes` | Total runner-minutes across all groups, rounded, as an integer string. Wall-clock approximation — see Safety. |
| `report` | JSON array of `{key, runs, minutes}` objects, sorted by minutes descending. |
| `issue-url` | HTML URL of the created/updated issue, or `""` when no issue was written. |

## How it works

1. It computes a window start as *now − `window-days`* and lists every workflow run via `actions.listWorkflowRunsForRepo` with `created: >=YYYY-MM-DD`, paginating so repos with many runs are handled.
2. For each run it measures wall-clock duration as `run_started_at` → `updated_at`, clamped to `>= 0`. Runs with no `run_started_at` are skipped.
3. Durations are summed and counted per group (`workflow` name or `actor` login), sorted by minutes descending, and emitted as `report` and `total-minutes`, plus a one-line log summary.
4. When `create-issue` is `true`, it looks for an open issue labelled `runner-cost-report` whose body contains the hidden marker `<!-- runner-cost-reporter -->`. If found it **updates** that issue; otherwise it creates the label (tolerating "already exists") and opens a new one — making the action **idempotent per window** rather than opening duplicates. A missing `github-token` is a safe no-op.

## Safety

> **Honest accounting.** The minutes here are wall-clock `run_started_at` → `updated_at` per run. This **approximates but does not equal** GitHub's *billable* minutes. GitHub bills per job (not per run), rounds each job up to the whole minute, multiplies by an OS-specific factor (e.g. 2× for Windows, 10× for macOS relative to Linux), and ignores queue time. A run with three parallel jobs counts as one wall-clock interval here but three billed intervals on your invoice. Use these numbers as a **relative trend**, not a billing reconciliation. The same caveat is printed in the issue footer.

- `actions: read` lets the action list workflow runs; `issues: write` is additionally required only when `create-issue` is `true`.
- The action never deletes or closes issues — it only upserts the single report issue it owns (matched by label + marker).

## Limitations

- Wall-clock approximation only — see Safety. Not a billing API.
- Parallel and matrix jobs within a run collapse into a single wall-clock interval, so multi-job workflows are *under*-counted relative to billing.
- The `created: >=date` filter has day granularity; runs from the boundary day are included in full.
- Grouping by `workflow` uses the workflow **name** — renaming a workflow starts a new group.

## License

[MIT](LICENSE)
