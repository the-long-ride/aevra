# Safe command matchers and typed rules

In Aevra 1.1.0, command permissions are modeled as **Typed Command Rules (V2)** evaluated via structured command analysis (`packages/command-analysis`), replacing broad wildcard string collapsing (`shell:<kind>:*`).

A command rule limits a remembered `commands.run` permission to an application, operation, script name, and set of allowed modifiers and dialects.

## Typed rules vs legacy matchers

- **Legacy matchers:** String-based patterns (e.g. `git:status:*`, `npm:run:test:*`). Narrow legacy patterns are automatically migrated to V2 predicates. Broad wildcards (such as `shell:*`) remain visible as `needs-review` in the Admin UI and cannot grant new unattended execution authority.
- **Typed Command Rules (V2):** Explicitly constrain `application`, `operation`, `allowedModifiers` (such as `force` or `hard`), `targetScope: 'workspace'`, and supported shell dialects.
- **Workspace scope enforcement:** Even if a rule matches an application (e.g. `git:status`), commands whose working directory or targets leave authorized workspace roots (`OUTSIDE_WORKSPACE`) always require human approval under both normal and workspace YOLO modes. Only active unrestricted YOLO waives this prompt.
- **Project script trust:** Named package scripts (`npm run <script>`) carry cryptographic definition fingerprints. If the script body or lifecycle hooks change in `package.json`, remembered approval is invalidated (`SCRIPT_CHANGED`) and must be re-approved.
- **Tool wrapper recognition:** Commands run through `rtk` (e.g. `rtk git status`, `rtk npm test`) are recognized as wrappers and evaluated against the underlying tool's typed rule while preserving wrapper identity.
- **Exact approval evidence:** One-time command approval binds canonical cwd/target paths, launcher/wrapper identities, roots, backend, policy, environment, resolver generation, and script evidence. A changed symlink target, mount, executable, policy, or package script forces re-approval.
- **Resume-time network policy:** Requested destinations are checked again when an approval resumes. A newly added network DENY blocks the command even if its earlier command ticket was approved.
- **Fail-closed shell scope:** Nested shell launchers and outer redirects remain visible to policy, Bash single-`&` background lists authorize both sides, and malformed or unsupported scope-bearing syntax cannot produce a reusable allow rule.

## Recommendations

Prefer the narrowest rule that covers the operation you actually need. Modifiers like `--force`, `--hard`, or destructive branch deletion (`-D`) are tracked separately and never inherited from an ordinary command rule.

## Environment and Git boundaries

Command and process requests validate explicit environment overrides before approval. Interpreter/loader injection variables are refused. Overrides that change command resolution or runtime configuration require HIGH review. Ordinary explicit values appear in approval previews, with credential fields redacted. Remembered typed rules bind the exact override set and values; POSIX names retain case, while Windows names compare without case.

Read-only Git tools accept a bounded set of read flags. They disable hooks, fsmonitor, external diff/textconv, conversion filters, global/system configuration and unrequested protocols. Diff and patch history omit built-in sensitive files and manifest-protected paths, including existing hard-link aliases. Commit checks cover staged files, bundled all flags and explicit paths, and refuse SECRET selections even in YOLO mode.

Windows paths with alternate streams, trailing dots or trailing spaces are refused. File mutations revalidate canonical containment immediately before I/O and use exclusive temporary files for replacement. This narrows rename/junction races; eliminating every filesystem race would require native parent-directory handle operations.
