# Safe command matchers

A command matcher limits a remembered `commands.run` permission to an Aevra command family such as `git:status` or `dotnet:test`.

The platform tabs in this Guide show a conservative set of useful matcher examples. They are recommendations, **not a security guarantee**. Test runners, build systems, package managers, MSBuild targets, Cargo build scripts, and project scripts can execute code from the workspace even when the top-level command family looks familiar.

Prefer the narrowest matcher that covers the operation you actually need. Avoid `*` unless you intentionally want broad command access.

Aevra does not recommend remembering a broad shell family as a safe matcher. A shell can execute arbitrary script text, so shell operations should remain explicit and narrowly approved.

## How to use the list

Open the Windows, Linux, or macOS tab, copy the matcher you need, then paste one matcher per line into Permissions → Add rules → Command matchers.

Non-command capabilities such as `files.read` and `files.write` use their own capability-wide rule and do not inherit these command matchers.
