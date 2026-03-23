import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const authoritativeDocs = [
  'README.md',
  'CLAUDE.md',
  'docs/DEPLOYMENT_GUIDE.md',
  'docs/phase1/SENTIMENT_ANALYZER_ARCHITECTURE.md',
  'docs/TESTING_STRATEGY.md',
  'postman/README.md',
  'docs/MARL/MARL_INTEGRATION_GUIDE.md',
];

const docsWithLiveRepoPathValidation = [
  'README.md',
  'postman/README.md',
  'docs/MARL/MARL_INTEGRATION_GUIDE.md',
];

const fileTokenPattern = /`((?:\.\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:md|ts|tsx|js|mjs|cjs|json|ya?ml|ps1))`/g;

const errors = [];

function readRepoFile(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.readFileSync(fullPath, 'utf8');
}

function repoFileExists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function assertIncludes(filePath, expected) {
  const content = readRepoFile(filePath);
  assert(
    content.includes(expected),
    `${filePath} is missing expected text: ${expected}`
  );
}

function assertNotIncludes(filePath, unexpected) {
  const content = readRepoFile(filePath);
  assert(
    !content.includes(unexpected),
    `${filePath} still contains stale text: ${unexpected}`
  );
}

function validateInlineFileReferences(filePath) {
  const content = readRepoFile(filePath);

  for (const match of content.matchAll(fileTokenPattern)) {
    const token = match[1];
    if (token.includes('*') || token.includes('<') || token.includes('>')) continue;
    if (!/^(?:\.?\/?)*(?:backend|frontend|docs|postman|\.github|scripts)\//.test(token)) continue;

    const normalized = token.startsWith('./') ? token.slice(2) : token;
    assert(
      repoFileExists(normalized),
      `${filePath} references a missing file path: ${token}`
    );
  }
}

function validateLiveDocs() {
  for (const doc of authoritativeDocs) {
    assert(repoFileExists(doc), `Expected documentation file is missing: ${doc}`);
    if (repoFileExists(doc) && docsWithLiveRepoPathValidation.includes(doc)) {
      validateInlineFileReferences(doc);
    }
  }

  assert(repoFileExists('.github/workflows/ci.yml'), 'Expected CI workflow is missing: .github/workflows/ci.yml');
  assert(repoFileExists('backend/package.json'), 'Expected backend package.json is missing');
  assert(repoFileExists('frontend/package.json'), 'Expected frontend package.json is missing');
  assert(repoFileExists('backend/src/index.ts'), 'Expected backend entrypoint is missing');
  assert(repoFileExists('frontend/src/__tests__/App.test.tsx'), 'Expected frontend modal test is missing');

  assertIncludes('CLAUDE.md', 'nodemon + tsx');
  assertNotIncludes('CLAUDE.md', 'nodemon + ts-node');

  assertIncludes('README.md', 'ContentSignalService');
  assertIncludes('README.md', 'SocialScraperService');
  assertIncludes('README.md', 'TrendingTopicsEngine');
  assertIncludes('README.md', '/api/scrape/social');
  assertIncludes('README.md', '/api/trending');

  assertNotIncludes('README.md', 'trending_score (headline count)');
  assertIncludes(
    'docs/phase1/SENTIMENT_ANALYZER_ARCHITECTURE.md',
    'Sets `trending_score` from weighted frequency, recency, and source diversity rather than raw headline count'
  );

  assertIncludes('docs/TESTING_STRATEGY.md', 'Frontend Vitest + React Testing Library are configured');
  assertIncludes('docs/TESTING_STRATEGY.md', 'frontend/src/__tests__/App.test.tsx');

  assertNotIncludes('docs/DEPLOYMENT_GUIDE.md', '.github/workflows/` is empty');
  assertNotIncludes('docs/DEPLOYMENT_GUIDE.md', 'app currently uses in-memory cache only');

  assertIncludes('docs/MARL/MARL_INTEGRATION_GUIDE.md', 'frontend/src/components/MarlCompetitionViewer.tsx');
  assertIncludes('docs/MARL/MARL_INTEGRATION_GUIDE.md', 'frontend/src/App.tsx');
}

validateLiveDocs();

if (errors.length > 0) {
  console.error('Documentation validation failed:\n');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Documentation validation passed.');