// `scripts.vscode:uninstall` hook: VS Code runs this after the extension is
// removed, outside the extension host, so there is no `vscode` module here.
// Without it, uninstalling would leave workbench.html patched: the trail would
// keep running with no extension alive to turn it off.

const patching = require('./patching');

function main() {
	const appRoot = process.env.SPRINGY_APP_ROOT || patching.appRootFromExecPath(process.execPath);
	if (!appRoot) return;
	patching.unpatch(appRoot);
	patching.removePristine(appRoot);
}

try {
	main();
} catch (error) {
	console.error(`[springy-cursor] uninstall cleanup failed: ${error.message}`);
}
