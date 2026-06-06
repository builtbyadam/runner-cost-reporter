const { test, describe } = require("node:test");
const assert = require("node:assert");
const {
  MARKER,
  parseInputs,
  computeWindowStart,
  runDurationMinutes,
  aggregate,
  totalMinutes,
  renderTitle,
  renderIssueBody,
  renderSummary,
} = require("../src/usage");

describe("parseInputs", () => {
  const base = {
    windowDays: "7",
    createIssue: "true",
    issueTitle: "Runner usage report — last {window} days",
    groupBy: "workflow",
  };

  test("parses valid inputs", () => {
    const out = parseInputs(base);
    assert.deepStrictEqual(out, {
      windowDays: 7,
      createIssue: true,
      issueTitle: "Runner usage report — last {window} days",
      groupBy: "workflow",
    });
  });

  test('accepts create-issue "false" case-insensitively', () => {
    assert.strictEqual(parseInputs({ ...base, createIssue: "FALSE" }).createIssue, false);
  });

  test("rejects non-positive window-days", () => {
    assert.throws(() => parseInputs({ ...base, windowDays: "0" }), /positive integer/);
    assert.throws(() => parseInputs({ ...base, windowDays: "-3" }), /positive integer/);
  });

  test("rejects non-integer window-days", () => {
    assert.throws(() => parseInputs({ ...base, windowDays: "2.5" }), /positive integer/);
    assert.throws(() => parseInputs({ ...base, windowDays: "abc" }), /positive integer/);
  });

  test("rejects bad create-issue", () => {
    assert.throws(() => parseInputs({ ...base, createIssue: "yes" }), /must be "true" or "false"/);
  });

  test("rejects bad group-by", () => {
    assert.throws(() => parseInputs({ ...base, groupBy: "branch" }), /must be "workflow" or "actor"/);
  });
});

describe("computeWindowStart", () => {
  test("subtracts whole days", () => {
    assert.strictEqual(
      computeWindowStart("2026-06-08T00:00:00.000Z", 7),
      "2026-06-01T00:00:00.000Z"
    );
  });

  test("preserves time-of-day", () => {
    assert.strictEqual(
      computeWindowStart("2026-06-08T12:30:00.000Z", 1),
      "2026-06-07T12:30:00.000Z"
    );
  });

  test("rejects invalid timestamps", () => {
    assert.throws(() => computeWindowStart("not-a-date", 7), /invalid timestamp/);
  });
});

