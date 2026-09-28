#!/usr/bin/env node
/**
 * inject.js — Antigravity 运行时汉化注入器（零依赖，不改任何安装文件）
 *
 *   node inject.js          附加到正在运行的 Antigravity，注入并持续守护（新开窗口/刷新会自动补注入）
 *   node inject.js --once    只注入一次就退出
 *   node inject.js --launch  应用没运行就自动把它拉起来再注入（配合启动器使用）
 *   node inject.js --restore 还原成英文（并刷新页面）
 *   node inject.js --port 9222  指定调试端口
 *
 * 前提：Antigravity 桌面版启动时已自带 remote-debugging-port（本机 DevToolsActivePort 文件里有端口号），
 *       所以直接双击运行本脚本即可，无需带参数重启应用。
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const HERE = __dirname;
const dictPath = path.join(HERE, 'dict.json');
const enginePath = path.join(HERE, 'engine.js');

const argv = process.argv.slice(2);
const ONCE = argv.includes('--once');
const RESTORE = argv.includes('--restore');
const LAUNCH = argv.includes('--launch');        // 端口没起来就自己拉起 Antigravity
const portIdx = argv.indexOf('--port');
const PORT_ARG = portIdx >= 0 ? parseInt(argv[portIdx + 1], 10) : null;

const APP_EXE = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'antigravity', 'Antigravity.exe');

// 正则规则：[正则, 替换]（用于版本号这类动态文案）
const RULES = [
  ['^Version (.+)$', '版本 $1'],
  ['^(\\d+) Files Changed$', '已更改文件 $1'],
  ['^Show (\\d+) breakdowns$', '展开 $1 项明细'],
  ['^Send feedback as (.+)$', '以 $1 身份发送反馈'],
  ['^(.+)% of the customization budget is available\\.$', '自定义预算剩余 $1%。'],
  ['^(\\d+) of (\\d+)$', '$1 / $2'],
];

function findPort() {
  if (PORT_ARG) return PORT_ARG;
  const f = path.join(process.env.APPDATA || '', 'Antigravity', 'DevToolsActivePort');
  if (fs.existsSync(f)) return parseInt(fs.readFileSync(f, 'utf8').split('\n')[0], 10);
  return 9222;
}

function getJSON(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () => resolve({
      async call(method, params) {
        const myId = ++id;
        return new Promise((res, rej) => {
          // 页面重载会让 WS 静默关闭，必须有超时兜底，否则整个守护循环会卡死
          const timer = setTimeout(() => {
            pending.delete(myId);
            rej(new Error('CDP 调用超时(20s): ' + method));
          }, 20000);
          pending.set(myId, {
            res: (v) => { clearTimeout(timer); res(v); },
            rej: (e) => { clearTimeout(timer); rej(e); },
          });
          ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
        });
      },
      close: () => ws.close(),
    }));
    ws.addEventListener('close', () => {
      for (const [, p] of pending) p.rej(new Error('WS 已关闭'));
      pending.clear();
    });
    ws.addEventListener('error', () => reject(new Error('无法连接调试端口')));
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    });
  });
}

async function evalOn(wsUrl, expression) {
  const c = await connect(wsUrl);
  try {
    const r = await c.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result && r.result.value;
  } finally { c.close(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
  const engine = fs.readFileSync(enginePath, 'utf8');
  // 词典指纹：词典/规则一改，页面里的旧引擎会自己热更新；旧到不支持热更新就刷新页面重注入
  const HASH = crypto.createHash('sha1')
    .update(JSON.stringify(dict) + JSON.stringify(RULES)).digest('hex').slice(0, 12);
  const preload = `window.__AG_ZH_DICT__=${JSON.stringify(dict)};`
    + `window.__AG_ZH_RULES__=${JSON.stringify(RULES)};`
    + `window.__AG_ZH_HASH__=${JSON.stringify(HASH)};`;

  // 探测端口是否活着；带 --launch 就负责把应用拉起来并等它就绪
  let port = findPort();
  const alive = async () => {
    port = findPort();                       // 每次重读：调试端口是动态分配的，可能变
    try { await getJSON(port, '/json/version'); return true; } catch (e) { return false; }
  };
  if (!(await alive())) {
    if (!LAUNCH) {
      console.error(`[x] 连不上 Antigravity 调试端口 ${port}。请先打开 Antigravity 桌面版（或加 --launch 让本脚本代劳）。`);
      process.exit(1);
    }
    if (!fs.existsSync(APP_EXE)) {
      console.error(`[x] 找不到应用：${APP_EXE}`);
      process.exit(1);
    }
    console.log('[*] Antigravity 未运行，正在启动…');
    spawn(APP_EXE, [], { detached: true, stdio: 'ignore' }).unref();
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { await sleep(1000); ok = await alive(); }
    if (!ok) { console.error('[x] 等待 60 秒仍未就绪，放弃。'); process.exit(1); }
    await sleep(1500);                        // 给界面一点渲染时间
  }

  const done = new Set();          // 已注入的 targetId（导航后 target 会变，自动重注入）
  let round = 0;
  console.log(`[*] 已连接调试端口 ${port}，词条 ${Object.keys(dict).length} 条` + (RESTORE ? '（还原模式）' : ''));

  for (;;) {
    round++;
    const p2 = findPort();                    // 应用重启会换端口，发现变化就重新认一遍
    if (p2 !== port) { port = p2; done.clear(); console.log(`[i] 调试端口变化 -> ${port}`); }
    const list = await getJSON(port, '/json/list').catch(() => []);
    const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.startsWith('devtools://'));
    for (const t of pages) {
      const key = t.id + '@' + t.url;
      if (!RESTORE && done.has(key)) continue;
      try {
        if (RESTORE) {
          await evalOn(t.webSocketDebuggerUrl, 'window.__AG_ZH__&&window.__AG_ZH__.restore();location.reload();');
          console.log(`[√] 已还原 ${t.url}`);
        } else {
          let r = await evalOn(t.webSocketDebuggerUrl, `${preload}${engine}`);
          if (r === 'stale') {          // 页面里的引擎版本太老，热更新不了 → 刷新后重注入
            console.log('[*] 页面内引擎过旧，刷新后重新注入…');
            await evalOn(t.webSocketDebuggerUrl, 'location.reload()').catch(() => {});
            await sleep(3500);
            r = await evalOn(t.webSocketDebuggerUrl, `${preload}${engine}`).catch((e) => '刷新后注入失败: ' + e.message);
          }
          console.log(`[√] 注入 ${t.url} → ${r}`);
        }
        done.add(key);
      } catch (e) {
        console.log(`[!] ${t.url} 注入失败：${e.message}`);
      }
    }
    if (ONCE || RESTORE) break;
    if (round % 15 === 0) console.log(`[*] 守护中…（已注入 ${done.size} 个页面）`);
    await sleep(2000);
  }
  console.log('[完成]');
})().catch((e) => { console.error('[错误] ' + e.message); process.exit(1); });
