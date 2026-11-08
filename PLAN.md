# Springy Cursor 计划

目标：给 VS Code 做一个 Neovide / Zed 风格的光标拖尾插件，自己长期维护，修掉 [30d98f9b2/Neovide-Cursor](https://github.com/30d98f9b2/Neovide-Cursor)（MIT，源自 LengineerC）的已知问题。

## 前提和限制

- VS Code 扩展 API 无法访问编辑器 DOM，所以必须依赖 [Custom CSS and JS Loader](https://marketplace.visualstudio.com/items?itemName=be5invis.vscode-custom-css)（`be5invis.vscode-custom-css`）把脚本注入 workbench。代价无法避免：VS Code 会提示“已损坏”，每次 VS Code 更新后需要重新执行 `Enable Custom CSS and JS`。
- 运行时脚本依赖 Monaco 的 DOM 结构（`.monaco-editor .cursor`、`.cursors-layer`、`.lines-content`、`.overflow-guard`），VS Code 改版可能导致失效，需要回归测试。

## 结构

| 文件 | 作用 |
| --- | --- |
| `package.json` | 命令 `springyCursor.enable` / `springyCursor.disable`，设置项 `springyCursor.*`，依赖 Custom CSS Loader |
| `extension.js` | 读取 `springyCursor.*` 设置，把 `runtime/springy-cursor.js` 中的 `/*__SPRINGY_CONFIG__*/` 替换成 `const CONFIG = {...}`，写到 `globalStorage/springy-cursor.js`，并把这个**不带版本号**的路径加入 `vscode_custom_css.imports` |
| `runtime/springy-cursor.js` | 注入到 workbench 的运行时：弹簧物理 + canvas 绘制 |

## 原插件的问题和对应修复

行号指 `runtime/springy-cursor.js` 当前版本（目前仍是原版逻辑）。

- [x] **配置要手改插件安装目录里的 JS，更新即丢失；注入路径带版本号，更新后失效** → 改为 VS Code 设置 + 生成到 globalStorage（M1 已完成）。
- [x] **`Remove Generated Path` 会删掉所有路径含 `cursor` / `neovide` 的导入** → 只删除自己那一条（M1 已完成）。
- [x] **空闲时也在耗电**：`requestAnimationFrame` 永不停止（L653），每帧对每个光标调用 `getBoundingClientRect` + `getComputedStyle`（L583）并写 inline style（L635、L648），反复强制重排 → 改为 `MutationObserver` 监听 `.cursors-layer` 子节点和 `style` 属性变化，有变化才启动 rAF，所有弹簧收敛后停止；每帧先集中读布局、再集中写。
- [x] **闪烁**：停止后每帧都 `setTimeout` 一次淡出（L640），动画在 50ms 内重启时旧定时器仍把画布淡出 → 只保留一个定时器句柄，重新开始动画时 `clearTimeout`。
- [x] **隐藏原生光标靠逐个写 inline opacity** → 改为在 `body` 上切换一个 class，由注入的 CSS 隐藏 `.monaco-editor .cursor`。
- [x] **HiDPI 发虚**：canvas 尺寸未乘 `devicePixelRatio`（L504、L507） → 按 dpr 设置 backing size，`ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`；监听 dpr 变化（`matchMedia('(resolution: Xdppx)')`）。
- [x] **拖尾画到其他 UI 上面**：全屏 `z-index: 9999` 且不裁剪（L497） → 每个光标绘制前 `ctx.clip()` 到所属编辑器的 `.overflow-guard` 矩形。
- [x] **新光标靠 100ms 轮询发现**（L522） → 由 MutationObserver 立即发现（分屏、多光标）。
- [x] **滚动判定靠 document `scroll` 事件**（L512），Monaco 的虚拟滚动不一定触发（待验证） → 比较 `.lines-content` 的 `top/left` 变化量，与光标位移相同时视为滚动，直接贴合不做动画。

## 新功能（修完上面之后）

- [x] `springyCursor.color` 留空时使用主题的 `--vscode-editorCursor-foreground`。
- [x] 跟随光标样式（line / block / underline）以及 VSCodeVim、VSCode Neovim 的模式切换（光标 DOM 尺寸已经反映了这些，主要是验证）。
- [x] 暴露拖尾手感参数（rank trail factors、snap）作为高级设置，或做几组预设（subtle / neovide / zed-like）。
- [x] 打字时（同一行短距离移动）可选关闭拖尾。
- [x] 选择文本时可选关闭拖尾。

## 里程碑

1. **M1 骨架（已完成）**：package.json、extension.js、设置项、稳定注入路径、只删自己的导入。运行时仍是原版逻辑，只把常量换成 `CONFIG`，并包进 IIFE 防止重复注入。
2. **M2 运行时重写（已完成）**：完成上面所有运行时修复。拆成 `Spring` / `Corner`（保留原物理模型）和 `Manager`（观察 DOM、调度、绘制）。
3. **M3 本地测试台（已完成）**：`playground/index.html` 用 npm 的 `monaco-editor` 搭一个编辑器加载运行时，用 agent-browser 截图/录屏验证：单行打字、跨行跳转、多光标、分屏、滚动、HiDPI（`set viewport 1280 720 2`）。性能指标：空闲 5 秒内 rAF 回调次数应为 0。
4. **M4 真机验证与发布**：`npx @vscode/vsce package` 打包 vsix，在真实 VS Code 里装 Custom CSS Loader 测试；写 README（安装、卸载、“已损坏”提示说明）；发布到 Marketplace / Open VSX（需要 publisher 账号）。

## M5 安装即用（已完成 · v0.2.0）

目标：去掉 Custom CSS and JS Loader 依赖，由本扩展自己注入。用户要做的只剩：安装后点一次“重启”，VS Code 每次升级后再点一次。不再需要手动 Enable / Reload，也不再弹“安装似乎已损坏”。

做不到的部分（写进 README）：注入后必须重载窗口才生效；安装目录不可写时扩展无能为力（Windows 系统级安装需要管理员权限，Linux Snap 只读，macOS 可能需要授予“App 管理”权限）。

### 设计

- **定位文件**：`vscode.env.appRoot` 下的 `out/vs/code/electron-browser/workbench/workbench.html`（新版），不存在时退回 `out/vs/code/electron-sandbox/workbench/workbench.html`（`engines` 写的是 `^1.85.0`，旧版用这个路径）。校验表在 `appRoot/product.json` 的 `checksums`，键是相对 `out/` 的路径。
- **注入方式**：运行时写成单独的 `springy-cursor.js`，放在 `workbench.html` 同目录，HTML 里只插一行 `<!-- springy-cursor --><script src="springy-cursor.js"></script>`。好处：
  - `script-src 'self'` 允许同源脚本，不用删 CSP（Custom CSS Loader 的做法据说是直接删掉 CSP，待核实）。**待验证**：Trusted Types 和 CSP 是否放行，不行再考虑往 CSP 里加脚本哈希。
  - 改设置只需要重写这个 JS 文件，HTML 和校验值都不用动。
  - 这个 JS 文件不在 `checksums` 表里，不影响完整性校验。
- **校验值**：改完 HTML 后，把 `checksums` 里 HTML 那一项更新成新文件的哈希。算法：`sha256` → base64 → 去掉末尾的 `=`（已用未改动的 `workbench.desktop.main.js` 验证过）。只改这一项，其他项保持原样。
- **备份与还原**：第一次打补丁前，把原始 HTML 和原始校验值存进 `globalStorage`，按 `product.json` 的 `commit` 区分版本。还原时写回这两样，并删掉 `springy-cursor.js`。
- **启动时自检**（`onStartupFinished`）：
  1. HTML 里没有标记（新装或 VS Code 刚升级）→ 打补丁、修校验值，然后弹“Springy Cursor 已安装，重载窗口以启用”。
  2. 有标记但 `springy-cursor.js` 和当前设置或运行时版本不一致（扩展更新、关着 VS Code 时改了设置）→ 重写 JS，弹“重载窗口以应用”。
  3. 都一致 → 什么也不做。
- **改设置**：`onDidChangeConfiguration` 时重写 JS，弹“重载窗口以应用”，按钮执行 `workbench.action.reloadWindow`，比完整重启快。**待验证**：重载窗口是否会从磁盘重新读取 `workbench.html` 和 JS；`product.json` 的校验表是否要完整重启才会重新读取（如果是，打补丁后的第一次只能提示完整重启）。
- **命令**：保留 `Springy Cursor: Enable`（手动重新打补丁）和 `Springy Cursor: Disable`（还原 HTML 和校验值），不再调用 `extension.updateCustomCSS`。
- **卸载**：在 `package.json` 的 `scripts` 里加 `vscode:uninstall`，指向一个独立的 Node 脚本，用它还原 HTML 和校验值。这个钩子里没有 `vscode` API，appRoot 需要从 `process.execPath` 推算，或者在打补丁时记到一个固定位置的文件里（**待验证**哪种可靠）。
- **出错处理**：写文件遇到 `EACCES` / `EPERM` / `EROFS` 时，弹一条说明，写清楚安装路径和对应的解决办法（以管理员身份运行一次 / 改目录权限 / Snap 不支持，换 `.deb` 或 tarball），不要反复弹。
- **从旧版迁移**：如果 `vscode_custom_css.imports` 里还有我们那条 globalStorage 路径，把它删掉，并提示用户可以执行 Custom CSS Loader 的 `Reload` 来清理它注入的旧内容。在清理之前两边可能都会注入，运行时已经用 IIFE 防止重复执行，不会画出两份拖尾。

### 步骤

- [x] 注入逻辑（未单独拆 `patcher.js`，见下方差异）：定位文件、打补丁、还原、算校验值、备份。纯 Node，不依赖 `vscode`，这样 `vscode:uninstall` 脚本也能复用。
- [x] 改写 `extension.js`：启动自检、设置变化重写 JS、Enable / Disable 命令、旧版迁移、权限出错提示。
- [x] `package.json`：删掉 `extensionDependencies`，加 `vscode:uninstall`。
- [x] 测试：真机 E2E 覆盖关键路径 跑 `patcher.js`，夹具是真实 VS Code 的 `workbench.html` 和 `product.json` 副本。验证打补丁后再还原，文件逐字节一致；补丁后算出的哈希和 VS Code 自己的算法一致（拿未改动的文件对照 `product.json` 原值）；重复打补丁不会插入第二行。
- [x] 真机验证：在真实 VS Code 里装 VSIX，确认重启后拖尾生效、没有“已损坏”通知（按通知正文文本检测，不要只靠 DOM 选择器）；改设置后重载窗口生效；Disable 后文件和校验值恢复原样；模拟升级（把 HTML 换回原版）后启动能自动补上。
- [x] 更新 README：删掉 Custom CSS Loader 相关步骤和“点不再显示”的说明，写新的安装、卸载流程和上面那些做不到的情况。

## 本地验证 M1 的方法

1. `npx @vscode/vsce package` 生成 vsix，`Extensions: Install from VSIX...` 安装（会自动要求安装 Custom CSS Loader）。
2. 首次使用先执行 `Enable Custom CSS and JS`，再执行 `Springy Cursor: Enable / Update Cursor Trail`，点击弹窗里的 Reload，重启 VS Code。
3. 修改 `springyCursor.color` 后会提示 Reload，重载后颜色生效。
4. 执行 `Springy Cursor: Disable Cursor Trail`，确认 `vscode_custom_css.imports` 里其他条目都还在。
### 实现差异与实测结果（v0.2.0）

与上面设计不同的三处，都是实现时按实测结果定的：

- **注入方式选内联 + 删 CSP，没用外链 `springy-cursor.js`。** 外链依赖 `script-src 'self'` 放行同源脚本，还牵扯 Trusted Types，属于未验证风险；而内联 + 删 CSP 是 Custom CSS and JS Loader 走通多年的做法（已核对它的 `performPatch`）。代价是改设置要重新注入，但注入是纯本地文件写，比多一个需要长期同步的 JS 文件更简单。
- **没拆 `patcher.js`。** 注入、还原、算校验值都在 `extension.js` 里（`patchWorkbench` / `unpatchWorkbench` / `syncChecksum` / `stripOwn`），因为暂时没有第二个调用方；等真要做 `vscode:uninstall` 钩子时再拆。
- **新增 `springyCursor.autoEnable`**（默认 `true`）：首次启动自动注入，用户只需点一次 `Reload Window`；手动 `Disable` 后不会再被自动打开（记在 `globalState` 里）。

实测（Windows，VS Code 1.145.2，全程不装任何其他扩展）：

- 首次启动即自动注入：`workbench.html` 31302 B、CSP 已移除、标记块在 `</body>` 前、`product.json` 校验值同步、生成 `workbench.html.springy-pristine`。
- 重启后运行时加载成功（`window.__springyCursor` 为 object）；按 ↓ 采样到 98 个粉色像素，`bbox [114,150 → 130,176]`；空闲 rAF 停止。
- 启动后 `document.body.innerText` 中不含“损坏”字样。
- `Disable` 往返：文件还原成 1568 B（与原版一致）、CSP 恢复、校验值同步回原值、pristine 备份保留；再 `Enable` 恢复注入。
- **受限模式（未信任窗口）下同样激活并注入**（旧版因为 `extensionDependencies` 依赖的 loader 没有 `capabilities.untrustedWorkspaces` 而被静默跳过）。

后续补完（v0.2.1）：

- **`vscode:uninstall` 钩子已做**（`scripts.vscode:uninstall` → `uninstall.js`）。卸载扩展时会还原 `workbench.html`（含 CSP）、重新同步 `product.json` 校验值、删掉 pristine 备份——以前直接卸载会留下注入，拖尾继续跑却没有扩展能关掉它。该钩子里没有 `vscode` API，`appRoot` 由 `patching.appRootFromExecPath(process.execPath)` 从安装根目录扫描 `<hash>/resources/app` 得到。
- **注入逻辑已拆成 `patching.js`**（纯 Node，不 import `vscode`），扩展与卸载钩子共用：`patch` / `unpatch` / `stripOwn` / `syncChecksum` / `ensurePristine` / `removePristine` / `appRootFromExecPath`。`extension.js` 只剩 vscode 相关的部分（渲染配置、命令、弹窗、`globalState`）。

- **`node:test` 单测已做**（`npm test`，`test/patching.test.js`，10 条）：打补丁的插入位置 / CSP 移除 / 校验值同步 / pristine 备份、重复打补丁幂等、还原后与原始文件逐字节一致、别人的内联脚本不被误删、没有 `workbench.html` 时返回 `unavailable`、`appRootFromExecPath` 的三种输入、`electron-sandbox` 布局同样处理，以及 `patch()` 在调用方忘记带 sentinel 时自己补上。测试全在临时目录里跑，不碰真实安装。

仍未做：

- 发布到 Marketplace / Open VSX（英文 README、图标、截图、publisher 账号）。
