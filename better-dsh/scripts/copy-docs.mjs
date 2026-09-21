/**
 * Build-time copy of repo docs into the package (`files: ["docs"]`).
 * Ships the public doc tree only — internal research, scratch notes, and
 * bulky probe-evidence dumps stay out of the npm tarball; boot-token
 * literals in test reports are redacted in the copy (repo files untouched).
 *
 * Standing rule (.gitignore): docs/60_exploration-and-research is
 * "internal exploration & research (never publish)". superd/ and
 * dsh-sys-prompt_*.md are untracked internal notes that must not ship;
 * *_artifacts/ directories are local probe evidence (2.8MB), not docs.
 */
import { cpSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

/** Path fragments excluded from the shipped copy (matched against source path). */
const EXCLUDE = [
  /(^|\/)60_exploration-and-research($|\/)/,
  /(^|\/)superd($|\/)/,
  /(^|\/)dsh-sys-prompt_[^/]*\.md$/,
  /(^|\/)[^/]*_artifacts($|\/)/,
];

rmSync('docs', { recursive: true, force: true });
cpSync('../docs', 'docs', {
  recursive: true,
  filter: (src) => !EXCLUDE.some((re) => re.test(src)),
});

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
  );

let redacted = 0;
for (const file of walk('docs').filter((f) => f.endsWith('.md'))) {
  const text = readFileSync(file, 'utf8');
  const clean = text.replace(/token=[A-Za-z0-9_-]{20,}/g, 'token=<redacted>');
  if (clean !== text) {
    writeFileSync(file, clean);
    redacted += 1;
  }
}
console.log(`copy-docs: shipped doc tree ready (${redacted} file(s) token-redacted)`);
