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

## 工作原理与完整性校验

VS Code 扩展 API 不允许直接操作编辑器 DOM，而光标拖尾必须画在编辑器视口之外，所以只能修改安装目录里的 `workbench.html`。本扩展**自己完成这次注入，不依赖任何第三方插件**：

- 注入内容以 `<!-- !! SPRINGY-CURSOR-START !! -->` / `END` 标记包裹，脚本内联（不是外链），因此改设置后需要重新注入一次。
- 首次注入前会把原始 `workbench.html` 备份为 `workbench.html.springy-pristine`；`Disable Cursor Trail` 会据此完整还原（连 `Content-Security-Policy` 一起）。
- **“Code 安装似乎已损坏”提示已被自动消除。** VS Code 启动时会校验自身文件的 sha256（记录在 `product.json` 的 `checksums` 里），注入会改动 `workbench.html` 导致哈希不符。本扩展在每次注入/还原后**自动把 `product.json` 中对应的校验值更新为文件真实哈希**，校验重新一致，提示不再出现。
- 若 VS Code 装在需要管理员权限的目录（如 `C:\Program Files`），写 `product.json` 会失败；此时提示仍会出现，点击齿轮选 **“不再显示”**（`Don't Show Again`）即可，功能不受影响。
- **VS Code 版本更新会自动自愈**：更新会换掉安装目录（目录名带 commit 短哈希）、重置 `workbench.html`；扩展每次启动都会检查，发现补丁丢失就自动重新注入并同步校验值，只需按提示重启一次窗口。
- **受限模式（Restricted Mode）下同样生效**：已声明 `capabilities.untrustedWorkspaces`，未信任的窗口里也能正常激活与注入（它只改本机编辑器界面，不读取工作区内容）。
- 从旧版本（依赖 Custom CSS and JS Loader）升级时，会自动清理 `vscode_custom_css.imports` 里遗留的那条导入，避免重复注入。

## 安装与启用

1. 安装本扩展（**无需安装任何其他插件**）。
2. 首次启动时扩展自动完成全部配置：注入运行时、同步完整性校验值。
3. 按弹窗提示点击一次 **`Reload Window`**，即可看到效果。

> 不希望自动配置？把 `springyCursor.autoEnable` 设为 `false`，改用命令面板的 `Springy Cursor: Enable / Update Cursor Trail` 手动启用。

## 配置项

在 VS Code 设置中搜索 `springyCursor` 修改后，按弹窗提示 **`Reload Window`** 即可生效：

| 设置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `springyCursor.autoEnable` | `boolean` | `true` | 首次启动自动完成注入，并在 VS Code 更新后自动重新打补丁 |
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

1. 在命令面板执行 **`Springy Cursor: Disable Cursor Trail`**：从 `workbench.html` 中移除本扩展的注入块（其他自定义 CSS/JS 一律不动），并还原校验值。
2. 按提示点击 **`Reload Window`**。

> 直接在扩展面板卸载时也会自动清理：还原 `workbench.html`（含 CSP）、同步校验值、删除 pristine 备份，不会留下一个还在跑却没人能关的拖尾。
3. 在扩展面板卸载 **Springy Cursor**。

## 本地开发与测试

- 本地测试台：`playground/index.html` 基于 `monaco-editor` 提供单行打字、跨行跳转、多光标、分屏跳转、滚动贴合、选区跳转及空闲 5 秒 `rAF` 计数验证。
- 打包 VSIX：
  ```bash
  npx @vscode/vsce package
  ```

## 许可证

[MIT](./LICENSE)
