# Permissions and approvals

Aevra evaluates requested operations against workspace policy, capability profiles, risk, and remembered permissions.

The **Permissions** page uses switch controls for every binary capability. Skill and instruction access has four dedicated capabilities:

- `skills.read`
- `skills.write`
- `instructions.read`
- `instructions.write`

These are independent from `files.read` and `files.write`. For example, granting `files.write` does not allow an AI client to rewrite a skill or `AGENTS.md`.

When local approval is required, open **Approvals**. Review the actor, workspace, operation, and risk before choosing Allow or Deny. Skill and instruction writes follow the same approval/resume flow as other protected mutations.

Approval scopes can be one-time, session, workspace, or global where policy permits. Critical operations do not receive persistent always-allow rules.

OAuth pairing approvals are separate from tool-operation approvals. Pairing allows a client to authenticate; it does not bypass workspace permissions.
