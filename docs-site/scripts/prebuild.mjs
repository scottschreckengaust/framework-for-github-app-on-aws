/**
 * Prebuild script that copies markdown content from the repository root
 * into the Starlight content directory, adding frontmatter where needed.
 *
 * This avoids duplicating content while ensuring Starlight can process
 * the files with proper metadata.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CONTENT_DIR = join(__dirname, '..', 'src', 'content', 'docs');

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function hasFrontmatter(content) {
  return content.trimStart().startsWith('---');
}

function extractTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1] : null;
}

function escapeYamlString(str) {
  // If the string contains quotes or colons, use single quotes and escape internal single quotes
  if (/[:"']/.test(str)) {
    return `'${str.replace(/'/g, "''")}'`;
  }
  return `"${str}"`;
}

function addFrontmatter(content, title) {
  if (hasFrontmatter(content)) {
    return content;
  }
  return `---\ntitle: ${escapeYamlString(title)}\n---\n\n${content}`;
}

function copyWithFrontmatter(srcPath, destPath, fallbackTitle) {
  const content = readFileSync(srcPath, 'utf-8');
  const title = extractTitle(content) || fallbackTitle;
  const processed = addFrontmatter(content, title);
  ensureDir(dirname(destPath));
  writeFileSync(destPath, processed);
  console.log(`  ${basename(destPath)}`);
}

// --- Copy runbooks ---
console.log('Copying runbooks...');
const runbooks = [
  'monitoring.md',
  'user-authorization.md',
  'disaster-recovery-and-replication.md',
  'redrive-events.md',
];
for (const file of runbooks) {
  copyWithFrontmatter(
    join(ROOT, 'docs', 'runbooks', file),
    join(CONTENT_DIR, 'runbooks', file),
    file.replace(/\.md$/, '').replace(/-/g, ' ')
  );
}

// --- Copy ADRs ---
console.log('Copying ADRs...');
const adrDir = join(ROOT, 'adr');
const adrFiles = readdirSync(adrDir).filter((f) => f.endsWith('.md'));
for (const file of adrFiles) {
  copyWithFrontmatter(
    join(adrDir, file),
    join(CONTENT_DIR, 'adr', file),
    file.replace(/\.md$/, '').replace(/-/g, ' ')
  );
}

// --- Copy QUICK_START.md ---
console.log('Copying Quick Start...');
copyWithFrontmatter(
  join(ROOT, 'QUICK_START.md'),
  join(CONTENT_DIR, 'quick-start.md'),
  'Quick Start'
);

// --- Copy DEPLOYMENT_PLAN_REFERENCE.md ---
console.log('Copying Deployment Plan...');
copyWithFrontmatter(
  join(ROOT, 'docs', 'DEPLOYMENT_PLAN_REFERENCE.md'),
  join(CONTENT_DIR, 'deployment-plan.md'),
  'Deployment Plan Reference'
);

console.log('Done!');
