# Aevra Software Specs

For engineers and AI agents. Each file answers one question in ≤ 2 minutes. Verified against `0.4.0`.

| #   | File                                               | Answers the question                                      |
| --- | -------------------------------------------------- | --------------------------------------------------------- |
| 01  | [system-overview](01-system-overview.md)           | What are the moving parts and the central invariant?      |
| 02  | [security-model](02-security-model.md)             | Who gets in, and what are they allowed to do?             |
| 03  | [mcp-protocol](03-mcp-protocol.md)                 | What does the MCP surface look like exactly?              |
| 04  | [connectors](04-connectors.md)                     | How do connector-token URLs work and how are they stored? |
| 05  | [skills-instructions](05-skills-instructions.md)   | How are skills and AGENTS.md served to the AI?            |
| 06  | [workspaces-execution](06-workspaces-execution.md) | How do files and commands actually execute?               |
| 07  | [state-migration](07-state-migration.md)           | What lives on disk and how does the Aevra schema evolve?  |
| 08  | [audit-recovery](08-audit-recovery.md)             | How are actions recorded and crashes recovered?           |
| 09  | [configuration](09-configuration.md)               | Every env var, port, CLI command in one table?            |

**Reading order:** top to bottom. **How-to counterparts:** [`../user-manual/`](../user-manual/README.md).

Start: [01-system-overview](01-system-overview.md) →
