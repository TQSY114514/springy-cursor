const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const patching = require('./patching');

// Legacy: earlier versions relied on be5invis.vscode-custom-css. Kept only to
// clean up after it, never required.
const LEGACY_SECTION = 'vscode_custom_css';

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
	return `// ${patching.SENTINEL}\n${rendered}`;
}

function appRoot() {
	return vscode.env.appRoot;
}

// Earlier versions registered the runtime as a Custom CSS import. Remove that
// entry so the loader cannot inject a second copy of the runtime.
async function cleanupLegacyImport() {
	const section = vscode.workspace.getConfiguration(LEGACY_SECTION);
	const imports = section.get('imports', []);
	const kept = imports.filter((entry) => !/springy-cursor\.js$/i.test(String(entry)));
	if (kept.length === imports.length) return false;
	await section.update('imports', kept, vscode.ConfigurationTarget.Global);
	return true;
}

function promptReload(message) {
	vscode.window.showInformationMessage(message, 'Reload Window').then((choice) => {
		if (choice) vscode.commands.executeCommand('workbench.action.reloadWindow');
	});
}

function reportFailure(result) {
	if (result === 'unwritable') {
		vscode.window.showErrorMessage(
			'Springy Cursor cannot write to the VS Code installation directory. Reinstall VS Code somewhere user-writable, or run it with the rights to modify that folder.'
		);
		return true;
	}
	if (result === 'unavailable') {
		vscode.window.showErrorMessage('Springy Cursor cannot find workbench.html in this VS Code installation.');
		return true;
	}
	return false;
}

async function enable(context) {
	await context.globalState.update('springyCursor.userDisabled', false);
	const legacy = await cleanupLegacyImport();
	const result = patching.patch(appRoot(), renderScript(context));
	if (reportFailure(result)) return;
	promptReload(
		legacy || result === 'patched' ? 'Springy Cursor is enabled. Reload to apply it.' : 'Springy Cursor is already up to date. Reload to re-apply it.'
	);
}

async function disable(context) {
	await context.globalState.update('springyCursor.userDisabled', true);
	await cleanupLegacyImport();
	const result = patching.unpatch(appRoot());
	if (reportFailure(result)) return;
	promptReload('Springy Cursor is disabled. Reload to finish.');
}

// First-run wiring and post-update self-healing: installing the extension is all a
// user has to do. A VS Code update replaces workbench.html, detected here.
async function autoSetup(context) {
	const cfg = vscode.workspace.getConfiguration('springyCursor');
	if (!cfg.get('autoEnable', true)) return;
	if (context.globalState.get('springyCursor.userDisabled', false)) return;

	const legacy = await cleanupLegacyImport();
	const result = patching.patch(appRoot(), renderScript(context));
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
			if (patching.patch(appRoot(), renderScript(context)) === 'patched') {
				promptReload('Springy Cursor settings changed. Reload to apply them.');
			}
		})
	);

	autoSetup(context).catch((error) => {
		console.error(`[springy-cursor] auto setup failed: ${error.message}`);
	});
}

function deactivate() {}

module.exports = { activate, deactivate };
