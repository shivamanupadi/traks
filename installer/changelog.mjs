#!/usr/bin/env node
/**
 * CHANGELOG.md is the single source of truth for platform release notes.
 * This module parses it (Keep a Changelog shape), promotes the Unreleased
 * section at release time, and renders one version's notes as markdown for
 * GitHub Releases. The parsed JSON is uploaded next to the release manifest
 * and read by traks.dev/update and traks.dev/changelog.
 *
 *   node installer/changelog.mjs --check   # validate and summarize
 *   node installer/changelog.mjs notes     # draft bullets from commits since the last tag
 *
 * File shape:
 *   ## Unreleased
 *   ## 0.1.38 - 2026-08-27
 *   ### Added | Changed | Fixed | Breaking
 *   - one bullet per line; `code` spans allowed, no other markdown
 *
 * Only platform (installable) changes belong here. traks.dev-only work never
 * reaches an instance, so it gets no entry.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');

const SECTIONS = ['added', 'changed', 'fixed', 'breaking'];
const VERSION_HEADING = /^## (\d+\.\d+\.\d+) - (\d{4}-\d{2}-\d{2})\s*$/;
const UNRELEASED_HEADING = /^## Unreleased\s*$/;
const SECTION_HEADING = /^### (Added|Changed|Fixed|Breaking)\s*$/;

const emptySections = () => Object.fromEntries(SECTIONS.map(s => [s, []]));

/**
 * Parse the markdown into { unreleased, entries } where entries are newest
 * first exactly as written. Throws on anything the renderer would not
 * understand, so a typo in a heading fails the release instead of silently
 * dropping notes.
 */
export function parse(markdown) {
  const lines = markdown.split('\n');
  let unreleased = null;
  const entries = [];
  let current = null;
  let section = null;

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    const where = `CHANGELOG.md:${i + 1}`;
    if (line === '') return;
    // Prose above the first version heading (title, intro) is free-form.
    if (!current && !line.startsWith('## ')) return;

    if (UNRELEASED_HEADING.test(line)) {
      if (unreleased) throw new Error(`${where}: duplicate Unreleased section`);
      if (entries.length)
        throw new Error(`${where}: Unreleased must come before released versions`);
      current = unreleased = { version: null, date: null, sections: emptySections() };
      section = null;
      return;
    }
    const v = line.match(VERSION_HEADING);
    if (v) {
      current = { version: v[1], date: v[2], sections: emptySections() };
      entries.push(current);
      section = null;
      return;
    }
    if (line.startsWith('## ')) {
      throw new Error(`${where}: bad version heading "${line}" (want "## X.Y.Z - YYYY-MM-DD")`);
    }
    const s = line.match(SECTION_HEADING);
    if (s) {
      if (!current) throw new Error(`${where}: section before any version heading`);
      section = s[1].toLowerCase();
      return;
    }
    if (line.startsWith('### ')) {
      throw new Error(
        `${where}: unknown section "${line}" (want Added, Changed, Fixed, or Breaking)`
      );
    }
    if (line.startsWith('- ')) {
      if (!current || !section) throw new Error(`${where}: bullet outside a section`);
      current.sections[section].push(line.slice(2).trim());
      return;
    }
    if (/^\s+\S/.test(raw) && current && section) {
      // Continuation of the previous bullet.
      const list = current.sections[section];
      if (!list.length) throw new Error(`${where}: continuation line without a bullet`);
      list[list.length - 1] += ` ${line.trim()}`;
      return;
    }
    throw new Error(`${where}: unexpected line "${line}"`);
  });

  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.version)) throw new Error(`duplicate version ${e.version}`);
    seen.add(e.version);
  }
  return { unreleased, entries };
}

export const bulletCount = entry =>
  SECTIONS.reduce((n, s) => n + (entry?.sections[s].length ?? 0), 0);

/** Rewrite "## Unreleased" as a released heading, leaving a fresh empty Unreleased above it. */
export function promoteUnreleased(markdown, version, date) {
  const lines = markdown.split('\n');
  const idx = lines.findIndex(l => UNRELEASED_HEADING.test(l));
  if (idx === -1) throw new Error('CHANGELOG.md has no "## Unreleased" section');
  lines.splice(idx, 1, '## Unreleased', '', `## ${version} - ${date}`);
  return lines.join('\n');
}

/** Markdown for one version, for GitHub Releases. */
export function renderSection(entry) {
  const label = { added: 'Added', changed: 'Changed', fixed: 'Fixed', breaking: 'Breaking' };
  const out = [];
  for (const s of ['breaking', 'added', 'changed', 'fixed']) {
    if (!entry.sections[s].length) continue;
    out.push(`### ${label[s]}`, '', ...entry.sections[s].map(b => `- ${b}`), '');
  }
  return out.join('\n').trim() + '\n';
}

export const readChangelog = () => readFileSync(CHANGELOG_PATH, 'utf8');
export const writeChangelog = md => writeFileSync(CHANGELOG_PATH, md);

/** Commit subjects since the last tag, as draft bullets to edit into Unreleased. */
function draftNotes() {
  const tag = spawnSync('git', ['describe', '--tags', '--abbrev=0'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const from = tag.status === 0 ? tag.stdout.trim() : null;
  const log = spawnSync('git', ['log', '--format=- %s', from ? `${from}..HEAD` : 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const bullets = log.stdout.split('\n').filter(l => l && !/^- (Release v|formatting$)/.test(l));
  console.log(
    `# commits since ${from ?? 'the beginning'} - edit into CHANGELOG.md "## Unreleased"`
  );
  console.log(
    `# drop traks.dev-only work (Home:, Docs:, Landing:, admin); keep what instances receive\n`
  );
  console.log(bullets.join('\n') || '- (no commits)');
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const mode = process.argv[2] ?? '--check';
  if (mode === 'notes') {
    draftNotes();
  } else {
    const { unreleased, entries } = parse(readChangelog());
    console.log(
      `✓ CHANGELOG.md: ${entries.length} released versions (${entries[0]?.version ?? 'none'} newest), ` +
        `${bulletCount(unreleased)} unreleased bullet(s)`
    );
  }
}
