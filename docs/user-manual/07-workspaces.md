# Workspaces

Workspaces define the local filesystem roots Aevra may expose.

Open **Workspaces** in the local dashboard and choose **Register workspace**. Provide a name and the local root path. Registration, removal, and external mount changes are local-admin operations only.

A remote session has one active workspace at a time. Switching workspaces revokes the old workspace lease after operations drain according to policy.

External mounts use logical paths so remote clients do not need the host filesystem path.
