const enabledEl = document.getElementById('enabled');

chrome.storage.sync.get({ enabled: true }, (v) => {
  enabledEl.checked = v.enabled;
});

enabledEl.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: enabledEl.checked });
});

/* ---- status from the page ---- */

const statusEl = document.getElementById('status');

function show(cls, html) {
  statusEl.innerHTML = `<span class="dot ${cls}"></span>${html}`;
}

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab || !/^https:\/\/(beta\.)?xo\.market\//.test(tab.url || '')) {
    show('', 'Open <b>beta.xo.market/pulse</b>');
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'xo-runner-status' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      show('warn', "Script isn't responding — reload the page.");
      return;
    }
    const { status, reason, line } = res;
    if (status === 'ok') {
      const c = line ? `rgb(${line.r},${line.g},${line.b})` : '';
      show(
        'ok',
        `Line found${
          c
            ? ` <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${c};vertical-align:middle"></span>`
            : ''
        }, character is running.`
      );
    } else if (status === 'no-chart') {
      show('warn', 'No chart found on the page.');
    } else if (status === 'error') {
      show('err', reason || "Couldn't read the chart.");
    } else {
      show('warn', reason || 'Waiting for the line to appear…');
    }
  });
});
