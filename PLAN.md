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

## 本地验证 M1 的方法

1. `npx @vscode/vsce package` 生成 vsix，`Extensions: Install from VSIX...` 安装（会自动要求安装 Custom CSS Loader）。
2. 首次使用先执行 `Enable Custom CSS and JS`，再执行 `Springy Cursor: Enable / Update Cursor Trail`，点击弹窗里的 Reload，重启 VS Code。
3. 修改 `springyCursor.color` 后会提示 Reload，重载后颜色生效。
4. 执行 `Springy Cursor: Disable Cursor Trail`，确认 `vscode_custom_css.imports` 里其他条目都还在。
