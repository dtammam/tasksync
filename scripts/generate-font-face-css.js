#!/usr/bin/env node
/**
 * generate-font-face-css.js
 *
 * Reads all web/static/fonts/<slug>/font.css files, rewrites relative URL
 * references to absolute paths, collapses whitespace to a single line per
 * slug, and outputs a deterministic JSON map to stdout.
 *
 * Usage:
 *   node scripts/generate-font-face-css.js
 *   node scripts/generate-font-face-css.js > output.json
 *
 * Output format:
 *   {
 *     "<slug>": "<collapsed @font-face CSS>",
 *     ...
 *   }
 *
 * The output is deterministic: slugs are sorted alphabetically and the same
 * input files always produce byte-for-byte identical output.
 *
 * Only Node.js built-in modules are used (fs, path).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const FONTS_DIR = path.resolve(__dirname, '../web/static/fonts');

/**
 * Discover all font slugs: directories under FONTS_DIR that contain a
 * font.css file.
 *
 * @returns {string[]} Sorted list of slug names.
 */
function discoverSlugs() {
  const entries = fs.readdirSync(FONTS_DIR, { withFileTypes: true });
  const slugs = entries
    .filter((entry) => {
      if (!entry.isDirectory()) return false;
      const cssPath = path.join(FONTS_DIR, entry.name, 'font.css');
      return fs.existsSync(cssPath);
    })
    .map((entry) => entry.name);
  slugs.sort();
  return slugs;
}

/**
 * Process a single font.css file:
 *   1. Strip CSS block comments (/* ... *\/).
 *   2. Rewrite relative url('./filename') to absolute url('/fonts/<slug>/filename').
 *   3. Collapse all whitespace (leading/trailing per line, multi-space, newlines)
 *      into a single space, trimming the result.
 *
 * @param {string} slug - The font directory name (e.g. 'sora').
 * @param {string} cssPath - Absolute path to the font.css file.
 * @returns {string} Compact single-line CSS string.
 */
function processFontCSS(slug, cssPath) {
  let css = fs.readFileSync(cssPath, 'utf8');

  // Strip CSS block comments: /* ... */
  // Use a non-greedy match so we don't accidentally eat multiple comment blocks.
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Rewrite relative URL references: url('./filename') -> url('/fonts/<slug>/filename')
  // Matches both single-quoted and unquoted forms (Google Fonts CSS uses single quotes).
  css = css.replace(/url\(['"]?\.\/([\w.-]+)['"]?\)/g, `url('/fonts/${slug}/$1')`);

  // Collapse whitespace: strip leading/trailing whitespace per line, then
  // collapse all remaining whitespace sequences (spaces, tabs, newlines) into
  // a single space, and trim the whole result.
  css = css
    .split('\n')
    .map((line) => line.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return css;
}

/**
 * Main entry point.
 */
function main() {
  const slugs = discoverSlugs();

  if (slugs.length === 0) {
    process.stderr.write('ERROR: No font directories with font.css found under ' + FONTS_DIR + '\n');
    process.exit(1);
  }

  /** @type {Record<string, string>} */
  const fontFaceCSS = {};

  for (const slug of slugs) {
    const cssPath = path.join(FONTS_DIR, slug, 'font.css');
    fontFaceCSS[slug] = processFontCSS(slug, cssPath);
  }

  process.stdout.write(JSON.stringify(fontFaceCSS, null, 2) + '\n');
}

main();
