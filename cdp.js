#!/usr/bin/env node
/**
 * cdp.js — 零依赖 CDP 客户端（Node 22+，用内建 WebSocket）
 *
 * 用法：
 *   node cdp.js list  [port]
 *   node cdp.js text  [port]                 # 导出页面可见文本（按行去重）
 *   node cdp.js eval  [port] "<js表达式>"     # 在页面里求值并回传结果
 *   node cdp.js shot  [port] <out.png>       # 截图
 *
 * 端口默认从 %APPDATA%\Antigravity\DevToolsActivePort 读；也可显式给。
 * 原理：Antigravity 启动时已开 remote-debugging-port，我们从外部通过
 *       Chrome DevTools Protocol 连接页面，注入 JS —— 不碰任何安装文件。
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

function defaultPort() {
  const p = path.join(process.env.APPDATA || '', 'Antigravity', 'DevToolsActivePort');
  if (fs.existsSync(p)) return parseInt(fs.readFileSync(p, 'utf8').split('\n')[0], 10);
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

async function pickPage(port) {
  const list = await getJSON(port, '/json/list');
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('no page target; targets=' + JSON.stringify(list.map((t) => t.type + ':' + t.url)));
  return page;
}

function rpc(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () => resolve({
      call(method, params) {
        const myId = ++id;
        return new Promise((res, rej) => {
          pending.set(myId, { res, rej });
          ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
        });
      },
      close() { ws.close(); },
    }));
    ws.addEventListener('error', (e) => reject(new Error('ws error: ' + (e.message || e.type))));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    });
  });
}

(async () => {
  const [cmd, a1, a2] = process.argv.slice(2);
  const port = a1 && /^\d+$/.test(a1) ? parseInt(a1, 10) : defaultPort();
  const arg = a1 && /^\d+$/.test(a1) ? a2 : a1;

  if (cmd === 'list') {
    const list = await getJSON(port, '/json/list');
    console.log(JSON.stringify(list.map((t) => ({ type: t.type, title: t.title, url: t.url })), null, 2));
    return;
  }

  const page = await pickPage(port);
  const c = await rpc(page.webSocketDebuggerUrl);

  if (cmd === 'text') {
    const r = await c.call('Runtime.evaluate', {
      expression: `(() => {
        const out = [];
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
          const t = (n.nodeValue || '').replace(/\\s+/g, ' ').trim();
          if (t && t.length < 120) out.push(t);
        }
        return JSON.stringify({ title: document.title, url: location.href, items: [...new Set(out)] });
      })()`,
      returnByValue: true,
    });
    console.log(r.result.value);
  } else if (cmd === 'run') {
    // 把本地 js 文件内容丢进页面执行（避免命令行引号地狱）
    const code = fs.readFileSync(arg, 'utf8');
    // 直接求值（不加包装函数），这样文件最后一个表达式的值就是返回值
    const r = await c.call('Runtime.evaluate', {
      expression: code, awaitPromise: true, returnByValue: true,
    });
    console.log(JSON.stringify(r.result && (r.result.value !== undefined ? r.result.value : r.result), null, 1));
  } else if (cmd === 'eval') {
    const r = await c.call('Runtime.evaluate', {
      expression: arg, awaitPromise: true, returnByValue: true,
    });
    console.log(JSON.stringify(r.result && (r.result.value !== undefined ? r.result.value : r.result), null, 2));
  } else if (cmd === 'shot') {
    const r = await c.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(arg, Buffer.from(r.data, 'base64'));
    console.log('saved ' + arg);
  } else {
    console.log('usage: node cdp.js <list|text|eval|shot> [port] [arg]');
  }
  c.close();
})().catch((e) => { console.error('ERR ' + e.message); process.exit(1); });
