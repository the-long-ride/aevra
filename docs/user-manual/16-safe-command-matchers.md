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
