// ==UserScript==
// @name         OpenCD种子批量下载
// @namespace    https://open.cd/
// @version      1.1
// @description  扫描本页 .torrent 链接 → 批量下载；支持“仅 Free”筛选；自动去重（按规范化URL）。批量下载功能。
// @author       WeChat: zwy1912overdrive/15011175508
// @match        https://open.cd/torrents.php*
// @match        http://open.cd/torrents.php*
// @match        https://*.open.cd/torrents.php*
// @match        http://*.open.cd/torrents.php*
// @run-at       document-end
// @grant        none
// @license      MIT
// ==/UserScript==
 
/*
 * 个人信息备注：
 * 手机：15011175508
 * 微信：zwy1912overdrive
 * 版本：1.1
 * 第一版日期：20260207
 */
 
(function () {
  'use strict';
 
  const toAbs = h => { try { return new URL(h, location.origin).toString(); } catch { return h; } };
 
  // 统一/规范化下载链接：仅保留 id 与 passkey，去掉其他参数，排序参数
  function normTorrentUrl(u) {
    try {
      const url = new URL(u, location.origin);
      // 只接受 download.php 路径
      if (!/\/download\.php$/i.test(url.pathname)) return null;
 
      // 只保留 id / passkey（若存在）
      const id = url.searchParams.get('id');
      if (!id) return null;
 
      const passkey = url.searchParams.get('passkey');
      const clean = new URL(url.origin + url.pathname);
      clean.searchParams.set('id', id);
      if (passkey) clean.searchParams.set('passkey', passkey);
 
      // 排序参数顺序（视觉稳定，不影响功能）
      const sorted = new URL(url.origin + url.pathname);
      const pairs = [];
      clean.searchParams.forEach((v, k) => pairs.push([k, v]));
      pairs.sort((a, b) => a[0].localeCompare(b[0]));
      for (const [k, v] of pairs) sorted.searchParams.set(k, v);
 
      return sorted.toString();
    } catch {
      return null;
    }
  }
 
  // 入口按钮
  const btn = document.createElement('button');
  Object.assign(btn.style, {
    position: 'fixed', right: '14px', bottom: '18px', zIndex: 999999,
    background: '#4a90e2', color: '#fff', border: 'none', borderRadius: '999px',
    padding: '10px 14px', fontWeight: '700', cursor: 'pointer'
  });
  btn.textContent = '🧩OCD工具';
  document.body.appendChild(btn);
 
  // 面板
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', right: '14px', bottom: '64px', width: '460px', zIndex: 999999,
    background: '#111', color: '#eee', borderRadius: '10px', padding: '12px',
    display: 'none', boxShadow: '0 8px 20px rgba(0,0,0,.35)', font: '14px/1.4 system-ui'
  });
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <b>OpenCD 种子批量下载</b>
      <button id="ocd_close" style="background:#333;color:#fff;border:none;border-radius:6px;padding:4px 8px;cursor:pointer">关闭</button>
    </div>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">
      <button id="ocd_scan" style="background:#4a90e2;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer">扫描本页</button>
      <label style="display:flex;align-items:center;gap:6px">
        <input type="checkbox" id="ocd_only_free">
        <span>仅 Free</span>
      </label>
    </div>
    <div id="ocd_stat" style="font-size:12px;opacity:.9;margin-bottom:6px">尚未扫描</div>
    <div id="ocd_preview" style="height:220px;overflow:auto;border:1px solid #333;border-radius:8px;padding:8px;font-size:12px;line-height:1.5;background:#0f0f0f"></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      <button id="ocd_dl" style="background:#4a90e2;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer">批量下载.torrent</button>
    </div>
  `;
  document.body.appendChild(box);
 
  btn.onclick = () => box.style.display = box.style.display === 'none' ? 'block' : 'none';
  box.querySelector('#ocd_close').onclick = () => box.style.display = 'none';
 
  // —— 数据结构：items = [{idx,title,url,isFree}] —— //
  let items = [];
  let lastScanRaw = 0, lastRemoved = 0;
 
  // 识别一行是否 Free（多重启发式）
  function isFreeRow(tr) {
    if (tr.querySelector('img[alt*="free" i], img[title*="free" i], img[src*="free" i], [class*="free" i]')) return true;
    const txt = (tr.textContent || '').toLowerCase();
    if (/\bfree\b/.test(txt) || txt.includes('免费')) return true;
    return false;
  }
 
  function getRows() {
    const t = document.querySelector('table.torrents');
    if (!t) return [];
    const trs = Array.from(t.querySelectorAll('tr'));
    return trs.filter(tr => !tr.classList.contains('colhead') && !tr.querySelector('.colhead'));
  }
 
  function getTitle(tr) {
    const a = tr.querySelector('a[href*="plugin_details.php?id="], a[href*="details.php?id="]');
    return a ? (a.textContent || '').trim().replace(/\s+/g, ' ') : '(无标题)';
  }
 
  function getRawDlUrl(tr) {
    // 兼容可能的路径/大小写
    const a = tr.querySelector('a[href*="download.php?id="], a[href$="/download.php"], a[href*="/download.php?"]');
    if (!a) return null;
    return toAbs(a.getAttribute('href'));
  }
 
  function getCurrentList() {
    const onlyFree = box.querySelector('#ocd_only_free').checked;
    return onlyFree ? items.filter(x => x.isFree) : items;
  }
 
  function render() {
    const onlyFree = box.querySelector('#ocd_only_free').checked;
    const data = getCurrentList();
 
    const html = data.map((it, i) => {
      const badge = it.isFree
        ? `<span style="display:inline-block;background:#27ae60;color:#fff;padding:0 6px;border-radius:4px;margin-right:6px">FREE</span>`
        : '';
      return `<div style="display:flex;gap:8px;align-items:center;border-bottom:1px dashed #333;padding:6px 0">
        <div style="width:38px;opacity:.85;text-align:right">${onlyFree ? (i + 1) : it.idx}.</div>
        <div style="flex:1;color:#ccc">${badge}${it.title}</div>
        <a style="color:#8ad" href="${it.url}" target="_blank" rel="noopener noreferrer">DL</a>
      </div>`;
    }).join('');
 
    box.querySelector('#ocd_preview').innerHTML = html || '<span style="color:#888">当前筛选无结果</span>';
 
    const totalFree = items.filter(x => x.isFree).length;
    box.querySelector('#ocd_stat').textContent =
      `原始采集 ${lastScanRaw} 条；去重后 ${items.length} 条（移除 ${lastRemoved}）。其中 Free ${totalFree} 条。当前显示：${data.length} 条`;
  }
 
  function scan() {
    const seen = new Map(); // key = normUrl
    let i = 0, rawCount = 0;
 
    for (const tr of getRows()) {
      const raw = getRawDlUrl(tr);
      if (!raw) continue;
      rawCount++;
 
      const norm = normTorrentUrl(raw);
      if (!norm) continue; // 非规范下载地址跳过
 
      // 去重
      if (seen.has(norm)) continue;
 
      seen.set(norm, {
        idx: ++i,
        title: getTitle(tr),
        url: norm,
        isFree: isFreeRow(tr),
      });
    }
 
    items = Array.from(seen.values());
    lastScanRaw = rawCount;
    lastRemoved = rawCount - items.length;
 
    render();
  }
 
  async function batch(list, delay = 350) {
    if (!list.length) { alert('没有可下载条目（先扫描/检查“仅 Free”勾选）。'); return; }
 
    for (const u of list) {
      await new Promise(r => setTimeout(r, delay));
      const f = document.createElement('iframe');
      f.style.display = 'none';
      f.src = u;
      document.body.appendChild(f);
      setTimeout(() => f.remove(), 6000);
    }
 
    alert(`已尝试批量下载 ${list.length} 个 .torrent（查看浏览器下载栏）。`);
  }
 
  // 事件
  box.querySelector('#ocd_scan').onclick = scan;
  box.querySelector('#ocd_only_free').onchange = render;
 
  box.querySelector('#ocd_dl').onclick = () => {
    const list = Array.from(new Set(getCurrentList().map(x => x.url))); // 再保险去重
    batch(list, 350);
  };
})();
