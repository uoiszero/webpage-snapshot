const startBtn = document.getElementById('start');
const statusEl = document.getElementById('status');

startBtn.addEventListener('click', async () => {
  statusEl.textContent = '';
  startBtn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('no-active-tab');

    // 向当前页面的 content script 发送选择指令，成功即关闭弹窗进入页面内操作
    await chrome.tabs.sendMessage(tab.id, { type: 'WPS_START_SELECT' });
    window.close();
  } catch {
    statusEl.textContent =
      '无法在此页面使用（浏览器内置页面如 chrome:// 或扩展商店页面不支持注入）。请在有内容的网页上重试。';
    startBtn.disabled = false;
  }
});
