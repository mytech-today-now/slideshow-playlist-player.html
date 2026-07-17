import test from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdown, escapeHtml, slugify } from '../../markdown.js';

test('escapeHtml neutralizes the five significant characters', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'),
    '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('slugify produces GitHub-style heading ids', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify('  Multiple   Spaces  '), 'multiple-spaces');
  assert.equal(slugify('Import/Export Formats'), 'importexport-formats');
});

test('headings render with level and slug id', () => {
  const html = renderMarkdown('# Title Here\n\n## Sub Section');
  assert.match(html, /<h1 id="title-here">Title Here<\/h1>/);
  assert.match(html, /<h2 id="sub-section">Sub Section<\/h2>/);
});

test('inline formatting: bold, italic, strikethrough, code', () => {
  const html = renderMarkdown('This is **bold**, *italic*, ~~gone~~ and `code()`.');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<del>gone<\/del>/);
  assert.match(html, /<code>code\(\)<\/code>/);
});

test('external links open in a new tab with rel="noopener noreferrer"', () => {
  const html = renderMarkdown('[myTech](https://mytech.today/)');
  assert.match(html, /<a href="https:\/\/mytech\.today\/" target="_blank" rel="noopener noreferrer">myTech<\/a>/);
});

test('relative links do not get a target attribute', () => {
  const html = renderMarkdown('[anchor](#section)');
  assert.match(html, /<a href="#section">anchor<\/a>/);
  assert.doesNotMatch(html, /target="_blank"[^>]*>anchor/);
});

test('bare URLs are autolinked', () => {
  const html = renderMarkdown('See https://example.com for details');
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">https:\/\/example\.com<\/a>/);
});

test('fenced code blocks are escaped and language-tagged', () => {
  const html = renderMarkdown('```js\nconst x = a < b && c > d;\n```');
  assert.match(html, /<pre><code class="language-js">/);
  assert.match(html, /const x = a &lt; b &amp;&amp; c &gt; d;/);
  // Markup inside a code block must NOT be interpreted.
  assert.doesNotMatch(html, /<strong>/);
});

test('unordered and ordered lists render', () => {
  const ul = renderMarkdown('- one\n- two\n- three');
  assert.match(ul, /<ul><li>one<\/li><li>two<\/li><li>three<\/li><\/ul>/);
  const ol = renderMarkdown('1. first\n2. second');
  assert.match(ol, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
});

test('nested lists nest inside the parent item', () => {
  const html = renderMarkdown('- parent\n  - child\n- sibling');
  assert.match(html, /<ul><li>parent<ul><li>child<\/li><\/ul><\/li><li>sibling<\/li><\/ul>/);
});

test('task list items render disabled checkboxes', () => {
  const html = renderMarkdown('- [x] done\n- [ ] todo');
  assert.match(html, /<input type="checkbox" disabled checked>/);
  assert.match(html, /<input type="checkbox" disabled>/);
});

test('blockquotes render recursively', () => {
  const html = renderMarkdown('> quoted **text**');
  assert.match(html, /<blockquote>[\s\S]*<strong>text<\/strong>[\s\S]*<\/blockquote>/);
});

test('horizontal rules render', () => {
  assert.match(renderMarkdown('a\n\n---\n\nb'), /<hr>/);
});

test('pipe tables render with header, alignment and rows', () => {
  const md = '| Name | Value |\n| :--- | ----: |\n| a | 1 |\n| b | 2 |';
  const html = renderMarkdown(md);
  assert.match(html, /<table><thead><tr><th style="text-align:left">Name<\/th><th style="text-align:right">Value<\/th><\/tr><\/thead>/);
  assert.match(html, /<td style="text-align:left">a<\/td><td style="text-align:right">1<\/td>/);
});

test('raw HTML in source is escaped, never injected (XSS safety)', () => {
  const html = renderMarkdown('Hello <script>alert(1)</script> <img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('javascript: links are neutralized', () => {
  const html = renderMarkdown('[click](javascript:alert(1))');
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /href="#"/);
});

test('paragraphs are wrapped and separated by blank lines', () => {
  const html = renderMarkdown('First para.\n\nSecond para.');
  assert.match(html, /<p>First para\.<\/p>/);
  assert.match(html, /<p>Second para\.<\/p>/);
});

test('renders a representative README slice end-to-end', () => {
  const md = [
    '# Blend Player',
    '',
    '> Source of truth.',
    '',
    '## Features',
    '',
    '- Local-first',
    '- [Docs](https://mytech.today/)',
    '',
    '```bash',
    'npm test',
    '```'
  ].join('\n');
  const html = renderMarkdown(md);
  assert.match(html, /<h1 id="blend-player">/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<ul><li>Local-first<\/li>/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /<pre><code class="language-bash">npm test<\/code><\/pre>/);
});
