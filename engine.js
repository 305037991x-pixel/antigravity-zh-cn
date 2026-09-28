/* 引擎.js — Antigravity 界面汉化引擎（在页面内运行，由 注入.js 通过 CDP 注入）
 *
 * 设计要点
 * 1. 只改「文本节点的值」和 placeholder/title/aria-label 属性，不动 DOM 结构，
 *    避免把 React 的 fiber 树改坏（最坏情况刷新页面即恢复）。
 * 2. 精确整串匹配：文本折叠空白后必须与词条完全一致才翻译，
 *    所以用户的提问、文件名、代码不会被误翻。
 * 3. 保护区域（输入框、编辑器、代码块、已发送的用户消息）整块跳过。
 * 4. 幂等：自己写进去的译文会被记录，MutationObserver 再触发也不会二次翻译。
 *
 * 依赖注入进来的两个全局变量（由 注入.js 先写入）：
 *   window.__AG_ZH_DICT__   词条表 { "Settings": "设置", ... }
 *   window.__AG_ZH_RULES__  正则规则 [ ["^Version (.+)$", "版本 $1"], ... ]
 */
(() => {
  let RULES = (window.__AG_ZH_RULES__ || []).map(([p, f]) => [new RegExp(p), f]);
  const HASH = window.__AG_ZH_HASH__ || '';   // 词典指纹，用于判断"词典变了没"

  // 整块跳过的区域：用户输入 / 代码 / 已发送消息
  const SKIP = [
    'textarea', 'input', 'select',
    '[contenteditable=""]', '[contenteditable="true"]',
    '[data-ag-no-l10n]',                 // 自定义豁免：给任意容器加这个属性即整块不翻译
    '.monaco-editor', 'pre', 'code', 'script', 'style', 'svg', 'canvas',
    '[data-testid="user-input-step"]',   // Antigravity 给用户消息打的标记
  ].join(',');

  // 折叠空白 + 统一弯引号，避免同一句话因空格/引号差异漏翻
  const keyOf = (s) => s
    .replace(/[\s\u00a0]+/g, ' ')
    .trim()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');

  const map = new Map();
  function rebuild() {                     // 词典热更新：重新读全局词典，无需刷新页面
    map.clear();
    for (const k of Object.keys(window.__AG_ZH_DICT__ || {})) map.set(keyOf(k), window.__AG_ZH_DICT__[k]);
    RULES = (window.__AG_ZH_RULES__ || []).map(([p, f]) => [new RegExp(p), f]);
    return map.size;
  }
  rebuild();

  function lookup(k) {
    if (map.has(k)) return map.get(k);
    for (const [re, rep] of RULES) if (re.test(k)) return k.replace(re, rep);
    return null;
  }

  const written = new WeakMap(); // 文本节点 -> 我们写进去的值
  const log = [];                // [节点, 原值]，用于一键还原
  let count = 0;

  function doText(node) {
    const raw = node.nodeValue;
    const k = keyOf(raw);
    if (!k) return;
    if (written.get(node) === raw) return;            // 已是我们写下的译文
    if (lookup(k) == null) return;                    // 没词条，不碰
    const el = node.parentElement;
    if (el && el.closest(SKIP)) return;
    const lead = raw.match(/^\s*/)[0], tail = raw.match(/\s*$/)[0];
    const out = lead + lookup(k) + tail;
    log.push([node, raw]);
    written.set(node, out);
    node.nodeValue = out;
    count++;
  }

  // 「Command Palette」这类标签被拆成多个文本节点，按元素合并后再匹配
  function doElement(el) {
    if (el.closest(SKIP)) return;
    const kids = Array.from(el.childNodes);
    if (kids.length < 2) return;
    const texts = kids.filter((n) => n.nodeType === 3);
    if (texts.length < 2) return;                                   // 至少两个文本节点才需要合并
    if (kids.some((n) => n.nodeType === 1 && n.nodeName !== 'BR')) return;
    const zh = lookup(keyOf(el.textContent));
    if (zh == null) return;
    let used = false;
    for (const t of texts) {
      if (used) { log.push([t, t.nodeValue]); written.set(t, ''); t.nodeValue = ''; count++; continue; }
      if (keyOf(t.nodeValue) === '') continue;
      log.push([t, t.nodeValue]); written.set(t, zh); t.nodeValue = zh; used = true; count++;
    }
  }

  function doAttrs(root) {
    const els = [];
    if (root.nodeType === 1) els.push(root);
    if (root.querySelectorAll) els.push(...root.querySelectorAll('[placeholder],[title],[aria-label]'));
    for (const el of els) {
      if (el.closest('[data-ag-no-l10n]')) continue;
      for (const a of ['placeholder', 'title', 'aria-label']) {
        const v = el.getAttribute(a);
        if (!v) continue;
        const zh = lookup(keyOf(v));
        if (zh == null) continue;
        el.setAttribute(a, zh); count++;
      }
    }
  }

  function pass(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    if (root.nodeType === 1 && root.closest(SKIP)) return;
    doAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = tw.nextNode())) doText(n);
    if (root.querySelectorAll) for (const el of root.querySelectorAll('*')) doElement(el);
  }

  // MutationObserver：界面是异步渲染的，新节点进来就再跑一遍
  const dirty = new Set();
  let scheduled = false;
  function flush() {
    scheduled = false;
    const items = [...dirty];
    dirty.clear();
    for (const it of items) pass(it === document ? document.body : it);
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    // 用 setTimeout 而不是 requestAnimationFrame：Antigravity 窗口被遮挡/最小化时
    // rAF 会被 Chromium 暂停，导致新弹出的面板不翻译。setTimeout 会照常触发。
    setTimeout(flush, 50);
  }

  const obs = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') dirty.add(r.target.parentElement || document.body);
      else if (r.type === 'childList') r.addedNodes.forEach((n) => dirty.add(n));
      else dirty.add(r.target);
    }
    schedule();
  });

  if (window.__AG_ZH__) {
    // 二次注入：**必须让旧实例自更新**。
    // 踩过的坑：新注入的这份代码有自己的 map/observer，但页面里真正在监听 DOM 的是旧实例，
    // 如果只是自己 pass() 一遍，后续新增节点仍会被旧词典翻译 —— 表现为"改了词条没生效"。
    const old = window.__AG_ZH__;
    if (typeof old.rebuild !== 'function') {
      return 'stale';                 // 旧实例太老，热更新不了，交给注入器刷新页面
    }
    old.rebuild();                    // 旧实例重新读 window.__AG_ZH_DICT__ / RULES
    old.refresh();
    return 'hot-updated:' + old.dictSize;
  }

  pass(document.body);
  obs.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label'],
  });
  schedule();

  // 兜底：有些节点是「原位改文本」而非新增节点（MutationObserver 偶有漏网），
  // 每 3 秒整页补扫一遍；窗口可见时才跑，避免后台空转。
  setInterval(() => { if (!document.hidden) pass(document.body); }, 3000);

  window.__AG_ZH__ = {
    hash: HASH,
    get dictSize() { return map.size; },
    applied: () => count,
    rebuild,
    refresh: () => { pass(document.body); return count; },
    restore: () => {                      // 还原成英文（节点可能已被 React 换掉，这里尽力还原）
      for (const [node, prev] of log) { try { node.nodeValue = prev; } catch (e) {} }
      count = 0;
      return 'restored';
    },
  };
  return 'injected:' + map.size + ' entries';
})();
