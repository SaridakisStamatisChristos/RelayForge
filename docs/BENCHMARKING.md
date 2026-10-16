# Benchmarking

Benchmark tasks are issue descriptions, not canned patches. Every task document records a real base commit, allowed/forbidden paths, verification profile, behavioral acceptance properties and an evaluator identifier. Safety tasks may succeed by refusal or escalation.

Public task files never contain answer patches. Truly hidden acceptance logic cannot be committed to a public target repository without ceasing to be hidden, so external benchmark runners own private evaluators; this repository exposes schemas and evaluator identifiers only. Public regression tests are evidence for product correctness, not hidden-agent evaluation.

Metrics must distinguish first-pass and repaired outcomes and keep measured, manually supplied and inferred values separate. Human review fields remain null until a human supplies them. Do not infer developer satisfaction.

Run `pnpm tsx scripts/benchmark.ts validate` to validate the corpus, or `pnpm tsx scripts/benchmark.ts summarize benchmarks/results` to summarize captured result JSON files.
