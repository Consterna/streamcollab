// Builds the GitHub Release body for one version from the bilingual changelogs:
// the English section of CHANGELOG.md, then the Spanish one of CHANGELOG.es.md folded in <details>.
//
//   node scripts/release-notes.mjs 1.6.1 > notes.md
//
// Exits 1 when CHANGELOG.md has no entries for the version; a missing Spanish entry only warns.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(import.meta.dirname);
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Body of the `## [version] - date` section without its heading, or null when absent or empty. */
export function extractSection(changelog, version) {
  const lines = changelog.replace(/\r\n?/g, '\n').split('\n');
  const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\]`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;

  // The section ends at the next release heading or at the link reference definitions
  const end = lines.findIndex((line, i) => i > start && (/^## /.test(line) || /^\[[^\]]+\]:\s/.test(line)));
  const body = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
  return body || null;
}

export function renderNotes(english, spanish) {
  let notes = `${english}\n`;
  // Blank lines around the Spanish body so GitHub renders it as Markdown inside <details>
  if (spanish) notes += `\n<details><summary>Español</summary>\n\n${spanish}\n\n</details>\n`;
  return notes;
}

function readChangelog(name) {
  try {
    return readFileSync(path.join(ROOT, name), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function main(args) {
  const version = args[0]?.replace(/^v/, '');
  if (!version || !VERSION.test(version)) {
    process.stderr.write('Usage: node scripts/release-notes.mjs <version>   (e.g. 1.6.1 or v1.6.1)\n');
    return 2;
  }

  const enText = readChangelog('CHANGELOG.md');
  const english = enText === null ? null : extractSection(enText, version);
  if (!english) {
    const reason =
      enText === null ? 'CHANGELOG.md not found' : `CHANGELOG.md has no "## [${version}]" section with entries`;
    process.stderr.write(`error: ${reason}; add it before releasing v${version}.\n`);
    return 1;
  }

  const esText = readChangelog('CHANGELOG.es.md');
  const spanish = esText === null ? null : extractSection(esText, version);
  if (!spanish) {
    const reason = esText === null ? 'CHANGELOG.es.md not found' : `CHANGELOG.es.md has no "## [${version}]" section`;
    process.stderr.write(`warning: ${reason}; the notes will be in English only.\n`);
  }

  process.stdout.write(renderNotes(english, spanish));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
