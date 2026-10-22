/**
 * Webpage Snapshot - background service worker
 *
 * chrome.downloads 只能由扩展页面调用，content script 中不可用（undefined），
 * 因此下载统一由这里代理执行。content script 发送 data URL 后在此保存。
 *
 * WPS_FETCH_DATA_URL：content script 的 fetch 受页面 CORS 限制，无法内联
 * 无 CORS 头的跨域图片（会导致截图画布被污染、导出失败）。background 拥有
 * <all_urls> host 权限，可绕过 CORS 抓取并转为 data URL 返回。
 *
 * 防盗链：部分图床（如新浪 sinaimg.cn）校验 Referer，只放行来源站点域。
 * content script 直连受 CORS 限制，而 background 的 fetch Referer 是
 * chrome-extension:// 域，会被服务器拒绝（403）导致图片内联失败、截图缺图。
 * Fetch API 的 referrer 选项无法跨 origin 设置，故用 declarativeNetRequest
 * 会话规则：抓取期间把请求 Referer 临时改写为页面 origin，抓取完成后立即移除。
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'WPS_DOWNLOAD') {
    chrome.downloads.download(
      { url: msg.dataUrl, filename: msg.filename, saveAs: false, conflictAction: 'uniquify' },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true, filename: msg.filename, downloadId });
        }
      }
    );
    return true; // 异步响应
  }

  if (msg && msg.type === 'WPS_FETCH_DATA_URL') {
    fetchWithPageReferer(msg.url, sender.url || '')
      .then(blobToDataUrl)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});

// 单次抓取上限：跨域请求既不返回也不报错时，避免 content script 的
// 「正在生成图片…」永久挂起（超时按抓取失败，由调用方降级为透明占位）
const FETCH_TIMEOUT_MS = 15000;

// 会话规则在「浏览器关闭 / 扩展更新」时才会清空，跨 SW 重启持久存在；
// SW 若在 fetch 期间被回收（finally 未执行）可能残留规则。规则 id 用
// 计数器（本轮 SW 会话内唯一）生成，重启后若与残留 id 冲突，
// updateSessionRules 会 reject，由下方 catch 回退为裸请求（不阻断抓取）。
let dnrRuleCounter = 0;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 带页面来源 Referer 抓取资源：
 *  - 添加会话规则，把目标 URL 请求的 Referer 改写为页面 origin（如
 *    https://weibo.com/），以通过 sinaimg 等图床的防盗链校验；
 *    规则限定 resourceTypes 为 xmlhttprequest（避开导航、图片等子资源）
 *  - **不能**用 condition.tabIds 限定作用范围：这里的 fetch 由扩展 service
 *    worker 发起，不关联任何标签页（tabId 为 -1），带 tabIds 的条件永远不命中，
 *    Referer 不会被改写，sinaimg 返回 403，截图里的微博配图全部变成透明占位。
 *    影响面由「精确到单条 URL 的 regexFilter + 抓取结束立即移除」收敛即可
 *  - fetch 完成后在 finally 中立即移除规则，避免影响其他请求
 *  - 规则不可用时（非 http(s) URL、sender.url 缺失等）退回裸请求，
 *    行为与修复前一致
 */
async function fetchWithPageReferer(url, pageUrl) {
  let ruleId = 0;
  try {
    const origin = new URL(pageUrl).origin;
    if (/^https?:/i.test(url) && origin) {
      ruleId = (dnrRuleCounter++ % 2147483646) + 1;
      await chrome.declarativeNetRequest.updateSessionRules({
        addRules: [
          {
            id: ruleId,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [{ header: 'referer', operation: 'set', value: origin }],
            },
            condition: {
              regexFilter: '^' + escapeRegExp(url) + '$',
              resourceTypes: ['xmlhttprequest'],
            },
          },
        ],
      });
    }
  } catch (err) {
    console.warn('[Webpage Snapshot] 无法设置 Referer 规则，退回裸请求：', err);
    ruleId = 0;
  }
  try {
    const resp = await fetch(url, {
      credentials: 'include',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.blob();
  } finally {
    if (ruleId) {
      chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {});
    }
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
