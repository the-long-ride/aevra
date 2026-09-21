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

When YOLO is enabled for a connector session, command authorization follows the configured YOLO policy. **Workspace** mode auto-allows non-critical commands only when structured analysis proves they stay inside the selected workspace. **Unrestricted** mode auto-allows non-critical commands regardless of workspace scope; with host execution this can affect the whole device, while sandbox execution remains isolated by its backend. Remembered command/network DENY rules do not preempt an active in-scope YOLO command. CRITICAL commands always require a fresh local confirmation and cannot be persistently auto-allowed.

OAuth pairing approvals are separate from tool-operation approvals. Pairing allows a client to authenticate; it does not bypass workspace permissions.
