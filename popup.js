const t = window.wpsI18n.t;

document.getElementById('i18n-title').textContent = t('title');
document.getElementById('i18n-description').textContent = t('description');
document.getElementById('start').textContent = t('startSelect');
document.getElementById('i18n-tipFormats').textContent = t('tipFormats');
document.getElementById('i18n-tipEsc').innerHTML = t('tipEsc').replace('Esc', '<kbd>Esc</kbd>');
document.getElementById('i18n-tipDownload').textContent = t('tipDownload');

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
    statusEl.textContent = t('popupError');
    startBtn.disabled = false;
  }
});
