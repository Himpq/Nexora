# Final regression verification

All six Node commands and the scoped lint command exited with code 0.

These Node results precede the final animated/static header-dot fix in Day.ets. The root agent owns the targeted post-fix verification. Before/after SHA-256 manifests are included; Day.ets was the only intervening source change.

| Test entry | Reported passed | Failed | Exit code |
| --- | ---: | ---: | ---: |
| test_reading_progress.cjs | 28 | 0 | 0 |
| test_uiux_fixes.cjs | 37 | 0 | 0 |
| test_soft_glow_state.cjs | 12 | 0 | 0 |
| test_soft_glow_conversation.cjs | 46 | 0 | 0 |
| test_glow_preferences.cjs | 18 | 0 | 0 |
| test_ambient_glow.cjs | 11 | 0 | 0 |

152 reported executions passed. This is not 152 independent tests: the 28 reading-progress baseline cases run in their own file and are imported by both UIUX fixes and soft-glow conversation tests. Comparing TAP subtest names found 96 distinct cases, 56 repeated executions, and no other duplicate names.

`devecocli check lint entry/src/main/ets --limit 1000` reported 0 errors, 19 warnings, 0 suggestions, and 9 files checked. No `--fix` was used. The validation-app copy was outside the lint scope. The only GlowSettings warning recommends using a builder instead of a separate component.

See each command's `.log` file, `validation-summary.json`, and `source-sha256-before.json` / `source-sha256-after.json` in this directory.

