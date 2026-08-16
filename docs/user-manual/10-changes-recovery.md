# Changes and recovery

Aevra records mutation intent and recovery data before execution. Mutating operations are not automatically replayed after a crash.

Open **Changes** to inspect recorded change sets and recovery state. Use the local dashboard to review or restore supported changes.

Conflicting file writes use expected hashes. Non-overlapping changes may merge automatically; overlapping edits are reported as conflicts rather than silently overwritten.
