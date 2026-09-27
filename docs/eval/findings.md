# Findings (§8.3)

One row per finding, for review-type runs (V0r, V2, V5).

| date | task | variant | agent | finding (short) | location | severity given | label | seeded? |
|---|---|---|---|---|---|---|---|---|
| 2026-09-26 | R01 | V0r | pi (baseline, no reviewer agent) | Command._callParseArg swallows non-invalidArgument errors from custom parseArg (removed rethrow) | lib/command.js:608 | CRITICAL | TRUE | yes |
