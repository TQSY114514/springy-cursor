const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Injected marker. Because the loader inlines the script text into workbench.html,
// finding this string proves a patch is currently in place.
const SENTINEL = 'SPRINGY-CURSOR-RUNTIME';
const START = '<!-- !! SPRINGY-CURSOR-START !! -->';
const END = '<!-- !! SPRINGY-CURSOR-END !! -->';
const PRISTINE_SUFFIX = '.springy-pristine';
// Legacy: earlier versions relied on be5invis.vscode-custom-css. Kept only to clean
// up after it, never required.
const LEGACY_SECTION = 'vscode_custom_css';

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

function renderScript(context) {
	const cfg = vscode.workspace.getConfiguration('springyCursor');
	const config = {
		color: cfg.get('color'),
		opacity: cfg.get('opacity'),
		glow: cfg.get('glow'),
		glowBlur: cfg.get('glowBlur'),
		preset: cfg.get('preset'),
		animationLength: cfg.get('animationLength'),
		shortAnimationLength: cfg.get('shortAnimationLength'),
		animateOnTyping: cfg.get('animateOnTyping'),
		animateOnSelection: cfg.get('animateOnSelection'),
		rankTrailFactors: cfg.get('rankTrailFactors'),
		hardSnap: cfg.get('hardSnap'),
		leadingSnapFactor: cfg.get('leadingSnapFactor'),
		leadingSnapThreshold: cfg.get('leadingSnapThreshold'),
	};
	const template = fs.readFileSync(path.join(context.extensionPath, 'runtime', 'springy-cursor.js'), 'utf8');
	const rendered = template.replace('/*__SPRINGY_CONFIG__*/', `const CONFIG = ${JSON.stringify(config)};`);
	return `// ${SENTINEL}\n${rendered}`;
}

// ---------------------------------------------------------------------------
// workbench plumbing
//
// VS Code offers no API for the workbench DOM, so the only way to paint outside
// the editor viewport is to patch workbench.html in the installation directory.
// We do it ourselves (no companion extension) and keep product.json's integrity
// checksum in sync so the editor never claims its installation is corrupt.
// ---------------------------------------------------------------------------

function workbenchCandidates() {
	const codeDir = path.join(vscode.env.appRoot, 'out', 'vs', 'code');
	const found = [];
	for (const dirName of ['electron-browser', 'electron-sandbox']) {
		for (const fileName of ['workbench.html', 'workbench.esm.html', 'workbench-dev.html']) {
			const candidate = path.join(codeDir, dirName, 'workbench', fileName);
			if (fs.existsSync(candidate)) found.push(candidate);
		}
	}
	return found;
}

function hashOf(file) {
	return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('base64').replace(/=+$/, '');
}

// Returns 'ok' | 'synced' | 'unwritable' | 'unavailable'.
function syncChecksum() {
	const appRoot = vscode.env.appRoot;
	const productPath = path.join(appRoot, 'product.json');
	const candidates = workbenchCandidates();
	if (!candidates.length || !fs.existsSync(productPath)) return 'unavailable';

	let product;
	try {
		product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
	} catch {
		return 'unavailable';
	}
	if (!product.checksums) return 'unavailable';

	const outDir = path.join(appRoot, 'out');
	let changed = false;
	for (const file of candidates) {
		const rel = path.relative(outDir, file).split(path.sep).join('/');
		if (!(rel in product.checksums)) continue;
		const actual = hashOf(file);
		if (product.checksums[rel] !== actual) {
			product.checksums[rel] = actual;
			changed = true;
		}
	}
	if (!changed) return 'ok';

	try {
		fs.writeFileSync(productPath, JSON.stringify(product, null, '\t'));
	} catch (error) {
		// Program Files installs need elevation; the banner then stays and can be
		// silenced with "Don't Show Again".
		console.warn(`[springy-cursor] cannot update product.json checksums: ${error.code || error.message}`);
		return 'unwritable';
	}
	return 'synced';
}

function isPatched() {
	return workbenchCandidates().some((file) => {
		try {
			return fs.readFileSync(file, 'utf8').includes(SENTINEL);
		} catch {
			return false;
		}
	});
}

// Drop our own block plus any inline script carrying our sentinel (that is how a
// legacy Custom CSS and JS Loader injection of this runtime looks). Everything
// else in the file — including other users' custom CSS — is left untouched.
function stripOwn(html) {
	let out = html.replace(new RegExp(`${escapeRegExp(START)}[\\s\\S]*?${escapeRegExp(END)}\\n?`, 'g'), '');
	out = out.replace(/<script>([\s\S]*?)<\/script>/g, (match, body) => (body.includes(SENTINEL) ? '' : match));
	return out;
}

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pristinePath(file) {
	return file + PRISTINE_SUFFIX;
}

// Keep one untouched copy of the original file so a full restore is possible.
function ensurePristine(file, html) {
	const backup = pristinePath(file);
	if (fs.existsSync(backup)) return;
	// Prefer the loader's own backup when it exists: it is guaranteed pristine.
	const dir = path.dirname(file);
	let source = null;
	try {
		source = fs.readdirSync(dir).find((name) => name.endsWith('.bak-custom-css'));
	} catch {
		source = null;
	}
	if (source && !fs.readFileSync(path.join(dir, source), 'utf8').includes(SENTINEL)) {
		fs.copyFileSync(path.join(dir, source), backup);
		return;
	}
	if (!html.includes(SENTINEL) && !html.includes('VSCODE-CUSTOM-CSS-START')) {
		fs.copyFileSync(file, backup);
	}
}

