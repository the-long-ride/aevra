# Connect Claude

Use the same canonical remote endpoint:

```text
https://<your-hostname>/mcp
```

Prefer OAuth when the client supports MCP OAuth discovery. Aevra will require local approval before issuing access.

For clients that support a fixed HTTP Bearer credential but not OAuth, create an Aevra connector and send its token in the `Authorization: Bearer <token>` header. New setups should not embed connector secrets in URLs.

## Dynamic Cloud VMs & Egress IP Continuity

When connecting web or cloud Claude instances, requests may originate from changing cloud VM IP addresses.

- **Zero re-admission:** Requests presenting valid OAuth credentials maintain connection authority and active workspace leases across IP shifts.
- **Independent rate limiting:** Connection traffic is rate-limited per connection bucket rather than by shared client IP, preventing rate limit collisions across shared provider egress pools.
- **Durable multi-workspace access:** Workspaces granted to the Claude connection remain preserved across runner transitions.
