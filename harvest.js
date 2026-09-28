/* harvest.js — 在页面里跑：逐个打开设置分页，收集「还没被翻译」的英文文案
 * 用法：node cdp.js run harvest.js > 未翻译.txt
 * 说明：已翻译的字符串会被过滤掉（拿 __AG_ZH_DICT__ 的值做排除表），
 *       所以输出就是「词典还缺什么」。 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dictVals = new Set(Object.values(window.__AG_ZH_DICT__ || {}));

  // 先把设置面板打开（找"设置"按钮，找不到就找 Settings）
  let open = [...document.querySelectorAll('button,[role=button],a')]
    .find((e) => e.textContent.trim() === '设置' || e.textContent.trim() === 'Settings');
  if (open) { open.click(); await sleep(1200); }

  const labels = ['常规', '应用', '外观', '模型', '自定义', '浏览器', '不在项目中', '对话', '快捷键', '账号', '提供反馈'];
  const missing = new Set();

  const collect = () => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const t = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (!t || t.length > 110) continue;
      if (dictVals.has(t)) continue;          // 已汉化
      if (!/[A-Za-z]/.test(t)) continue;      // 没字母的多半是数字/符号
      missing.add(t);
    }
  };

  for (const L of labels) {
    const el = [...document.querySelectorAll('button,[role=button],[role=tab],a,li,div')]
      .find((e) => e.textContent.trim() === L && e.offsetParent !== null && e.children.length <= 2);
    if (!el) continue;
    el.click();
    await sleep(1100);
    collect();
  }
  return JSON.stringify({ count: missing.size, items: [...missing].sort() }, null, 1);
})();