// Returns 'patched' | 'unchanged' | 'unavailable' | 'unwritable'.
function patchWorkbench(context) {
	const script = renderScript(context);
	const candidates = workbenchCandidates();
	if (!candidates.length) return 'unavailable';

	let result = 'unchanged';
	for (const file of candidates) {
		let html;
		try {
			html = fs.readFileSync(file, 'utf8');
		} catch {
			continue;
		}
		ensurePristine(file, html);

		// Strip our own injection first, then drop the CSP meta tag (it sits in <head>,
		// so it has to be removed from the whole document, not just the tail).
		const base = stripOwn(html).replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '');
		const block = `${START}\n<script>${script}</script>\n${END}\n`;
		const anchor = base.includes('</body>') ? base.lastIndexOf('</body>') : base.lastIndexOf('</head>');
		if (anchor < 0) continue;
		const next = base.slice(0, anchor) + block + base.slice(anchor);

		if (next === html) continue;
		try {
			fs.writeFileSync(file, next);
			result = 'patched';
		} catch (error) {
			console.warn(`[springy-cursor] cannot write ${file}: ${error.code || error.message}`);
			return 'unwritable';
		}
	}
	syncChecksum();
	return result;
}

// Returns 'removed' | 'unchanged' | 'unavailable' | 'unwritable'.
function unpatchWorkbench() {
	const candidates = workbenchCandidates();
	if (!candidates.length) return 'unavailable';

	let result = 'unchanged';
	for (const file of candidates) {
		let html;
		try {
			html = fs.readFileSync(file, 'utf8');
		} catch {
			continue;
		}
		const stripped = stripOwn(html);
		// Nothing of ours (or of the loader) left behind: restore the pristine copy
		// so the Content-Security-Policy comes back exactly as shipped.
		let next = stripped;
		const leftoverLoader = stripped.includes('VSCODE-CUSTOM-CSS-START');
		const backup = pristinePath(file);
		if (!leftoverLoader && fs.existsSync(backup)) {
			next = fs.readFileSync(backup, 'utf8');
		}
		if (next === html) continue;
		try {
			fs.writeFileSync(file, next);
			result = 'removed';
		} catch (error) {
			console.warn(`[springy-cursor] cannot write ${file}: ${error.code || error.message}`);
			return 'unwritable';
		}
	}
	syncChecksum();
	return result;
}

// Earlier versions registered the runtime as a Custom CSS import. Remove that entry
// so the loader cannot inject a second copy of the runtime.
async function cleanupLegacyImport() {
	const section = vscode.workspace.getConfiguration(LEGACY_SECTION);
	const imports = section.get('imports', []);
	const kept = imports.filter((entry) => !/springy-cursor\.js$/i.test(String(entry)));
	if (kept.length === imports.length) return false;
	await section.update('imports', kept, vscode.ConfigurationTarget.Global);
	return true;
}

// ---------------------------------------------------------------------------

function promptReload(message) {
	vscode.window.showInformationMessage(message, 'Reload Window').then((choice) => {
		if (choice) vscode.commands.executeCommand('workbench.action.reloadWindow');
	});
}

async function enable(context) {
	await context.globalState.update('springyCursor.userDisabled', false);
	const legacy = await cleanupLegacyImport();
	const result = patchWorkbench(context);
	if (result === 'unwritable') {
		vscode.window.showErrorMessage('Springy Cursor cannot write to the VS Code installation directory. Reinstall VS Code in a user-writable location or run it with the rights to modify it.');
		return;
	}
	if (result === 'unavailable') {
		vscode.window.showErrorMessage('Springy Cursor cannot find workbench.html in this VS Code installation.');
		return;
	}
	promptReload(legacy || result === 'patched' ? 'Springy Cursor is enabled. Reload to apply it.' : 'Springy Cursor is already up to date. Reload to re-apply it.');
}

async function disable(context) {
	await context.globalState.update('springyCursor.userDisabled', true);
	await cleanupLegacyImport();
	const result = unpatchWorkbench();
	if (result === 'unwritable') {
		vscode.window.showErrorMessage('Springy Cursor cannot restore workbench.html (permission denied).');
		return;
	}
	promptReload('Springy Cursor is disabled. Reload to finish.');
}

// First-run wiring and post-update self-healing: installing the extension is all a
// user has to do. A VS Code update replaces workbench.html, which is detected here.
async function autoSetup(context) {
	const cfg = vscode.workspace.getConfiguration('springyCursor');
	if (!cfg.get('autoEnable', true)) return;
	if (context.globalState.get('springyCursor.userDisabled', false)) return;

	const legacy = await cleanupLegacyImport();
	const result = patchWorkbench(context);
	if (result === 'unwritable' || result === 'unavailable') {
		console.warn(`[springy-cursor] auto setup skipped: ${result}`);
		return;
	}
	if (result === 'patched' || legacy) {
		promptReload('Springy Cursor is set up. Reload to apply it.');
	}
}

function activate(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand('springyCursor.enable', () => enable(context)),
		vscode.commands.registerCommand('springyCursor.disable', () => disable(context)),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (!e.affectsConfiguration('springyCursor')) return;
			if (context.globalState.get('springyCursor.userDisabled', false)) return;
			if (patchWorkbench(context) === 'patched') {
				promptReload('Springy Cursor settings changed. Reload to apply them.');
			}
		}),
	);

	autoSetup(context).catch((error) => {
		console.error(`[springy-cursor] auto setup failed: ${error.message}`);
	});
}

function deactivate() {}

module.exports = { activate, deactivate };
