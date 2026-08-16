# Processes

Managed processes belong to one workspace and can be inspected from **Processes**.

Use `process_start` for commands that may outlive a normal MCP tool request. It returns a process ID immediately. An AI client can then use `process_wait`, `process_status`, and `process_logs` in later calls instead of holding one HTTP connection open.

`process_wait` waits for at most 30 seconds per call. If the process is still running, the client can call it again. Terminal results expose the exit code, signal, finish time, and duration, so test/build success can be verified rather than inferred from the last log line.

A process may be configured to stop with Aevra or keep running. Detached keep-running processes persist a completion record when they exit. Kept processes are re-adopted only when identity can be verified; uncertain processes are marked detached and require local action.

Remote management is limited by the active workspace and permissions. The local dashboard remains the administrative recovery surface.
