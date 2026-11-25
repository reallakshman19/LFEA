# Retired AA3 delivery guards

`lfea-001`…`lfea-006-source-guard.mjs` and `w10.11-pipe-solver-source-guard.mjs`
were one-shot change guards for the
original AA3 pull requests that introduced LFEA-001…006. Each one diffs a
pinned AA3 base commit against `HEAD` and allows only that PR's paths and
CI workflow.

Those base commits are not in this repository's history, and the per-PR
certification workflows were not carried over, so these guards can never
pass here. They are kept unmodified as provenance only. They are not
runnable from this folder, and nothing invokes them.

The numerical, contract, failure and determinism checks for LFEA-001…006
remain active in `scripts/` (`lfea-00N-check.mjs` and their parts).
