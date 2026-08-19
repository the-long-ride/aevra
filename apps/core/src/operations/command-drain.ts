export async function drainActiveCommands(
  pending: Promise<unknown>[],
  timeoutMs: number,
) {
  if (!pending.length) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(pending),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Object.assign(new Error('Workspace switch drain timeout'), {
                code: 'WORKSPACE_SWITCH_TIMEOUT',
              }),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
