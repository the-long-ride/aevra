# Changes and recovery

Aevra records mutation intent and recovery data before execution. Mutating operations are not automatically replayed after a crash.

Open **Changes** to inspect recorded change sets and recovery state. Use the local dashboard to review or restore supported changes.

Conflicting file writes use expected hashes. Non-overlapping changes may merge automatically; overlapping edits are reported as conflicts rather than silently overwritten.

## Configuration backup and restore

Open **Data** in the web navigation to export or restore your Aevra setup:

- **Download backup:** Exports workspaces, mounts, permissions, policies, hooks, upstreams, and profiles to a portable JSON file. Machine-local environment variables and device secrets are safely excluded.
- **Restore configuration:** Upload an existing backup file, review the itemized inventory preview, and restore your configuration.