describe("runDurationMinutes", () => {
  test("computes wall-clock minutes", () => {
    const run = {
      run_started_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:05:00Z",
    };
    assert.strictEqual(runDurationMinutes(run), 5);
  });

  test("clamps negative durations to 0", () => {
    const run = {
      run_started_at: "2026-06-01T00:05:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    };
    assert.strictEqual(runDurationMinutes(run), 0);
  });

  test("returns null when run_started_at is missing", () => {
    assert.strictEqual(runDurationMinutes({ updated_at: "2026-06-01T00:05:00Z" }), null);
    assert.strictEqual(runDurationMinutes({ run_started_at: null }), null);
    assert.strictEqual(runDurationMinutes(null), null);
  });

  test("returns null when timestamps are unparseable", () => {
    assert.strictEqual(
      runDurationMinutes({ run_started_at: "x", updated_at: "y" }),
      null
    );
  });
});

describe("aggregate", () => {
  const runs = [
    {
      name: "CI",
      actor: { login: "alice" },
      run_started_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:10:00Z",
    },
    {
      name: "CI",
      actor: { login: "bob" },
      run_started_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:05:00Z",
    },
    {
      name: "Release",
      actor: { login: "alice" },
      run_started_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:20:00Z",
    },
    // skipped: no run_started_at
    { name: "Nightly", actor: { login: "alice" }, updated_at: "2026-06-01T00:30:00Z" },
  ];

  test("groups by workflow name, sorted by minutes desc", () => {
    const out = aggregate(runs, "workflow");
    assert.deepStrictEqual(out, [
      { key: "CI", runs: 2, minutes: 15 },
      { key: "Release", runs: 1, minutes: 20 },
    ].sort((a, b) => b.minutes - a.minutes));
    // explicit ordering check
    assert.deepStrictEqual(
      out.map((r) => r.key),
      ["Release", "CI"]
    );
  });

  test("groups by actor login", () => {
    const out = aggregate(runs, "actor");
    assert.deepStrictEqual(
      out.map((r) => r.key),
      ["alice", "bob"]
    );
    const alice = out.find((r) => r.key === "alice");
    assert.deepStrictEqual(alice, { key: "alice", runs: 2, minutes: 30 });
  });

  test("skips runs missing run_started_at (Nightly excluded)", () => {
    const out = aggregate(runs, "workflow");
    assert.ok(!out.some((r) => r.key === "Nightly"));
  });

  test("falls back to placeholders for missing keys", () => {
    const out = aggregate(
      [{ run_started_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:01:00Z" }],
      "workflow"
    );
    assert.strictEqual(out[0].key, "(unnamed workflow)");
    const byActor = aggregate(
      [{ run_started_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:01:00Z" }],
      "actor"
    );
    assert.strictEqual(byActor[0].key, "(unknown)");
  });
});

describe("totalMinutes", () => {
  test("sums aggregate minutes", () => {
    assert.strictEqual(
      totalMinutes([
        { key: "a", runs: 1, minutes: 10 },
        { key: "b", runs: 2, minutes: 5 },
      ]),
      15
    );
  });
});

describe("renderTitle", () => {
  test("substitutes {window}", () => {
    assert.strictEqual(
      renderTitle("Runner usage report — last {window} days", 7),
      "Runner usage report — last 7 days"
    );
  });

  test("substitutes every occurrence", () => {
    assert.strictEqual(renderTitle("{window}/{window}", 3), "3/3");
  });
});

describe("renderIssueBody", () => {
  const rows = [
    { key: "Release", runs: 1, minutes: 20 },
    { key: "CI", runs: 2, minutes: 15.4 },
  ];
  const meta = {
    windowDays: 7,
    groupBy: "workflow",
    since: "2026-06-01",
    until: "2026-06-08",
    totalRuns: 3,
  };

  test("contains the marker", () => {
    assert.ok(renderIssueBody(rows, meta).includes(MARKER));
  });

  test("contains a correct rounded total", () => {
    // 20 + 15.4 = 35.4 -> 35
    assert.ok(renderIssueBody(rows, meta).includes("Total 35 runner-minutes"));
  });

  test("renders a markdown table with each group", () => {
    const body = renderIssueBody(rows, meta);
    assert.ok(body.includes("| Workflow | Runs | Minutes |"));
    assert.ok(body.includes("| Release | 1 | 20 |"));
    assert.ok(body.includes("| CI | 2 | 15 |"));
  });

  test("includes the wall-clock honesty footer", () => {
    assert.match(renderIssueBody(rows, meta), /wall-clock/);
    assert.match(renderIssueBody(rows, meta), /billable minutes/);
  });

  test("uses the Actor header when grouping by actor", () => {
    assert.ok(renderIssueBody(rows, { ...meta, groupBy: "actor" }).includes("| Actor | Runs |"));
  });
});

describe("renderSummary", () => {
  test("produces the human one-liner", () => {
    const rows = [
      { key: "Release", runs: 1, minutes: 20 },
      { key: "CI", runs: 2, minutes: 392 },
    ];
    assert.strictEqual(
      renderSummary(rows, 7, "workflow"),
      "Total 412 runner-minutes across 2 workflows in the last 7 days."
    );
  });

  test("uses 'actors' when grouping by actor", () => {
    assert.match(renderSummary([{ key: "a", runs: 1, minutes: 1 }], 7, "actor"), /across 1 actors/);
  });
});
