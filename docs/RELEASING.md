# Releasing Aevra

**Audience:** maintainers · **Time:** ~2 minutes

1. **Update the version** in exactly two synced places — `package.json` and `apps/core/src/version.ts`. The `version-consistency` test fails the build if they drift; `serverInfo.version` reads the constant.
2. **Bump the docs stamp** — `docs/README.md` says "Verified against" a version; update it.
3. **Add a CHANGELOG entry** under a new `[x.y.z] — date` heading (Keep-a-Changelog format; see [`../CHANGELOG.md`](../CHANGELOG.md)).
4. **Run the full battery** — it is the release gate: `npm run format:check && npm run lint && npm test && npm run typecheck && npm run build`.
5. **Tag** — `git tag -vx.y.z` on the release commit. If a tag must move before push: `git tag -f vx.y.z HEAD`, and only force-push a moved tag on explicit instruction.
6. **Publish** — `npm publish` (the `prepublishOnly` script re-runs format/lint/tests/typecheck/build first). CI additionally does `npm pack --dry-run` on every push.
7. **Document upgrade impact** — put breaking changes or required upgrade steps in the CHANGELOG and add a dedicated manual page only when users need one.

Rules: never ship credentials or bearer tokens in artifacts; keep `files` in `package.json` minimal (`dist`, `installers`, `README.md`, `CHANGELOG.md`, `.env.example`).
