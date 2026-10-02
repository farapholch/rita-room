import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateNotes } from "@semantic-release/release-notes-generator";

const config = JSON.parse(await readFile(".releaserc.json", "utf8"));
const [, pluginConfig] = config.plugins.find(
  (plugin) =>
    Array.isArray(plugin) &&
    plugin[0] === "@semantic-release/release-notes-generator",
);

// Exercise the actual configured preset and writer without publishing anything.
const notes = await generateNotes(pluginConfig, {
  cwd: process.cwd(),
  options: { repositoryUrl: "https://github.com/farapholch/rita-room.git" },
  commits: [
    { hash: "a".repeat(40), message: "fix: restore room isolation" },
    { hash: "b".repeat(40), message: "feat: add collaboration feature" },
    { hash: "c".repeat(40), message: "chore: update internal tooling" },
  ],
  lastRelease: { version: "1.7.1", gitTag: "v1.7.1" },
  nextRelease: { version: "1.8.0", gitTag: "v1.8.0" },
});

assert.match(notes, /Bug Fixes/);
assert.match(notes, /restore room isolation/);
assert.match(notes, /Features/);
assert.match(notes, /add collaboration feature/);
assert.match(notes, /compare\/v1\.7\.1\.\.\.v1\.8\.0/);
assert.doesNotMatch(notes, /update internal tooling/);
console.log(
  "✓ Configured release notes render with fixes, features, and compare links",
);
