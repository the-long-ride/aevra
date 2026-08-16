# Workspaces

Workspaces define the server-local filesystem roots Aevra may expose to authorized MCP sessions.

Open **Workspaces** in the authenticated Aevra Web UI and choose **Add workspace**. The modal shows the workspace name and server path together.

Enter an absolute path to browse its immediate child directories. Path browsing is performed by the Aevra host, not by the browser device. You can move through child directories or back to the parent while keeping the current path visible.

**Browse on server** opens a native folder chooser on the machine where Aevra is running. It does not open a folder chooser on a remote phone or browser computer. If the host has no supported graphical picker, the modal keeps the inline server-path browser available.

Aevra canonicalizes and validates the selected path again when the workspace is registered. Registration, removal, and external mount changes are Admin-only operations and are not exposed as MCP tools.

A remote session may hold access to multiple remembered workspaces, but workspace-scoped tool calls must resolve an authorized workspace explicitly when the session has more than one available root.

External mounts use logical paths so remote MCP clients do not receive host filesystem paths as part of the remote workspace view.
