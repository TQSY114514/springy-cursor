// Pure Node helpers for patching workbench.html.
//
// No `vscode` import on purpose: the `vscode:uninstall` hook runs this file
// outside the extension host, where the vscode module does not exist.
// The extension passes `vscode.env.appRoot` in; the uninstall hook derives it
// from `process.execPath`.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SENTINEL = 'SPRINGY-CURSOR-RUNTIME';
const START = '<!-- !! SPRINGY-CURSOR-START !! -->';
const END = '<!-- !! SPRINGY-CURSOR-END !! -->';
const PRISTINE_SUFFIX = '.springy-pristine';
const CSP_RE = /<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/;

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function workbenchCandidates(appRoot) {
	if (!appRoot) return [];
	const codeDir = path.join(appRoot, 'out', 'vs', 'code');
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

// Remove our marker block plus any inline script carrying our sentinel (that is
// what a legacy Custom CSS and JS Loader injection of this runtime looks like).
// Everything else in the file, including other people's custom CSS, stays.
function stripOwn(html) {
	let out = html.replace(new RegExp(`${escapeRegExp(START)}[\\s\\S]*?${escapeRegExp(END)}\\n?`, 'g'), '');
	out = out.replace(/<script>([\s\S]*?)<\/script>/g, (match, body) => (body.includes(SENTINEL) ? '' : match));
	return out;
}

function pristinePath(file) {
	return file + PRISTINE_SUFFIX;
}

// Keep one untouched copy of the original so a full restore is possible.
function ensurePristine(file, html) {
	const backup = pristinePath(file);
	if (fs.existsSync(backup)) return;
	const dir = path.dirname(file);
	let source = null;
	try {
		source = fs.readdirSync(dir).find((name) => name.endsWith('.bak-custom-css'));
	} catch {
		source = null;
	}
	if (source) {
		const candidate = path.join(dir, source);
		try {
			if (!fs.readFileSync(candidate, 'utf8').includes(SENTINEL)) {
				fs.copyFileSync(candidate, backup);
				return;
			}
		} catch {
			// fall through to the plain copy below
		}
	}
	if (!html.includes(SENTINEL) && !html.includes('VSCODE-CUSTOM-CSS-START')) {
		fs.copyFileSync(file, backup);
	}
}

// VS Code verifies sha256 (base64, unpadded) of its own files at startup; a
// patched workbench.html always mismatches, which raises the "installation
// appears to be corrupt" notice. Rewrite that one entry instead.
function syncChecksum(appRoot) {
	if (!appRoot) return 'unavailable';
	const productPath = path.join(appRoot, 'product.json');
	const candidates = workbenchCandidates(appRoot);
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
	} catch {
		return 'unwritable';
	}
	return 'synced';
}

function isPatched(appRoot) {
	return workbenchCandidates(appRoot).some((file) => {
		try {
			return fs.readFileSync(file, 'utf8').includes(SENTINEL);
		} catch {
			return false;
		}
	});
}

// Returns 'patched' | 'unchanged' | 'unavailable' | 'unwritable'.
function patch(appRoot, scriptText) {
	const candidates = workbenchCandidates(appRoot);
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

		// Strip our own injection first, then drop the CSP meta tag: it sits in
		// <head>, so removing it from the tail only would leave it in place and
		// the inline script would never run.
		const base = stripOwn(html).replace(CSP_RE, '');
		const block = `${START}\n<script>${scriptText}</script>\n${END}\n`;
		const anchor = base.includes('</body>') ? base.lastIndexOf('</body>') : base.lastIndexOf('</head>');
		if (anchor < 0) continue;
		const next = base.slice(0, anchor) + block + base.slice(anchor);
		if (next === html) continue;

		try {
			fs.writeFileSync(file, next);
			result = 'patched';
		} catch {
			return 'unwritable';
		}
	}
	syncChecksum(appRoot);
	return result;
}

// Returns 'removed' | 'unchanged' | 'unavailable' | 'unwritable'.
function unpatch(appRoot) {
	const candidates = workbenchCandidates(appRoot);
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
		// Nothing of ours (or of the loader) is left: restore the pristine copy so
		// the Content-Security-Policy comes back exactly as shipped.
		let next = stripped;
		const backup = pristinePath(file);
		if (!stripped.includes('VSCODE-CUSTOM-CSS-START') && fs.existsSync(backup)) {
			try {
				next = fs.readFileSync(backup, 'utf8');
			} catch {
				next = stripped;
			}
		}
		if (next === html) continue;

		try {
			fs.writeFileSync(file, next);
			result = 'removed';
		} catch {
			return 'unwritable';
		}
	}
	syncChecksum(appRoot);
	return result;
}

function removePristine(appRoot) {
	for (const file of workbenchCandidates(appRoot)) {
		try {
			fs.unlinkSync(pristinePath(file));
		} catch {
			// nothing to clean up
		}
	}
}

// Resolve `<install>/<hash>/resources/app` from an executable path such as
// `D:\Microsoft VS Code\Code.exe` — what the uninstall hook gets in
// `process.execPath`. Recent builds keep the app under a commit-hash directory.
function appRootFromExecPath(execPath) {
	if (!execPath) return null;
	const installRoot = path.dirname(execPath);
	const direct = path.join(installRoot, 'resources', 'app');
	if (fs.existsSync(path.join(direct, 'product.json'))) return direct;

	let entries;
	try {
		entries = fs.readdirSync(installRoot, { withFileTypes: true });
	} catch {
		return null;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const candidate = path.join(installRoot, entry.name, 'resources', 'app');
		if (fs.existsSync(path.join(candidate, 'product.json'))) return candidate;
	}
	return null;
}

module.exports = {
	SENTINEL,
	START,
	END,
	PRISTINE_SUFFIX,
	workbenchCandidates,
	hashOf,
	stripOwn,
	pristinePath,
	ensurePristine,
	syncChecksum,
	isPatched,
	patch,
	unpatch,
	removePristine,
	appRootFromExecPath,
};
