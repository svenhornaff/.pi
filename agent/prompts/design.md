---
description: Evidence first, then architect, then Plannotator approval
argument-hint: "<change request>"
---
Design this change before implementing it: $ARGUMENTS

1. Investigate: read the files and tests that matter. Keep notes of paths and line ranges.
2. Call `architect` once, with the change as `question` and the relevant excerpts
   (paths, line ranges, short snippets, constraints) as `context`.
3. If the plan lists open questions you can answer by reading more code, do so and
   call `architect` once more at most. Otherwise ask me.
4. Write the plan to PLAN.md and open it in Plannotator. Do not edit other files until
   I approve.
5. If the plan says "Escalate: yes", show me the question and ask before calling `advisor`.
