/** Bound command length on Windows while retaining each test exactly once. */
export function testFileBatches(files, budget = 24_000) {
  const batches = [];
  let current = [],
    length = 0;
  for (const file of files) {
    const size = file.length + 3;
    if (size > budget) throw new Error('A test path exceeds the command-line budget');
    if (current.length && (length + size > budget || current.length >= 60)) {
      batches.push(current);
      current = [];
      length = 0;
    }
    current.push(file);
    length += size;
  }
  if (current.length) batches.push(current);
  return batches;
}
