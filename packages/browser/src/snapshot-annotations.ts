import type { SnapshotElementLike } from './dom-snapshot.js';

const VISION_ANNOTATION_TIMEOUT_MS = 1_000;

export async function boundedSnapshotAnnotations(
  serialize: () => Promise<SnapshotElementLike>,
  isCancelled?: () => boolean,
): Promise<SnapshotElementLike | null> {
  if (isCancelled?.()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(serialize)
        .catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), VISION_ANNOTATION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
