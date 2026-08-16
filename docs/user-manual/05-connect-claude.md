# Connect Claude

Use the same canonical remote endpoint:

```text
https://<your-hostname>/mcp
```

Prefer OAuth when the client supports MCP OAuth discovery. Aevra will require local approval before issuing access.

For clients that support a fixed HTTP Bearer credential but not OAuth, create an Aevra connector and send its token in the `Authorization: Bearer <token>` header. New setups should not embed connector secrets in URLs.
