// Unit tests for patching.js. The module is deliberately pure Node (no vscode
// import), so the whole patch/unpatch cycle can be exercised against a throwaway
// app directory instead of a real VS Code install.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const patching = require('../patching');

const REL = 'vs/code/electron-browser/workbench/workbench.html';
// what extension.js renders: the sentinel comment followed by the runtime body
const SCRIPT_BODY = `// ${patching.SENTINEL}\nvar runtime = true;`;

const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head>
\t<meta charset="utf-8" />
\t<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'" />
\t<script src="workbench.js"></script>
</head>
<body>
\t<div class="monaco-workbench"></div>
</body>
</html>
`;

function makeApp(html = SAMPLE_HTML) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'springy-patching-'));
	const app = path.join(root, 'app');
	const wbDir = path.join(app, 'out', 'vs', 'code', 'electron-browser', 'workbench');
	fs.mkdirSync(wbDir, { recursive: true });
	const wbPath = path.join(wbDir, 'workbench.html');
	fs.writeFileSync(wbPath, html);

	const productPath = path.join(app, 'product.json');
	fs.writeFileSync(
		productPath,
		JSON.stringify({ version: 'test', checksums: { [REL]: patching.hashOf(wbPath), 'vs/workbench/workbench.desktop.main.js': 'UNCHANGED' } }, null, '\t')
	);
	return { root, app, wbPath, productPath };
}

function readProduct(app) {
	return JSON.parse(fs.readFileSync(path.join(app, 'product.json'), 'utf8'));
}

test('patch writes the block before </body>, drops the CSP and syncs the checksum', () => {
	const { app, wbPath, productPath } = makeApp();
	const before = patching.hashOf(wbPath);

	const result = patching.patch(app, SCRIPT_BODY);

	assert.strictEqual(result, 'patched');
	const html = fs.readFileSync(wbPath, 'utf8');
	assert.ok(html.includes(patching.START), 'start marker');
	assert.ok(html.includes(patching.END), 'end marker');
	assert.ok(html.includes(patching.SENTINEL), 'sentinel');
	assert.ok(html.indexOf(patching.START) < html.indexOf('</body>'), 'block sits before </body>');
	assert.ok(!html.includes('Content-Security-Policy'), 'CSP meta removed');
	assert.ok(html.includes('<div class="monaco-workbench"></div>'), 'rest of the body untouched');

	const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
	assert.notStrictEqual(product.checksums[REL], before, 'checksum updated');
	assert.strictEqual(product.checksums[REL], patching.hashOf(wbPath), 'checksum matches the patched file');
	assert.strictEqual(product.checksums['vs/workbench/workbench.desktop.main.js'], 'UNCHANGED', 'other entries untouched');

	assert.ok(fs.existsSync(wbPath + patching.PRISTINE_SUFFIX), 'pristine backup created');
	assert.strictEqual(fs.readFileSync(wbPath + patching.PRISTINE_SUFFIX, 'utf8'), SAMPLE_HTML, 'backup is the original');
});

test('patch is idempotent', () => {
	const { app, wbPath } = makeApp();
	patching.patch(app, SCRIPT_BODY);
	const first = fs.readFileSync(wbPath, 'utf8');

	assert.strictEqual(patching.patch(app, SCRIPT_BODY), 'unchanged');
	assert.strictEqual(fs.readFileSync(wbPath, 'utf8'), first);
	assert.strictEqual(first.split(patching.START).length - 1, 1, 'exactly one block');
});

test('unpatch restores the original bytes, CSP included, and re-syncs the checksum', () => {
	const { app, wbPath } = makeApp();
	const originalHash = patching.hashOf(wbPath);
	patching.patch(app, SCRIPT_BODY);
	patching.unpatch(app);

	assert.strictEqual(fs.readFileSync(wbPath, 'utf8'), SAMPLE_HTML, 'byte-for-byte original');
	assert.strictEqual(patching.hashOf(wbPath), originalHash);
	assert.strictEqual(readProduct(app).checksums[REL], originalHash, 'checksum back to the original');
	assert.ok(!patching.isPatched(app));
});

test('isPatched reflects the file content', () => {
	const { app, wbPath } = makeApp();
	assert.strictEqual(patching.isPatched(app), false);
	patching.patch(app, SCRIPT_BODY);
	assert.strictEqual(patching.isPatched(app), true);
	fs.writeFileSync(wbPath, SAMPLE_HTML);
	assert.strictEqual(patching.isPatched(app), false);
});

test('foreign inline scripts survive, ours do not', () => {
	const foreign = '<script>/* someone else */ var keep = 1;</script>';
	const legacy = `<script>// ${patching.SENTINEL}\nvar ours = 1;</script>`;
	const html = SAMPLE_HTML.replace('</body>', `${foreign}${legacy}</body>`);
	const { app, wbPath } = makeApp(html);

	// no pristine copy yet (the file already carries our sentinel), so unpatch has
	// to strip surgically instead of restoring a backup
	patching.unpatch(app);
	const out = fs.readFileSync(wbPath, 'utf8');

	assert.ok(out.includes('var keep = 1'), 'foreign script kept');
	assert.ok(!out.includes(patching.SENTINEL), 'our legacy script removed');
});

