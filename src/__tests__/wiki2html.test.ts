import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { commandWiki2Html } from '../commands/wiki2html.js';

let tmpSrcDir: string;
let tmpOutDir: string;

beforeEach(() => {
  tmpSrcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-wiki-src-'));
  tmpOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-wiki-out-'));
});

afterEach(() => {
  fs.rmSync(tmpSrcDir, { recursive: true, force: true });
  fs.rmSync(tmpOutDir, { recursive: true, force: true });
});

describe('wiki2html command', () => {
  it('converts markdown files to styled HTML', async () => {
    // 1. Setup mock markdown files
    const indexMd = `
# Home Page
Welcome to the documentation.

## Getting Started
Here is some start info.
    `.trim();

    const detailMd = `
# Detail Page
This page shows details.

- Check out [[index]]
- Check out [[nested/page]]
- Normal link [Readme](README.md)

\`\`\`mermaid
graph LR
  A --> B
\`\`\`
    `.trim();

    const readmeMd = `
# README
Project readme.
    `.trim();

    fs.writeFileSync(path.join(tmpSrcDir, 'index.md'), indexMd, 'utf-8');
    fs.writeFileSync(path.join(tmpSrcDir, 'detail-page.md'), detailMd, 'utf-8');
    fs.writeFileSync(path.join(tmpSrcDir, 'README.md'), readmeMd, 'utf-8');

    // 2. Execute command
    await commandWiki2Html([
      '--src', tmpSrcDir,
      '--out', tmpOutDir,
      '--title', 'Test Wiki',
      '--no-open'
    ]);

    // 3. Verify output files exist
    expect(fs.existsSync(path.join(tmpOutDir, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(tmpOutDir, 'detail-page.html'))).toBe(true);
    expect(fs.existsSync(path.join(tmpOutDir, 'README.html'))).toBe(true);
    expect(fs.existsSync(path.join(tmpOutDir, 'search-index.js'))).toBe(true);

    // 4. Verify contents of index.html
    const indexHtml = fs.readFileSync(path.join(tmpOutDir, 'index.html'), 'utf-8');
    expect(indexHtml).toContain('<title>Test Wiki - Home Page</title>');
    expect(indexHtml).toContain('<h1>Home Page</h1>');
    expect(indexHtml).toContain('Getting Started</h2>');
    // Verify TOC was generated
    expect(indexHtml).toContain('class="toc-container"');
    expect(indexHtml).toContain('On this page');
    expect(indexHtml).toContain('Getting Started');

    // 5. Verify links and Mermaid block rendering in detail-page.html
    const detailHtml = fs.readFileSync(path.join(tmpOutDir, 'detail-page.html'), 'utf-8');
    // [[index]] -> index.html
    expect(detailHtml).toContain('<a href="index.html">index</a>');
    // [[nested/page]] -> nested_page.html
    expect(detailHtml).toContain('<a href="nested_page.html">nested/page</a>');
    // [Readme](README.md) -> <a href="README.html">Readme</a>
    expect(detailHtml).toContain('<a href="README.html">Readme</a>');
    // Mermaid code block should be rendered inside .mermaid-container / .mermaid class
    expect(detailHtml).toContain('class="mermaid-container"');
    expect(detailHtml).toContain('class="mermaid"');
    expect(detailHtml).toContain('graph LR');

    // 6. Verify search index JS
    const searchIdxJs = fs.readFileSync(path.join(tmpOutDir, 'search-index.js'), 'utf-8');
    expect(searchIdxJs).toContain('const WIKI_SEARCH_INDEX =');
    expect(searchIdxJs).toContain('"title": "Home Page"');
    expect(searchIdxJs).toContain('"title": "Detail Page"');
  });

  it('generates menu.json with --create-menu option', async () => {
    fs.writeFileSync(path.join(tmpSrcDir, 'index.md'), '# Home', 'utf-8');
    fs.writeFileSync(path.join(tmpSrcDir, 'about.md'), '# About', 'utf-8');

    const customMenuPath = path.join(tmpSrcDir, 'custom-menu.json');

    await commandWiki2Html([
      '--src', tmpSrcDir,
      '--create-menu',
      '--menu-path', customMenuPath
    ]);

    expect(fs.existsSync(customMenuPath)).toBe(true);
    const menuJson = JSON.parse(fs.readFileSync(customMenuPath, 'utf-8'));
    expect(menuJson).toEqual([
      { title: 'Home', url: 'index.html' },
      { title: 'About', url: 'about.html' }
    ]);
  });

  it('automatically detects project title from package.json or working dir name', async () => {
    fs.writeFileSync(path.join(tmpSrcDir, 'index.md'), '# Home Page', 'utf-8');

    await commandWiki2Html([
      '--src', tmpSrcDir,
      '--out', tmpOutDir,
      '--no-open'
    ]);

    const indexHtml = fs.readFileSync(path.join(tmpOutDir, 'index.html'), 'utf-8');
    expect(indexHtml).toContain('<title>Omnimap - Home Page</title>');
    expect(indexHtml).toContain('<h2>Omnimap</h2>');
    expect(indexHtml).toContain('href="index.html" class="sidebar-title-link"');
  });
});
