/**
 * Webpage Snapshot - background service worker
 *
 * chrome.downloads 只能由扩展页面调用，content script 中不可用（undefined），
 * 因此下载统一由这里代理执行。content script 发送 data URL 后在此保存。
 *
 * WPS_FETCH_DATA_URL：content script 的 fetch 受页面 CORS 限制，无法内联
 * 无 CORS 头的跨域图片（会导致截图画布被污染、导出失败）。background 拥有
 * <all_urls> host 权限，可绕过 CORS 抓取并转为 data URL 返回。
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
    fetch(msg.url, { credentials: 'include' })
      .then((resp) => {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.blob();
      })
      .then(blobToDataUrl)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
