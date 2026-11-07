// springy-cursor.js — 基于 LengineerC / 30d98f9b2 的 Neovide-Cursor (MIT)
(() => {
if (window.__springyCursor) return;

// 由扩展在生成注入脚本时替换为 `const CONFIG = {...};`（来自 springyCursor.* 设置）
/*__SPRINGY_CONFIG__*/
const initialCfg =
	typeof CONFIG !== "undefined" ? CONFIG : window.SPRINGY_CONFIG || {};

// 前端吸附时长 = 基础时长 × leadingSnapFactor（neovide / subtle 的取值约等于原版固定的 20ms / 15ms）
const PRESETS = {
	neovide: {
		animationLength: 0.125,
		shortAnimationLength: 0.05,
		rankTrailFactors: [1.0, 0.9, 0.5, 0.3],
		hardSnap: true,
		leadingSnapFactor: 0.16,
		leadingSnapThreshold: 0.5,
	},
	subtle: {
		animationLength: 0.08,
		shortAnimationLength: 0.03,
		rankTrailFactors: [0.85, 0.75, 0.5, 0.35],
		hardSnap: true,
		leadingSnapFactor: 0.19,
		leadingSnapThreshold: 0.5,
	},
	zed: {
		animationLength: 0.1,
		shortAnimationLength: 0.04,
		rankTrailFactors: [0.7, 0.65, 0.55, 0.45],
		hardSnap: false,
		leadingSnapFactor: 0.35,
		leadingSnapThreshold: 0.5,
	},
};

const shortMoveThreshold = 8;
const animationResetThreshold = 0.075;
const maxTrailDistanceFactor = 100;
const cursorDisappearDelay = 50;
const cursorFadeOutDuration = 0.075;
const canvasFadeTransitionCss = `opacity ${cursorFadeOutDuration}s ease-out`;
const ACTIVE_BODY_CLASS = "springy-cursor-active";

function buildRuntimeSettings(raw) {
	const presetName = raw.preset || "neovide";
	// 只有 custom 使用用户的手感参数，缺省值取 neovide；其他预设使用固定取值
	const isCustom = presetName === "custom";
	const preset = PRESETS[presetName] || PRESETS.neovide;
	const pick = (key) => (isCustom ? raw[key] ?? preset[key] : preset[key]);

	return {
		color: typeof raw.color === "string" ? raw.color.trim() : "#FFC0CB",
		opacity: raw.opacity ?? 1,
		glow: raw.glow ?? true,
		glowBlur: raw.glowBlur ?? 0.5,
		preset: presetName,
		animationLength: pick("animationLength"),
		shortAnimationLength: pick("shortAnimationLength"),
		animateOnTyping:
			raw.animateOnTyping ??
			(raw.disableWhenTyping !== undefined
				? !raw.disableWhenTyping
				: true),
		animateOnSelection:
			raw.animateOnSelection ??
			(raw.disableWhenSelecting !== undefined
				? !raw.disableWhenSelecting
				: true),
		rankTrailFactors:
			isCustom &&
			Array.isArray(raw.rankTrailFactors) &&
			raw.rankTrailFactors.length === 4
				? raw.rankTrailFactors
				: preset.rankTrailFactors,
		hardSnap: pick("hardSnap"),
		leadingSnapFactor: pick("leadingSnapFactor"),
		leadingSnapThreshold: pick("leadingSnapThreshold"),
	};
}

let settings = buildRuntimeSettings(initialCfg);

const globalCursorState = {
	lastX: null,
	lastY: null,
	lastWidth: null,
	lastHeight: null,
	lastUpdated: 0,
};

const resolveColor = (input) => {
	const s = (input || "").trim();
	const rgbMatch = s.match(
		/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i
	);
	if (rgbMatch) {
		return {
			r: parseInt(rgbMatch[1], 10) & 255,
			g: parseInt(rgbMatch[2], 10) & 255,
			b: parseInt(rgbMatch[3], 10) & 255,
			a:
				rgbMatch[4] !== undefined
					? Math.round(parseFloat(rgbMatch[4]) * 255) & 255
					: 255,
		};
	}
	let h = s.startsWith("#") ? s.slice(1).toUpperCase() : s.toUpperCase();
	if (!/^[0-9A-F]{3}([0-9A-F]{3})?([0-9A-F]{2})?$/.test(h)) {
		h = "FFC0CB";
	}
	if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	if (h.length === 6) h += "FF";
	return {
		r: parseInt(h.slice(0, 2), 16) >> 0,
		g: parseInt(h.slice(2, 4), 16) >> 0,
		b: parseInt(h.slice(4, 6), 16) >> 0,
		a: parseInt(h.slice(6, 8), 16) >> 0,
	};
};

const rgbaToCss = ({ r, g, b, a }) => `rgba(${r}, ${g}, ${b}, ${a / 255})`;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const normalize = (v) => {
	const l = Math.hypot(v.x, v.y);
	return l ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 };
};

const cursorRelativeCorners = [
	{ x: -0.5, y: -0.5 }, // 左上 (Top-Left)
	{ x: 0.5, y: -0.5 }, // 右上 (Top-Right)
	{ x: 0.5, y: 0.5 }, // 右下 (Bottom-Right)
	{ x: -0.5, y: 0.5 }, // 左下 (Bottom-Left)
];

/**
 * Spring: 二阶临界阻尼弹簧振子
 */
class Spring {
	constructor(length) {
		this.position = 0;
		this.velocity = 0;
		this.animationLength = length;
	}

	update(dt) {
		if (this.animationLength <= dt || Math.abs(this.position) < 0.001) {
			this.reset();
			return false;
		}
		const o = 4.0 / this.animationLength,
			a = this.position,
			b = this.position * o + this.velocity,
			c = Math.exp(-o * dt);
		this.position = (a + b * dt) * c;
		this.velocity = c * (-a * o - b * dt * o + b);
		return Math.abs(this.position) >= 0.01;
	}

	reset() {
		this.position = 0;
		this.velocity = 0;
	}
}

/**
 * Corner: 光标单个角点物理质点控制
 */
class Corner {
	constructor(rp) {
		this.rp = rp;
		this.cp = { x: 0, y: 0 };
		this.pd = { x: -1e5, y: -1e5 };
		this.ax = new Spring(settings.animationLength);
		this.ay = new Spring(settings.animationLength);
		this.targetDim = { width: 8, height: 18 };
	}

	getDest(c, dim) {
		return {
			x: c.x + this.rp.x * dim.width,
			y: c.y + this.rp.y * dim.height,
		};
	}

	calculateDirectionAlignment(dim, destCenter) {
		const cornerDest = this.getDest(destCenter, dim);
		const travelDir = normalize({
			x: cornerDest.x - this.cp.x,
			y: cornerDest.y - this.cp.y,
		});
		const cornerDir = normalize(this.rp);
		return travelDir.x * cornerDir.x + travelDir.y * cornerDir.y;
	}

	jump(c, dim, rank, isShortMove) {
		this.targetDim = { ...dim };
		const t = this.getDest(c, dim);
		const jv = {
			x: (t.x - this.pd.x) / dim.width,
			y: (t.y - this.pd.y) / dim.height,
		};
		const baseTime = isShortMove
			? settings.shortAnimationLength
			: settings.animationLength;
		const leadingAlignment =
			normalize(jv).x * normalize(this.rp).x +
			normalize(jv).y * normalize(this.rp).y;

		const isLeadingSnap =
			settings.hardSnap &&
			leadingAlignment > settings.leadingSnapThreshold;
		const finalFactor = isLeadingSnap
			? settings.leadingSnapFactor
			: settings.rankTrailFactors[rank] ?? 1.0;

		const len = baseTime * clamp(finalFactor, 0, 2);

		this.ax.animationLength = len;
		this.ay.animationLength = len;

		if (len > animationResetThreshold) {
			this.ax.reset();
			this.ay.reset();
		}
	}

	snap(c, dim) {
		this.targetDim = { ...dim };
		const dest = this.getDest(c, dim);
		this.cp = { ...dest };
		this.pd = { ...dest };
		this.ax.reset();
		this.ay.reset();
	}

	update(dim, c, dt, imm) {
		const dest = this.getDest(c, dim);
		if (dest.x !== this.pd.x || dest.y !== this.pd.y) {
			this.ax.position = dest.x - this.cp.x;
			this.ay.position = dest.y - this.cp.y;
			this.pd = { ...dest };
		}
		if (imm) {
			this.cp = { ...dest };
			this.ax.reset();
			this.ay.reset();
			return false;
		}
		this.ax.update(dt);
		this.ay.update(dt);
		const maxD = Math.max(dim.width, dim.height) * maxTrailDistanceFactor;
		this.ax.position = clamp(this.ax.position, -maxD, maxD);
		this.ay.position = clamp(this.ay.position, -maxD, maxD);
		this.cp.x = dest.x - this.ax.position;
		this.cp.y = dest.y - this.ay.position;
		return (
			Math.abs(this.ax.position) > 0.5 || Math.abs(this.ay.position) > 0.5
		);
	}
}

/**
 * Cursor: 单个光标的四角物理实例与绘制
 */
class Cursor {
	constructor() {
		this.dimensions = { width: 8, height: 18 };
		this.centerDest = { x: 0, y: 0 };
		this.initialized = false;
		this.jumped = false;
		this.isShortMove = false;
		this.corners = cursorRelativeCorners.map((p) => new Corner(p));
	}

	updateSize(w, h) {
		if (w > 0 && h > 0) {
			this.dimensions.width = w;
			this.dimensions.height = h;
		}
	}

	snap(x, y) {
		if (isNaN(x) || isNaN(y)) return;
		const center = {
			x: x + this.dimensions.width / 2,
			y: y + this.dimensions.height / 2,
		};
		this.centerDest = center;
		this.corners.forEach((c) => c.snap(center, this.dimensions));
		this.initialized = true;
		this.jumped = false;
	}

	move(x, y, fromSource = null) {
		if (isNaN(x) || isNaN(y)) return;
		const newCenter = {
			x: x + this.dimensions.width / 2,
			y: y + this.dimensions.height / 2,
		};
		if (!this.initialized || fromSource) {
			const src =
				fromSource ||
				(globalCursorState.lastX !== null
					? {
							x: globalCursorState.lastX,
							y: globalCursorState.lastY,
							width: globalCursorState.lastWidth,
							height: globalCursorState.lastHeight,
					  }
					: null);
			if (src && src.x !== null && src.y !== null) {
				const oldDim = {
					width:
						src.width ||
						globalCursorState.lastWidth ||
						this.dimensions.width,
					height:
						src.height ||
						globalCursorState.lastHeight ||
						this.dimensions.height,
				};
				this.corners.forEach((c) =>
					c.snap({ x: src.x, y: src.y }, oldDim)
				);
			} else {
				this.corners.forEach((c) => c.snap(newCenter, this.dimensions));
			}
			this.initialized = true;
			this.isShortMove = false;
		} else {
			const jvx =
				Math.abs(newCenter.x - this.centerDest.x) /
				Math.max(1, this.dimensions.width);
			const jvy =
				Math.abs(newCenter.y - this.centerDest.y) /
				Math.max(1, this.dimensions.height);
			this.isShortMove = jvx <= shortMoveThreshold && jvy <= 0.05;
		}

		globalCursorState.lastX = newCenter.x;
		globalCursorState.lastY = newCenter.y;
		globalCursorState.lastWidth = this.dimensions.width;
		globalCursorState.lastHeight = this.dimensions.height;
		globalCursorState.lastUpdated = Date.now();

		if (!fromSource && this.isShortMove && !settings.animateOnTyping) {
			this.snap(x, y);
			return;
		}

		this.centerDest = newCenter;
		this.jumped = true;
	}

	step(dt, immediate) {
		if (!this.initialized) return false;
		if (immediate) {
			this.jumped = false;
			this.corners.forEach((c) =>
				c.update(this.dimensions, this.centerDest, dt, true)
			);
			return false;
		}
		if (this.jumped) {
			const ranks = this.corners
				.map((c, i) => ({
					i,
					v: c.calculateDirectionAlignment(
						this.dimensions,
						this.centerDest
					),
				}))
				.sort((a, b) => a.v - b.v)
				.reduce((acc, cur, r) => {
					acc[cur.i] = r;
					return acc;
				}, []);

			this.corners.forEach((c, i) =>
				c.jump(
					this.centerDest,
					this.dimensions,
					ranks[i],
					this.isShortMove
				)
			);
			this.jumped = false;
		}

		let animating = false;
		this.corners.forEach((c) => {
			if (c.update(this.dimensions, this.centerDest, dt, false)) {
				animating = true;
			}
		});
		return animating;
	}

	draw(ctx, clipRect, colorCss, shadowColorCss) {
		if (!this.initialized) return;
		ctx.save();
		if (clipRect) {
			ctx.beginPath();
			ctx.rect(
				clipRect.left,
				clipRect.top,
				clipRect.width,
				clipRect.height
			);
			ctx.clip();
		}
		ctx.beginPath();
		ctx.moveTo(this.corners[0].cp.x, this.corners[0].cp.y);
		for (let i = 1; i < 4; i++) {
			ctx.lineTo(this.corners[i].cp.x, this.corners[i].cp.y);
		}
		ctx.closePath();
		ctx.fillStyle = colorCss;
		if (settings.glow && shadowColorCss) {
			ctx.shadowColor = shadowColorCss;
			ctx.shadowBlur =
				settings.glowBlur *
				Math.max(this.dimensions.width, this.dimensions.height);
		}
		ctx.fill();
		ctx.restore();
	}
}

/**
 * Manager: 观察 DOM、集中读写布局、管理 rAF 生命周期与 Canvas 绘制
 */
class Manager {
	constructor() {
		this.cursors = new Map(); // cursorEl -> cursorRecord
		this.observedLayers = new WeakSet();
		this.observedLinesContents = new WeakSet();
		this.activeEditor = null;
		this.rafId = null;
		this.fadeTimer = null;
		this.lastFrameTime = 0;
		this.dpr = 1;
		this.viewportWidth = 0;
		this.viewportHeight = 0;
		this.dprMediaQuery = null;
		this.onDprChange = null;
		this.finalColorCss = "rgba(255, 192, 203, 1)";
		this.shadowColorCss = "rgba(255, 192, 203, 1)";

		this.canvas = document.createElement("canvas");
		this.ctx = this.canvas.getContext("2d");
		this.boundLoop = this.loop.bind(this);

		this.refreshColors(null);
		this.init();
	}

	updateConfig(partial) {
		const merged = { ...initialCfg, ...(window.SPRINGY_CONFIG || {}), ...partial };
		window.SPRINGY_CONFIG = merged;
		settings = buildRuntimeSettings(merged);
		this.refreshColors(this.activeEditor);
	}

	get settings() {
		return settings;
	}

	refreshColors(editorEl) {
		let rawColor = settings.color;
		if (!rawColor) {
			const target = editorEl || document.documentElement;
			rawColor = getComputedStyle(target)
				.getPropertyValue("--vscode-editorCursor-foreground")
				.trim();
			if (!rawColor && target !== document.documentElement) {
				rawColor = getComputedStyle(document.documentElement)
					.getPropertyValue("--vscode-editorCursor-foreground")
					.trim();
			}
		}
		const colorObj = resolveColor(rawColor || "#FFC0CB");
		this.finalColorCss = rgbaToCss({
			...colorObj,
			a: (colorObj.a * settings.opacity) >> 0,
		});
		this.shadowColorCss = settings.glow ? this.finalColorCss : null;
	}

	init() {
		const style = document.createElement("style");
		style.textContent = `
			.monaco-editor .cursor {
				transition: none !important;
			}
			.cursor-trail {
				opacity: 0 !important;
			}
			body.${ACTIVE_BODY_CLASS} .monaco-editor .cursor {
				opacity: 0 !important;
			}
		`;
		document.head.appendChild(style);

		this.canvas.style.cssText = `
			pointer-events: none;
			position: fixed;
			top: 0;
			left: 0;
			z-index: 9999;
			opacity: 0;
			transition: none;
		`;
		document.body.appendChild(this.canvas);

		this.updateCanvasSize();
		this.observeDpr();
		window.addEventListener("resize", () => this.updateCanvasSize());

		this.layerObserver = new MutationObserver((mutations) =>
			this.onLayerMutations(mutations)
		);
		this.treeObserver = new MutationObserver((mutations) =>
			this.onTreeMutations(mutations)
		);

		this.treeObserver.observe(document.body, {
			childList: true,
			subtree: true,
		});

		document.addEventListener(
			"focusin",
			(e) => {
				const editor =
					e.target && typeof e.target.closest === "function"
						? e.target.closest(".monaco-editor")
						: null;
				if (editor && editor !== this.activeEditor) {
					this.onEditorFocusSwitch(editor);
				}
			},
			true
		);

		this.scanEditors(document.body);
	}

	updateCanvasSize() {
		const dpr = window.devicePixelRatio || 1;
		const width = window.innerWidth;
		const height = window.innerHeight;
		this.dpr = dpr;
		this.viewportWidth = width;
		this.viewportHeight = height;
		this.canvas.width = Math.round(width * dpr);
		this.canvas.height = Math.round(height * dpr);
		this.canvas.style.width = `${width}px`;
		this.canvas.style.height = `${height}px`;
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	observeDpr() {
		if (this.dprMediaQuery && this.onDprChange) {
			this.dprMediaQuery.removeEventListener("change", this.onDprChange);
		}
		const dpr = window.devicePixelRatio || 1;
		this.dprMediaQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
		this.onDprChange = () => {
			this.updateCanvasSize();
			this.observeDpr();
		};
		this.dprMediaQuery.addEventListener("change", this.onDprChange);
	}

	getInlineSig(el, linesContent) {
		const s = el.style;
		const ls = linesContent ? linesContent.style : null;
		return `${s.left},${s.top},${s.width},${s.height},${s.display},${s.transform},${ls ? ls.left : ""},${ls ? ls.top : ""}`;
	}

	scanEditors(root) {
		if (!root || typeof root.querySelectorAll !== "function") return;
		const layers = root.classList?.contains("cursors-layer")
			? [root]
			: Array.from(root.querySelectorAll(".cursors-layer"));
		let added = false;
		for (const layer of layers) {
			if (!this.observedLayers.has(layer)) {
				this.observedLayers.add(layer);
				this.layerObserver.observe(layer, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ["style"],
				});
			}
			const linesContent = layer.closest(".lines-content");
			if (linesContent && !this.observedLinesContents.has(linesContent)) {
				this.observedLinesContents.add(linesContent);
				this.layerObserver.observe(linesContent, {
					attributes: true,
					attributeFilter: ["style"],
				});
			}
			const cursorEls = layer.querySelectorAll(".cursor");
			for (const el of cursorEls) {
				if (this.registerCursorElement(el)) {
					added = true;
				}
			}
		}
		if (added) {
			this.scheduleFrame();
		}
	}

	registerCursorElement(el) {
		if (this.cursors.has(el)) return false;
		const editor = el.closest(".monaco-editor");
		const layer = el.closest(".cursors-layer");
		const overflowGuard = el.closest(".overflow-guard");
		const linesContent = el.closest(".lines-content");
		const instance = new Cursor();
		this.cursors.set(el, {
			el,
			editor,
			layer,
			overflowGuard,
			linesContent,
			instance,
			lastX: null,
			lastY: null,
			lastWidth: 0,
			lastHeight: 0,
			lastLinesLeft: linesContent
				? parseFloat(linesContent.style.left) || 0
				: 0,
			lastLinesTop: linesContent
				? parseFloat(linesContent.style.top) || 0
				: 0,
			lastSig: "",
			isAnimating: false,
			pendingEditorJump: false,
			pendingWaitDone: false,
			jumpSource: null,
		});
		return true;
	}

	setActiveEditor(editor) {
		if (this.activeEditor && this.activeEditor !== editor) {
			for (const d of this.cursors.values()) {
				if (d.editor !== editor) {
					d.isAnimating = false;
					if (d.lastX !== null && d.lastY !== null) {
						d.instance.snap(d.lastX, d.lastY);
					}
				}
			}
		}
		this.activeEditor = editor;
	}

	onEditorFocusSwitch(newEditor) {
		if (globalCursorState.lastX === null) {
			this.setActiveEditor(newEditor);
			return;
		}
		let switched = false;
		for (const data of this.cursors.values()) {
			if (data.editor === newEditor) {
				data.pendingEditorJump = true;
				data.jumpSource = {
					x: globalCursorState.lastX,
					y: globalCursorState.lastY,
					width: globalCursorState.lastWidth,
					height: globalCursorState.lastHeight,
				};
				switched = true;
			}
		}
		this.setActiveEditor(newEditor);
		if (switched) {
			this.scheduleFrame();
		}
	}

	onTreeMutations(mutations) {
		let shouldSchedule = false;
		let hasRemovals = false;
		for (const m of mutations) {
			const target = m.target;
			if (
				target.nodeType === 1 &&
				(target.classList.contains("view-lines") ||
					target.closest?.(".view-lines") ||
					target.closest?.(".minimap"))
			) {
				continue;
			}
			for (const node of m.addedNodes) {
				if (node.nodeType !== 1) continue;
				if (node.classList.contains("cursor")) {
					if (this.registerCursorElement(node)) {
						shouldSchedule = true;
					}
				} else if (
					node.classList.contains("cursors-layer") ||
					node.classList.contains("monaco-editor") ||
					node.querySelector?.(".cursors-layer")
				) {
					this.scanEditors(node);
				}
			}
			for (const node of m.removedNodes) {
				if (node.nodeType === 1) {
					hasRemovals = true;
					break;
				}
			}
		}
		if (hasRemovals) {
			for (const [el] of this.cursors) {
				if (!el.isConnected) {
					this.cursors.delete(el);
					shouldSchedule = true;
				}
			}
		}
		if (shouldSchedule) {
			this.scheduleFrame();
		}
	}

	onLayerMutations(mutations) {
		let shouldSchedule = false;
		for (const m of mutations) {
			if (m.type === "childList") {
				for (const node of m.addedNodes) {
					if (
						node.nodeType === 1 &&
						node.classList.contains("cursor")
					) {
						this.registerCursorElement(node);
						shouldSchedule = true;
					}
				}
				for (const node of m.removedNodes) {
					if (node.nodeType === 1 && this.cursors.has(node)) {
						this.cursors.delete(node);
						shouldSchedule = true;
					}
				}
			} else if (m.type === "attributes") {
				const target = m.target;
				if (target.classList.contains("cursor")) {
					let data = this.cursors.get(target);
					if (!data) {
						this.registerCursorElement(target);
						data = this.cursors.get(target);
					}
					const sig = this.getInlineSig(target, data.linesContent);
					if (sig !== data.lastSig) {
						shouldSchedule = true;
					}
				} else if (target.classList.contains("lines-content")) {
					const linesLeft = parseFloat(target.style.left) || 0;
					const linesTop = parseFloat(target.style.top) || 0;
					for (const data of this.cursors.values()) {
						if (
							data.linesContent === target &&
							(linesLeft !== data.lastLinesLeft ||
								linesTop !== data.lastLinesTop)
						) {
							shouldSchedule = true;
						}
					}
				}
			}
		}
		if (shouldSchedule) {
			this.scheduleFrame();
		}
	}

	scheduleFrame() {
		if (this.rafId !== null) return;
		this.lastFrameTime = 0;
		this.rafId = requestAnimationFrame(this.boundLoop);
	}

	showCanvasAndHideNative() {
		if (this.fadeTimer !== null) {
			clearTimeout(this.fadeTimer);
			this.fadeTimer = null;
		}
		this.canvas.style.transition = "none";
		this.canvas.style.opacity = "1";
		document.body.classList.add(ACTIVE_BODY_CLASS);
	}

	revealNativeAndFadeCanvas() {
		document.body.classList.remove(ACTIVE_BODY_CLASS);
		if (this.canvas.style.opacity === "1" && this.fadeTimer === null) {
			this.fadeTimer = setTimeout(() => {
				this.fadeTimer = null;
				this.canvas.style.transition = canvasFadeTransitionCss;
				this.canvas.style.opacity = "0";
			}, cursorDisappearDelay);
		}
	}

	loop(now) {
		this.rafId = null;
		const dt =
			this.lastFrameTime > 0
				? clamp((now - this.lastFrameTime) / 1000, 0.001, 1 / 30)
				: 1 / 60;
		this.lastFrameTime = now;

		// ====================================================================
		// PHASE 1: 集中读布局 (Batch Read Layout)
		// ====================================================================
		if (!settings.color) {
			this.refreshColors(this.activeEditor);
		}

		const guardRects = new Map();
		const linesOffsets = new Map();
		const measurements = [];

		for (const [el, data] of this.cursors) {
			if (!el.isConnected) {
				this.cursors.delete(el);
				continue;
			}
			if (data.overflowGuard && !guardRects.has(data.overflowGuard)) {
				guardRects.set(
					data.overflowGuard,
					data.overflowGuard.getBoundingClientRect()
				);
			}
			if (data.linesContent && !linesOffsets.has(data.linesContent)) {
				linesOffsets.set(data.linesContent, {
					left: parseFloat(data.linesContent.style.left) || 0,
					top: parseFloat(data.linesContent.style.top) || 0,
				});
			}
			const rect = el.getBoundingClientRect();
			const s = el.style;
			const isDisplayed =
				s.display !== "none" &&
				!s.transform.includes("-10000px") &&
				rect.width > 0 &&
				rect.height > 0;
			const hasSelection =
				data.layer?.classList.contains("has-selection") || false;
			const sig = this.getInlineSig(el, data.linesContent);
			measurements.push({
				data,
				rect,
				isDisplayed,
				hasSelection,
				sig,
				clipRect: data.overflowGuard
					? guardRects.get(data.overflowGuard)
					: null,
				linesOffset: data.linesContent
					? linesOffsets.get(data.linesContent)
					: { left: 0, top: 0 },
			});
		}

		// ====================================================================
		// PHASE 2: 物理状态更新 (Physics Update)
		// ====================================================================
		let isAnyAnimating = false;
		let needsFollowUpFrame = false;

		for (const m of measurements) {
			const { data, rect, isDisplayed, hasSelection, sig, linesOffset } =
				m;
			data.lastSig = sig;

			const dLinesLeft = linesOffset.left - data.lastLinesLeft;
			const dLinesTop = linesOffset.top - data.lastLinesTop;
			data.lastLinesLeft = linesOffset.left;
			data.lastLinesTop = linesOffset.top;

			if (!isDisplayed) {
				data.isAnimating = false;
				continue;
			}

			// 首次发现光标
			if (!data.instance.initialized) {
				data.instance.updateSize(rect.width, rect.height);
				const isSecondary =
					data.el.classList.contains("cursor-secondary");
				const isEditorFocused =
					data.editor?.classList.contains("focused") ||
					data.editor?.contains(document.activeElement);
				const shouldAnimateFromGlobal =
					globalCursorState.lastX !== null &&
					(isSecondary ||
						(isEditorFocused &&
							this.activeEditor &&
							this.activeEditor !== data.editor));

				if (shouldAnimateFromGlobal) {
					data.instance.move(rect.left, rect.top, {
						x: globalCursorState.lastX,
						y: globalCursorState.lastY,
						width: globalCursorState.lastWidth,
						height: globalCursorState.lastHeight,
					});
					this.setActiveEditor(data.editor);
				} else {
					data.instance.snap(rect.left, rect.top);
					if (isEditorFocused || globalCursorState.lastX === null) {
						this.setActiveEditor(data.editor);
						globalCursorState.lastX = rect.left + rect.width / 2;
						globalCursorState.lastY = rect.top + rect.height / 2;
						globalCursorState.lastWidth = rect.width;
						globalCursorState.lastHeight = rect.height;
						globalCursorState.lastUpdated = Date.now();
					}
				}
				data.lastX = rect.left;
				data.lastY = rect.top;
				data.lastWidth = rect.width;
				data.lastHeight = rect.height;
				data.pendingEditorJump = false;
			} else {
				const dx = rect.left - data.lastX;
				const dy = rect.top - data.lastY;
				const sizeChanged =
					rect.width !== data.lastWidth ||
					rect.height !== data.lastHeight;
				const hasMoved =
					Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01 || sizeChanged;

				// 比较 .lines-content 的 top/left 变化量，与光标位移相同时视为滚动
				const isScrollMove =
					(dLinesLeft !== 0 || dLinesTop !== 0) &&
					Math.abs(dx - dLinesLeft) <= 1.5 &&
					Math.abs(dy - dLinesTop) <= 1.5;

				// 滚动时或禁用选择拖尾且处于选中状态时，直接贴合不做动画
				if (
					isScrollMove ||
					(hasMoved && hasSelection && !settings.animateOnSelection)
				) {
					data.instance.updateSize(rect.width, rect.height);
					data.instance.snap(rect.left, rect.top);
					data.lastX = rect.left;
					data.lastY = rect.top;
					data.lastWidth = rect.width;
					data.lastHeight = rect.height;
					if (data.editor === this.activeEditor) {
						globalCursorState.lastX = rect.left + rect.width / 2;
						globalCursorState.lastY = rect.top + rect.height / 2;
						globalCursorState.lastWidth = rect.width;
						globalCursorState.lastHeight = rect.height;
					}
					data.isAnimating = false;
					continue;
				}

				if (data.pendingEditorJump) {
					if (hasMoved || data.pendingWaitDone) {
						data.instance.updateSize(rect.width, rect.height);
						data.instance.move(
							rect.left,
							rect.top,
							data.jumpSource
						);
						data.lastX = rect.left;
						data.lastY = rect.top;
						data.lastWidth = rect.width;
						data.lastHeight = rect.height;
						data.pendingEditorJump = false;
						data.pendingWaitDone = false;
					} else {
						data.pendingWaitDone = true;
						needsFollowUpFrame = true;
					}
				} else if (hasMoved) {
					const crossEditorSource =
						this.activeEditor &&
						this.activeEditor !== data.editor &&
						globalCursorState.lastX !== null
							? {
									x: globalCursorState.lastX,
									y: globalCursorState.lastY,
									width: globalCursorState.lastWidth,
									height: globalCursorState.lastHeight,
							  }
							: null;
					this.setActiveEditor(data.editor);
					data.instance.updateSize(rect.width, rect.height);
					data.instance.move(rect.left, rect.top, crossEditorSource);
					data.lastX = rect.left;
					data.lastY = rect.top;
					data.lastWidth = rect.width;
					data.lastHeight = rect.height;
				}
			}

			const anim = data.instance.step(dt, false);
			data.isAnimating = anim;
			if (anim) {
				isAnyAnimating = true;
			}
		}

		// ====================================================================
		// PHASE 3: 集中写 Canvas 与 DOM class (Batch Write)
		// ====================================================================
		this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		this.ctx.clearRect(0, 0, this.viewportWidth, this.viewportHeight);

		if (isAnyAnimating || this.canvas.style.opacity === "1") {
			for (const m of measurements) {
				const { data, isDisplayed, clipRect } = m;
				if (!isDisplayed || !data.instance.initialized) continue;
				if (data.editor === this.activeEditor) {
					data.instance.draw(
						this.ctx,
						clipRect,
						this.finalColorCss,
						this.shadowColorCss
					);
				}
			}
		}

		if (isAnyAnimating) {
			this.showCanvasAndHideNative();
			this.rafId = requestAnimationFrame(this.boundLoop);
		} else {
			this.revealNativeAndFadeCanvas();
			if (needsFollowUpFrame) {
				this.rafId = requestAnimationFrame(this.boundLoop);
			}
		}
	}
}

// Custom CSS and JS Loader 把脚本内联到 <head>，此时 document.body 还不存在
const start = () => {
	if (!window.__springyCursor) window.__springyCursor = new Manager();
};
if (document.body) start();
else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
