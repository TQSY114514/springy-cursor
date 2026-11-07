const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const CSS_SECTION = 'vscode_custom_css';
const RELOAD_COMMAND = 'extension.updateCustomCSS';

// The generated script lives in global storage, whose path does not include the
// extension version, so the Custom CSS import keeps working across updates.
function scriptPath(context) {
	return path.join(context.globalStorageUri.fsPath, 'springy-cursor.js');
}

function writeScript(context) {
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
	const script = template.replace('/*__SPRINGY_CONFIG__*/', `const CONFIG = ${JSON.stringify(config)};`);
	fs.mkdirSync(path.dirname(scriptPath(context)), { recursive: true });
	fs.writeFileSync(scriptPath(context), script);
}

function importUri(context) {
	return vscode.Uri.file(scriptPath(context)).toString();
}

function isEnabled(context) {
	return vscode.workspace.getConfiguration(CSS_SECTION).get('imports', []).includes(importUri(context));
}

async function promptReload(message) {
	const choice = await vscode.window.showInformationMessage(message, 'Reload Custom CSS and JS');
	if (choice) await vscode.commands.executeCommand(RELOAD_COMMAND);
}

async function enable(context) {
	writeScript(context);
	const css = vscode.workspace.getConfiguration(CSS_SECTION);
	const imports = css.get('imports', []);
	if (!imports.includes(importUri(context))) {
		await css.update('imports', [...imports, importUri(context)], vscode.ConfigurationTarget.Global);
	}
	await promptReload('Springy Cursor is enabled. Reload Custom CSS and JS to apply it.');
}

async function disable(context) {
	const css = vscode.workspace.getConfiguration(CSS_SECTION);
	const imports = css.get('imports', []);
	// Remove only our own import; leave every other user import alone.
	await css.update('imports', imports.filter((i) => i !== importUri(context)), vscode.ConfigurationTarget.Global);
	await promptReload('Springy Cursor is disabled. Reload Custom CSS and JS to apply it.');
}

function activate(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand('springyCursor.enable', () => enable(context)),
		vscode.commands.registerCommand('springyCursor.disable', () => disable(context)),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (!e.affectsConfiguration('springyCursor') || !isEnabled(context)) return;
			writeScript(context);
			promptReload('Springy Cursor settings changed. Reload Custom CSS and JS to apply them.');
		}),
	);
	// After an extension update, refresh the generated script from the new runtime.
	if (isEnabled(context)) writeScript(context);
}

function deactivate() {}

module.exports = { activate, deactivate };
