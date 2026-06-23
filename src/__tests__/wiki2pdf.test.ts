import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

let tmpSrcDir: string;
let tmpOutPdf: string;

// Check if Chrome/Chromium is available before running tests
function hasChrome(): boolean {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      ]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];

  for (const p of candidates) {
    if (fs.existsSync(p)) return true;
  }
  try {
    const names = process.platform === 'win32'
      ? ['chrome.exe', 'msedge.exe', 'chromium.exe']
      : process.platform === 'darwin'
      ? ['Google Chrome']
      : ['google-chrome', 'chromium-browser', 'chromium'];
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    for (const name of names) {
      try {
        execFileSync(cmd, [name], { stdio: 'pipe' });
        return true;
      } catch {}
    }
  } catch {}
  return false;
}

const chromeAvailable = hasChrome();

beforeEach(() => {
  tmpSrcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-pdf-src-'));
  tmpOutPdf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omm-pdf-out-')), 'doc.pdf');
});

afterEach(() => {
  fs.rmSync(tmpSrcDir, { recursive: true, force: true });
  fs.rmSync(path.dirname(tmpOutPdf), { recursive: true, force: true });
});

describe('wiki2pdf command', () => {
  it.skipIf(!chromeAvailable)('converts markdown files into a styled cover-paged PDF', async () => {
    const { commandWiki2Pdf } = await import('../commands/wiki2pdf.js');

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

\`\`\`mermaid
graph LR
  A --> B
\`\`\`
    `.trim();

    fs.writeFileSync(path.join(tmpSrcDir, 'index.md'), indexMd, 'utf-8');
    fs.writeFileSync(path.join(tmpSrcDir, 'detail-page.md'), detailMd, 'utf-8');

    // 2. Execute command
    await commandWiki2Pdf([
      '--src', tmpSrcDir,
      '--out', tmpOutPdf,
      '--title', 'Test PDF Wiki'
    ]);

    // 3. Verify output PDF file exists and is not empty
    expect(fs.existsSync(tmpOutPdf)).toBe(true);
    const stats = fs.statSync(tmpOutPdf);
    expect(stats.size).toBeGreaterThan(100); // PDF should contain header bytes
  });

  it('shows help on --help flag', async () => {
    const { commandWiki2Pdf } = await import('../commands/wiki2pdf.js');
    const stdoutWrite = process.stdout.write;
    let output = '';
    process.stdout.write = (chunk: any) => { output += chunk; return true; };
    try {
      await commandWiki2Pdf(['--help']);
    } finally {
      process.stdout.write = stdoutWrite;
    }
    expect(output).toContain('omm wiki2pdf');
    expect(output).toContain('--src');
    expect(output).toContain('--out');
  });

  it('shows help when no args provided', async () => {
    const { commandWiki2Pdf } = await import('../commands/wiki2pdf.js');
    const stdoutWrite = process.stdout.write;
    let output = '';
    process.stdout.write = (chunk: any) => { output += chunk; return true; };
    try {
      await commandWiki2Pdf([]);
    } finally {
      process.stdout.write = stdoutWrite;
    }
    expect(output).toContain('omm wiki2pdf');
  });

  it('exits with error for non-existent source directory', async () => {
    const { commandWiki2Pdf } = await import('../commands/wiki2pdf.js');
    const stderrWrite = process.stderr.write;
    let errOutput = '';
    process.stderr.write = (chunk: any) => { errOutput += chunk; return true; };

    let caught = false;
    try {
      await commandWiki2Pdf(['--src', '/nonexistent/path']);
    } catch {
      caught = true;
    } finally {
      process.stderr.write = stderrWrite;
    }
    // process.exit(1) throws in test env (or the readdirSync throws after)
    expect(errOutput || caught).toBeTruthy();
  });
});
