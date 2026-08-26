# Current work: connection continuity

Status: complete; final verification passed.

Branch: `feat/connection-continuity`

PR: #13

## Completed

- Durable OAuth connection identity and refresh families.
- Replay-safe refresh rotation with family-wide revocation.
- Separate OAuth connection, MCP session, and workspace lease lifecycles.
- Fifteen-minute reconnect grace without extending expired authority.
- Restart recovery for connection state, YOLO, and remembered workspace grants.
- Admin connection projection and durable force-revoke action.
- Connection-scoped resumable operation inspection with no blind mutation replay.
- Admin dashboard continuity state and connection metadata.
- Configurable access-token, refresh-family, and reconnect-grace durations.
- Integration coverage for restart and revocation behavior.
- README, security manual, and environment example documentation.
- Offline connection state remains explicit after reconnect grace expires.

## Verification

GitHub Quality Gate run #80 passed all required jobs before this documentation-only completion update:

- Static and repository checks.
- Node coverage at the unchanged 85% gate.
- Web coverage at the unchanged 85% gate.
- Build and browser parity.
- Windows portability.

The final documentation-only head must retain the same green gate before PR readiness.

## Differences from the reference plan

- Persistence stays within the repository's existing `OAuthRepository` and `SessionRepository`
  boundaries rather than introducing every suggested store filename.
- Admin connection observability extends the existing dashboard connection surfaces instead of
  adding a separate top-level page.
- Resumable operations are inspection-only handles. Interrupted mutations remain explicitly
  non-replayable without a fresh operation and fresh authorization.
