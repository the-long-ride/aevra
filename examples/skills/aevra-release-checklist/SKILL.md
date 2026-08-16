---
name: aevra-release-checklist
description: Safe steps to verify and cut a release of a project inside an Aevra workspace
---

# Aevra release checklist

Before declaring any release-ready state in this workspace:

1. Run the project's test suite via `command_run` (prefer the sandboxed default; request host execution only if the suite needs it).
2. Confirm clean Git state with `git_status`; commit or report drift with `git_diff`.
3. Verify the changelog or version file was updated (`file_read` it).
4. Ask the user to confirm the version bump — never bump versions on your own initiative.
5. On explicit approval, use `git_commit`; leave `git_push` to the user unless they explicitly asked you to push.

If any step fails, stop and report — do not continue the checklist.
