# Springy Cursor

Neovide / Zed 风格的 VS Code 弹簧光标拖尾扩展，源自 [LengineerC / 30d98f9b2 的 Neovide-Cursor](https://github.com/30d98f9b2/Neovide-Cursor)（MIT），重写了运行时以解决空闲耗电、闪烁、HiDPI 模糊、越界绘制和配置丢失等问题。

## 特性

- **四角阻尼弹簧物理模型**：光标四个角点独立受临界阻尼弹簧驱动，根据移动方向对齐度动态分级拉伸与收缩。
- **零空闲功耗**：基于 `MutationObserver` 按需唤醒 `requestAnimationFrame`，所有弹簧收敛后完全停止循环；每帧读写分离，避免强制同步重排。
- **HiDPI 清晰渲染**：自动跟随 `devicePixelRatio` 缩放画布并监听分辨率变化。
- **严格编辑器边界裁剪**：绘制前裁剪到所属编辑器的 `.overflow-guard`，拖尾与发光不会溢出到侧边栏、标签栏或分屏分隔线上。
- **虚拟滚动贴合**：对比 `.lines-content` 位移与光标位移，滚动时直接贴合，不产生误拖尾。
- **多光标与分屏跳转**：即时感知新增光标（多光标）和跨分屏焦点切换。
- **丰富的自定义设置**：支持跟随主题光标色（`--vscode-editorCursor-foreground`）、预设手感（`neovide` / `subtle` / `zed` / `custom`）、打字时关闭拖尾、选择文本时关闭拖尾，以及自动适配 `line` / `block` / `underline` 光标样式（含 VSCodeVim / VSCode Neovim 模式切换）。

## 前置依赖与“不受支持 / 已损坏”提示说明

由于 VS Code 扩展 API 不允许直接操作编辑器 DOM，本扩展依赖 [Custom CSS and JS Loader (`be5invis.vscode-custom-css`)](https://marketplace.visualstudio.com/items?itemName=be5invis.vscode-custom-css) 将运行时脚本注入 VS Code Workbench。

- 启用后，VS Code 启动时可能会提示 **“Code 安装似乎已损坏，请重新安装”**（`Your Code installation appears to be corrupt. Please reinstall.`）。这是修改 Workbench HTML 的正常现象，点击提示框齿轮选择 **“不再显示”**（`Don't Show Again`）即可。
- 每次 **VS Code 版本更新**后，Workbench 文件会被重置，需重新执行一次 `Enable Custom CSS and JS`（或 `Reload Custom CSS and JS`）并重启 VS Code。
- 本扩展将生成的运行时脚本存放在不带扩展版本号的 `globalStorage` 目录中，因此 **Springy Cursor 自身更新时不会导致注入路径失效**。

## 安装与启用

1. 安装本扩展（会自动提示或要求安装依赖 `be5invis.vscode-custom-css`）。
2. 按 `Ctrl+Shift+P`（macOS 为 `Cmd+Shift+P`）打开命令面板：
   - 首次使用 Custom CSS and JS Loader 时，先执行 **`Enable Custom CSS and JS`**。
   - 执行 **`Springy Cursor: Enable / Update Cursor Trail`**。
3. 在弹出的提示中点击 **`Reload Custom CSS and JS`**，然后重启 VS Code 使注入生效。

## 配置项

在 VS Code 设置中搜索 `springyCursor` 修改后，点击弹窗中的 **`Reload Custom CSS and JS`** 即可生效：

| 设置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `springyCursor.color` | `string` | `"#FFC0CB"` | 拖尾颜色（`#RGB`、`#RRGGBB`、`#RRGGBBAA`）。**留空 `""` 时自动使用当前主题的 `--vscode-editorCursor-foreground`** |
| `springyCursor.opacity` | `number` | `1` | 拖尾不透明度（`0` ~ `1`） |
| `springyCursor.glow` | `boolean` | `true` | 是否绘制发光阴影 |
| `springyCursor.glowBlur` | `number` | `0.5` | 发光模糊半径（光标尺寸的倍数） |
| `springyCursor.preset` | `string` | `"neovide"` | 手感预设：`neovide`（经典高弹性）、`subtle`（短促克制）、`zed`（平滑紧致，无前端硬吸附）、`custom`（自定义高级参数） |
| `springyCursor.animationLength` | `number` | `0.125` | 远距离跳转动画时长（秒），仅 `custom` 预设生效 |
| `springyCursor.shortAnimationLength` | `number` | `0.05` | 同行短距离移动（如打字）动画时长（秒），仅 `custom` 预设生效 |
| `springyCursor.animateOnTyping` | `boolean` | `true` | 打字（同行短距离移动）时是否启用拖尾 |
| `springyCursor.animateOnSelection` | `boolean` | `true` | 选择文本时是否启用拖尾 |
| `springyCursor.rankTrailFactors` | `number[]` | `[1, 0.9, 0.5, 0.3]` | 四个角点从最滞后（rank 0）到最领先（rank 3）的时长倍率，仅 `custom` 预设生效 |
| `springyCursor.hardSnap` | `boolean` | `true` | 移动方向前端角点是否快速吸附，仅 `custom` 预设生效 |
| `springyCursor.leadingSnapFactor` | `number` | `0.16` | 前端角点吸附时长倍率，仅 `custom` 预设生效 |
| `springyCursor.leadingSnapThreshold` | `number` | `0.5` | 判定为前端角点的方向对齐度阈值（`0` ~ `1`），仅 `custom` 预设生效 |

## 禁用与卸载

1. 在命令面板执行 **`Springy Cursor: Disable Cursor Trail`**（仅移除本扩展在 `vscode_custom_css.imports` 中注册的那一条路径，不会影响你的其他自定义 CSS/JS 导入）。
2. 根据提示点击 **`Reload Custom CSS and JS`** 并重启 VS Code。
3. 在扩展面板卸载 **Springy Cursor**。

## 本地开发与测试

- 本地测试台：`playground/index.html` 基于 `monaco-editor` 提供单行打字、跨行跳转、多光标、分屏跳转、滚动贴合、选区跳转及空闲 5 秒 `rAF` 计数验证。
- 打包 VSIX：
  ```bash
  npx @vscode/vsce package
  ```

## 许可证

[MIT](./LICENSE)
