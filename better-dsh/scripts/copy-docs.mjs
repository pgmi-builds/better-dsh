/**
 * Build-time copy of repo docs into the package (`files: ["docs"]`).
 * Ships the public doc tree only — internal research, scratch notes,
 * foreign doc mirrors, uncited third-party reference material, and
 * bulky probe-evidence dumps stay out of the npm tarball; boot-token
 * literals in test reports are redacted in the copy (repo files untouched).
 *
 * Standing rule (.gitignore): docs/60_exploration-and-research is
 * "internal exploration & research (never publish)". superd/ and
 * dsh-sys-prompt_*.md are untracked internal notes that must not ship;
 * *_artifacts/ directories are local probe evidence (2.8MB), not docs.
 *
 * docs-packaging-trim (docs/specs/docs-packaging-trim/spec.md, 档位 F):
 * hermes-dev-skill (别家框架文档镜像，抓取后从未蒸馏)、dsh-dev-skill 的
 * pi-and-omp 第三方资料与 src-scripts 抓取工具，一律不进发布副本。
 * repo 的 docs/ 树一字不动——本脚本 rmSync/cpSync 只作用于包内副本。
 */
import { cpSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Path fragments excluded from the shipped copy (matched against source path). */
export const EXCLUDE = [
  /(^|\/)60_exploration-and-research($|\/)/,
  /(^|\/)superd($|\/)/,
  /(^|\/)dsh-sys-prompt_[^/]*\.md$/,
  /(^|\/)[^/]*_artifacts($|\/)/,
  // docs-packaging-trim（docs/specs/docs-packaging-trim/spec.md，档位 F）：
  //   摘掉与 DSH / 本插件无关的材料。repo 的 docs/ 一字不动，只影响发布副本。
  /(^|\/)hermes-dev-skill($|\/)/, // 别家框架文档镜像；抓取阶段产物，无 SKILL.md
  /(^|\/)dsh-dev-skill\/pi-and-omp($|\/)/, // OMP/Pi 第三方资料；技能正文零引用
  /(^|\/)dsh-dev-skill\/src-scripts($|\/)/, // 抓取工具 + 3.5MB 构建清单
];

/** True when a repo-relative source path must NOT enter the published copy. */
export function excluded(srcPath) {
  return EXCLUDE.some((re) => re.test(srcPath));
}

// cpSync's filter receives ABSOLUTE source paths; normalise a leading
// "../" (and Windows "..\\") so both absolute and repo-relative forms match.
const relativeSrc = (src) => src.replace(/^\.\.\//, '').replace(/^\.\.\\/, '');

const invokedAsCli =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsCli) {
  rmSync('docs', { recursive: true, force: true });
  cpSync('../docs', 'docs', {
    recursive: true,
    filter: (src) => !excluded(relativeSrc(src)),
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
}