test('patch reports unavailable when there is no workbench.html', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'springy-empty-'));
	const app = path.join(root, 'app');
	fs.mkdirSync(app, { recursive: true });
	assert.strictEqual(patching.patch(app, SCRIPT_BODY), 'unavailable');
	assert.strictEqual(patching.unpatch(app), 'unavailable');
	assert.strictEqual(patching.syncChecksum(app), 'unavailable');
});

test('removePristine deletes the backup', () => {
	const { app, wbPath } = makeApp();
	patching.patch(app, SCRIPT_BODY);
	const backup = wbPath + patching.PRISTINE_SUFFIX;
	assert.ok(fs.existsSync(backup));
	patching.removePristine(app);
	assert.ok(!fs.existsSync(backup));
});

test('appRootFromExecPath finds the hash-named app directory', () => {
	const install = fs.mkdtempSync(path.join(os.tmpdir(), 'springy-install-'));
	const hashDir = path.join(install, 'c4453f8ea4');
	const app = path.join(hashDir, 'resources', 'app');
	fs.mkdirSync(app, { recursive: true });
	fs.writeFileSync(path.join(app, 'product.json'), '{}');
	fs.writeFileSync(path.join(install, 'Code.exe'), '');

	const resolved = patching.appRootFromExecPath(path.join(install, 'Code.exe'));
	assert.strictEqual(path.resolve(resolved), path.resolve(app));

	assert.strictEqual(patching.appRootFromExecPath(path.join(install, 'missing', 'Code.exe')), null);
	assert.strictEqual(patching.appRootFromExecPath(''), null);
});

test('flush-safe layout: electron-sandbox installs are patched too', () => {
	const { app } = makeApp();
	const sandboxDir = path.join(app, 'out', 'vs', 'code', 'electron-sandbox', 'workbench');
	fs.mkdirSync(sandboxDir, { recursive: true });
	const sandboxPath = path.join(sandboxDir, 'workbench.html');
	fs.writeFileSync(sandboxPath, SAMPLE_HTML);

	patching.patch(app, SCRIPT_BODY);
	assert.ok(fs.readFileSync(sandboxPath, 'utf8').includes(patching.SENTINEL), 'sandbox layout patched');
});

test('patch keeps the sentinel even when the caller forgets it', () => {
	const { app, wbPath } = makeApp();
	// isPatched() and stripOwn() rely on the sentinel, so patch() has to guarantee it
	assert.strictEqual(patching.patch(app, 'var bare = 1;'), 'patched');
	const html = fs.readFileSync(wbPath, 'utf8');
	assert.ok(html.includes(patching.SENTINEL), 'sentinel added by patch()');
	assert.ok(patching.isPatched(app), 'isPatched sees it');
	patching.unpatch(app);
	assert.ok(!fs.readFileSync(wbPath, 'utf8').includes(patching.SENTINEL), 'and it is removed again');
});
