// node:test suite (outside vitest, which only collects packages/**): node --test scripts/release-notes.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractSection, renderNotes } from './release-notes.mjs';

// CRLF on purpose: the changelogs are checked out with Windows line endings on some machines
const CHANGELOG = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '## [1.6.1] - 2026-10-21',
  '',
  '### Fixed',
  '- A fix.',
  '',
  '## [1.6.0] - 2026-10-20',
  '',
  '### Added',
  '- A feature.',
  '',
  '[Unreleased]: https://example.com/compare/v1.6.1...HEAD',
  '[1.6.1]: https://example.com/compare/v1.6.0...v1.6.1',
  '',
].join('\r\n');

test('extracts a section up to the next release heading, with LF endings', () => {
  assert.equal(extractSection(CHANGELOG, '1.6.1'), '### Fixed\n- A fix.');
});

test('the last section stops before the link reference definitions', () => {
  assert.equal(extractSection(CHANGELOG, '1.6.0'), '### Added\n- A feature.');
});

test('missing, prefix-only and empty sections return null', () => {
  assert.equal(extractSection(CHANGELOG, '9.9.9'), null);
  assert.equal(extractSection(CHANGELOG, '1.6'), null);
  assert.equal(extractSection(CHANGELOG, 'Unreleased'), null);
});

test('renders English first and folds the Spanish notes in <details>', () => {
  assert.equal(
    renderNotes('### Fixed\n- A fix.', '### Corregido\n- Un arreglo.'),
    '### Fixed\n- A fix.\n\n<details><summary>Español</summary>\n\n### Corregido\n- Un arreglo.\n\n</details>\n'
  );
  assert.equal(renderNotes('### Fixed\n- A fix.', null), '### Fixed\n- A fix.\n');
});
