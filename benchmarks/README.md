# RelayForge benchmark corpus

The task corpus is intentionally issue-only. `baseCommit` is pinned to a real commit and `evaluatorRef` names held-out/private acceptance logic; the public agent-visible task material does not contain answer patches or hidden evaluator code.

The seeded RF-001 through RF-015 contracts have `provenance: "simulated"`. They are benchmark templates and safety cases, not evidence that an autonomous coding campaign has been executed. A task may be labeled `historical` only when its base revision, issue provenance, evaluator, execution evidence, and outcome are preserved.

`benchmarks/results` is ignored except for `.gitkeep`, so measured campaign outputs can be attached deliberately without pretending unexecuted runs occurred. Human review, completion time, token count, and API cost remain null/absent unless they are actually observed or supplied.

Run `pnpm benchmark:validate` to validate the public task contracts. Run `pnpm tsx scripts/benchmark.ts summarize <results-directory>` to summarize a real result set using the metrics defined in `schema/result.schema.json`.
