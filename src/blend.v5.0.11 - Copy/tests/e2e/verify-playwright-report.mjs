import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configuredReportDir = process.env.PLAYWRIGHT_HTML_OUTPUT_DIR || 'playwright-report';
const reportDir = path.resolve(appRoot, configuredReportDir);
const reportRoot = `${reportDir}${path.sep}`;
const indexPath = path.join(reportDir, 'index.html');
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.svg', '.txt']);
const sensitivePatterns = [
  /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];
const privatePathPatterns = [
  /\b[A-Z]:\\(?:Users\\[^\\\s"'<>]+|GitHub\\[^\\\s"'<>]+)/i,
  /\/Users\/[^/\s"'<>]+/,
  /\/home\/(?!runner(?:\/|$))[^/\s"'<>]+/
];

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Unexpected symbolic link in report output: ${path.relative(reportDir, entryPath)}`);
    }
    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

const reportStat = await lstat(reportDir).catch(() => null);
if (!reportStat?.isDirectory()) {
  throw new Error(`Playwright HTML report directory is missing: ${path.relative(appRoot, reportDir)}`);
}

const indexStat = await stat(indexPath).catch(() => null);
if (!indexStat?.isFile() || indexStat.size === 0) {
  throw new Error(`Playwright HTML report index is missing or empty: ${path.relative(appRoot, indexPath)}`);
}

const files = await listFiles(reportDir);
if (files.length === 0) {
  throw new Error('Playwright HTML report contains no files.');
}

const findings = [];
for (const filePath of files) {
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(reportRoot)) {
    throw new Error(`Report file escapes its output directory: ${path.relative(appRoot, filePath)}`);
  }
  if (!textExtensions.has(path.extname(filePath).toLowerCase())) {
    throw new Error(`Cannot inspect unexpected report file type: ${path.relative(reportDir, filePath)}`);
  }

  const content = await readFile(filePath, 'utf8');
  for (const pattern of sensitivePatterns) {
    if (pattern.test(content)) {
      findings.push(`${path.relative(reportDir, filePath)} contains a credential-like value`);
      break;
    }
  }
  for (const pattern of privatePathPatterns) {
    if (pattern.test(content)) {
      findings.push(`${path.relative(reportDir, filePath)} contains a private local path`);
      break;
    }
  }
}

if (findings.length > 0) {
  throw new Error(`Playwright report failed the artifact safety check:\n${findings.join('\n')}`);
}

console.log(`Verified Playwright HTML report: ${files.length} file(s), no credential-like values or private local paths.`);
