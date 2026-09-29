#!/usr/bin/env node

const shardArgument = process.argv[2] ?? "";
const shardMatch = /^(\d+)\/(\d+)$/.exec(shardArgument);
if (!shardMatch) {
  console.error("Usage: assign-e2e-files-to-shards.mjs <index/count>");
  process.exit(2);
}

const shardIndex = Number(shardMatch[1]);
const shardCount = Number(shardMatch[2]);
if (
  !Number.isSafeInteger(shardIndex) ||
  !Number.isSafeInteger(shardCount) ||
  shardCount < 1 ||
  shardIndex < 1 ||
  shardIndex > shardCount
) {
  console.error(`Invalid shard ${shardArgument}`);
  process.exit(2);
}

const files = new Map();
for (const line of await readStdin()) {
  const match = /^\s+\[[^\]]+\]\s+›\s+(.+?\.spec\.ts):\d+:\d+\s+›\s+/.exec(line);
  if (!match) continue;
  const file = match[1];
  files.set(file, (files.get(file) ?? 0) + 1);
}
if (files.size === 0) {
  console.error("Playwright --list output contained no E2E spec files.");
  process.exit(1);
}

const shards = Array.from({ length: shardCount }, () => ({ files: [], tests: 0 }));
const weightedFiles = [...files.entries()].sort(
  ([fileA, testsA], [fileB, testsB]) => testsB - testsA || fileA.localeCompare(fileB)
);

for (const [file, tests] of weightedFiles) {
  let targetIndex = 0;
  for (let index = 1; index < shards.length; index += 1) {
    const candidate = shards[index];
    const target = shards[targetIndex];
    if (
      candidate.tests < target.tests ||
      (candidate.tests === target.tests && candidate.files.length < target.files.length)
    ) {
      targetIndex = index;
    }
  }
  shards[targetIndex].files.push(file);
  shards[targetIndex].tests += tests;
}

const selected = shards[shardIndex - 1];
for (const file of selected.files.sort()) console.log(file);
console.error(
  `Shard ${shardArgument}: ${selected.files.length} files, ${selected.tests} tests ` +
    `(from ${files.size} files, ${[...files.values()].reduce((sum, count) => sum + count, 0)} tests)`
);

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input.split(/\r?\n/);
}
