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

Clients that open a new MCP session per call (observed with distributed agents) can only resume a **workspace access** approval granted for the whole connection. For such a client's workspace request, choose "Allow this connection" so later workers on the same OAuth connection can use the workspace without an `APPROVAL_SCOPE_MISMATCH` error. Other approvals do not need a wider scope: a one-time approval can be resumed by any session on the same OAuth connection.

YOLO has two independent settings in Settings. **Risk** is `Prevent high risk` (default: CRITICAL work and the file transfer tools still ask) or `Do whatever` (confirmed in a dialog, shown with a red badge). With scope `Unrestricted`, nothing asks. With scope `Workspace`, commands outside the workspace or of unknown scope still ask, and file transfer tools run without asking. **Scope** is `Workspace` or `Unrestricted` (only allows folders outside the workspace). Secret-path blocking and DLP apply in every combination.

When YOLO is enabled for a connector session, command authorization follows the configured YOLO policy. **Workspace** mode auto-allows non-critical commands only when structured analysis proves they stay inside the selected workspace. **Unrestricted** mode auto-allows non-critical commands regardless of workspace scope; with host execution this can affect the whole device, while sandbox execution remains isolated by its backend. Remembered command/network DENY rules do not preempt an active in-scope YOLO command, but they still apply to commands outside the workspace or of unknown scope. CRITICAL commands always require a fresh local confirmation and cannot be persistently auto-allowed, unless YOLO risk is `Do whatever`.

OAuth pairing approvals are separate from tool-operation approvals. Pairing allows a client to authenticate; it does not bypass workspace permissions.

## Exact one-time authority

A one-time capability approval resumes only its frozen tool, arguments, capability, matcher and risk. Another concurrent request cannot borrow that authority. Resuming from another session of the same authorized OAuth connection remains supported, and CRITICAL actions retain their explicit approval requirement.

Mount `sensitivityPolicyId` is reserved metadata and does not select an enforced policy. The workspace UI hides it. Use enforced protected-path patterns and capability restrictions to control access; built-in SECRET classifications remain a minimum.
