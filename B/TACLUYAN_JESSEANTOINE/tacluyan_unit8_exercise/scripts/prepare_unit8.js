const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const APP_NAME = "Jesse's Profile";
const SHORT_NAME = 'Jesse Profile';
const requiredAssets = [
  'assets/images/',
  'assets/images/gallery/',
  'assets/sounds/',
];

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}
function read(file) {
  if (!fs.existsSync(file)) fail(`Required file is missing: ${path.relative(root, file)}`);
  return fs.readFileSync(file, 'utf8');
}
function write(file, value) {
  fs.writeFileSync(file, value, 'utf8');
}
function findGitRoot(start) {
  let current = start;
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// Preflight every required file before changing anything.
const pubspecPath = path.join(root, 'pubspec.yaml');
let pubspec = read(pubspecPath);
if (!/^version:\s*[^\r\n]+/m.test(pubspec)) fail('pubspec.yaml has no top-level version: line.');
if (!/^dependencies:\s*$/m.test(pubspec)) fail('pubspec.yaml has no dependencies: section.');
if (!/^flutter:\s*$/m.test(pubspec)) fail('pubspec.yaml has no top-level flutter: section.');

const indexPath = path.join(root, 'web', 'index.html');
let html = read(indexPath);
if (!/<title>.*?<\/title>/is.test(html) && !/<\/head>/i.test(html)) fail('web/index.html has no title or </head> element.');

const manifestPath = path.join(root, 'web', 'manifest.json');
let manifest;
try { manifest = JSON.parse(read(manifestPath)); }
catch (error) { fail(`web/manifest.json is not valid JSON: ${error.message}`); }

const androidPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
let android = read(androidPath);
if (!/<manifest\b[^>]*>/.test(android) || !/<application\b/.test(android)) fail('AndroidManifest.xml does not look like a valid main manifest.');

const mainPath = path.join(root, 'lib', 'main.dart');
let main = read(mainPath);
const imageCount = (main.match(/Image\.network\(/g) || []).length;
if (imageCount !== 2) fail(`Expected exactly 2 remote Image.network calls in lib/main.dart, found ${imageCount}. No project files were changed.`);
let fallbackCount = (main.match(/webHtmlElementStrategy:\s*WebHtmlElementStrategy\.fallback/g) || []).length;
if (![0, 2].includes(fallbackCount)) fail(`Found ${fallbackCount}/2 web image fallbacks. Review lib/main.dart manually; no project files were changed.`);
const assetReferences = (main.match(/[\'"]assets\/[^\'"]+[\'"]/g) || []).map(x => x.slice(1, -1));
const audioReferences = [...main.matchAll(/AssetSource\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => {
  const reference = match[1].replace(/\\/g, '/');
  return reference.startsWith('assets/') ? reference : `assets/${reference}`;
});
const allAssetReferences = [...new Set([...assetReferences, ...audioReferences])];
const missingAssets = allAssetReferences.filter(relative => !fs.existsSync(path.join(root, relative)));
if (missingAssets.length) fail(`These assets referenced by lib/main.dart are missing: ${missingAssets.join(', ')}. Restore them from your completed Unit 7 Profile project before continuing. No project files were changed.`);

const repo = findGitRoot(root);
if (!repo) fail('Could not find the Git repository above this Flutter project. Open the project inside your existing personal fork clone. No project files were changed.');
const relativeProject = path.relative(repo, root).split(path.sep).join('/');
const projectWorkingDirectory = relativeProject ? `./${relativeProject}` : './';
const artifactPath = relativeProject ? `./${relativeProject}/build/web` : './build/web';
const workflowDir = path.join(repo, '.github', 'workflows');
const workflowPath = path.join(workflowDir, 'unit8-profile-deploy.yml');
const marker = '# UNIT8_PROFILE_WORKFLOW_GENERATED';
if (fs.existsSync(workflowPath) && !fs.readFileSync(workflowPath, 'utf8').includes(marker)) {
  fail('A different .github/workflows/unit8-profile-deploy.yml already exists. It was left untouched. No project files were changed.');
}

// Release version and dependencies.
pubspec = pubspec.replace(/^version:\s*[^\r\n]+/m, 'version: 1.1.0+2');
const dependencyStart = pubspec.search(/^dependencies:\s*$/m);
const nextSectionMatch = /^(?:dev_dependencies|flutter):\s*$/m.exec(pubspec.slice(dependencyStart + 1));
const dependencyEnd = nextSectionMatch ? dependencyStart + 1 + nextSectionMatch.index : pubspec.length;
let dependencySection = pubspec.slice(dependencyStart, dependencyEnd);
if (!/^  http:\s*/m.test(dependencySection)) dependencySection = dependencySection.replace(/^dependencies:\s*$/m, 'dependencies:\n  http: ^1.6.0');
if (!/^  audioplayers:\s*/m.test(dependencySection)) dependencySection = dependencySection.replace(/^dependencies:\s*$/m, 'dependencies:\n  audioplayers: ^6.8.1');
pubspec = pubspec.slice(0, dependencyStart) + dependencySection + pubspec.slice(dependencyEnd);
const lines = pubspec.split(/\r?\n/);
const flutterIndex = lines.findIndex(line => /^flutter:\s*$/.test(line));
let flutterEnd = lines.length;
for (let i = flutterIndex + 1; i < lines.length; i++) {
  if (lines[i].trim() && !/^\s/.test(lines[i]) && !/^#/.test(lines[i])) {
    flutterEnd = i;
    break;
  }
}
let assetsIndex = -1;
for (let i = flutterIndex + 1; i < flutterEnd; i++) {
  if (/^  assets:\s*$/.test(lines[i])) { assetsIndex = i; break; }
}
if (assetsIndex < 0) {
  lines.splice(flutterEnd, 0, '  assets:', ...requiredAssets.map(x => `    - ${x}`));
} else {
  let assetsEnd = flutterEnd;
  for (let i = assetsIndex + 1; i < flutterEnd; i++) {
    if (lines[i].trim() && !/^\s{4}/.test(lines[i])) { assetsEnd = i; break; }
  }
  const existing = new Set(lines.slice(assetsIndex + 1, assetsEnd).map(x => x.trim().replace(/^-\s*/, '')));
  const missing = requiredAssets.filter(x => !existing.has(x));
  if (missing.length) lines.splice(assetsEnd, 0, ...missing.map(x => `    - ${x}`));
}
pubspec = lines.join('\n').replace(/\n*$/, '\n');

// Web title and manifest.
if (/<title>.*?<\/title>/is.test(html)) {
  html = html.replace(/<title>.*?<\/title>/is, `<title>${APP_NAME}</title>`);
} else {
  html = html.replace(/<\/head>/i, `  <title>${APP_NAME}</title>\n</head>`);
}
manifest.name = APP_NAME;
manifest.short_name = SHORT_NAME;

// Android label and INTERNET permission.
if (!/android\.permission\.INTERNET/.test(android)) {
  android = android.replace(/(<manifest\b[^>]*>)/, '$1\n    <uses-permission android:name="android.permission.INTERNET"/>');
}
if (/android:label="[^"]*"/.test(android)) {
  android = android.replace(/android:label="[^"]*"/, `android:label="${APP_NAME}"`);
} else {
  android = android.replace(/(<application\b)/, `$1 android:label="${APP_NAME}"`);
}
if (!/android\.permission\.INTERNET/.test(android) || !/android:label="Jesse's Profile"/.test(android)) {
  fail('Could not safely set the Android app label and INTERNET permission. No project files were written.');
}

// Apply web image fallback to the two remote cover/poster images. Repeat-safe.
if (fallbackCount === 0) {
  main = main.replace(
    /(Image\.network\([\s\S]*?fit:\s*BoxFit\.(?:cover|contain),\s*)(?!webHtmlElementStrategy:)(\s*errorBuilder:)/g,
    '$1webHtmlElementStrategy: WebHtmlElementStrategy.fallback,\n        $2',
  );
  fallbackCount = (main.match(/webHtmlElementStrategy:\s*WebHtmlElementStrategy\.fallback/g) || []).length;
}
if (fallbackCount !== 2) fail(`The image fallback check found ${fallbackCount}/2. No project files were written.`);

// Keep local credentials out of Git.
const gitignorePath = path.join(root, '.gitignore');
let ignore = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
for (const item of ['omdb-key.txt', 'cms-url.txt', 'cms.json']) {
  if (!ignore.split(/\r?\n/).some(line => line.trim() === item)) {
    ignore += `${ignore.endsWith('\n') || !ignore ? '' : '\n'}${item}\n`;
  }
}

// GitHub Pages workflow: kept separate from any existing workflow.
const workflow = `${marker}
name: Deploy Unit 8 Profile App

on:
  push:
    branches:
      - unit8-profile-deploy
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with:
          channel: stable
          flutter-version: '3.47.7'
      - uses: actions/configure-pages@v5
      - name: Check required deployment values
        env:
          OMDB_KEY: \${{ secrets.OMDB_KEY }}
          CMS_URL: \${{ vars.CMS_URL }}
        run: |
          test -n "$OMDB_KEY" || { echo 'Missing repository secret OMDB_KEY'; exit 1; }
          test -n "$CMS_URL" || { echo 'Missing repository variable CMS_URL'; exit 1; }
      - name: Install packages
        working-directory: ${projectWorkingDirectory}
        run: flutter pub get
      - name: Build web release
        working-directory: ${projectWorkingDirectory}
        env:
          OMDB_KEY: \${{ secrets.OMDB_KEY }}
          CMS_URL: \${{ vars.CMS_URL }}
        run: >-
          flutter build web --release
          --base-href "/\${{ github.event.repository.name }}/"
          --dart-define=OMDB_KEY="$OMDB_KEY"
          --dart-define=CMS_URL="$CMS_URL"
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ${artifactPath}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
`;

// All checks have passed; write the edited configuration/source now.
write(pubspecPath, pubspec);
write(indexPath, html);
write(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
write(androidPath, android);
write(mainPath, main);
write(gitignorePath, ignore);
fs.mkdirSync(workflowDir, { recursive: true });
write(workflowPath, workflow);
for (const name of ['omdb-key.txt', 'cms-url.txt']) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, '', 'utf8');
}

console.log('Preparation validated: version 1.1.0+2; web title; manifest; Android label and INTERNET permission; asset references; 2 web image fallbacks; local credential files ignored by Git.');
console.log(`GitHub Pages workflow: ${path.relative(repo, workflowPath)}`);
console.log(`Flutter project folder inside repository: ${relativeProject || '(repository root)'}`);
console.log('No new instructional Dart comments were added.');
