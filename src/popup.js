const DEFAULTS = {
  enabled: true,
  mode: 'cycle',
  scale: 1.2,
  speed: 1,
  lineColor: 'auto',
  debug: false,
};

const els = {
  enabled: document.getElementById('enabled'),
  mode: document.getElementById('mode'),
  scale: document.getElementById('scale'),
  speed: document.getElementById('speed'),
  debug: document.getElementById('debug'),
};

chrome.storage.sync.get(DEFAULTS, (v) => {
  els.enabled.checked = v.enabled;
  els.mode.value = v.mode;
  els.scale.value = v.scale;
  els.speed.value = v.speed;
  els.debug.checked = v.debug;
});

function save() {
  chrome.storage.sync.set({
    enabled: els.enabled.checked,
    mode: els.mode.value,
    scale: parseFloat(els.scale.value),
    speed: parseFloat(els.speed.value),
    debug: els.debug.checked,
  });
}

for (const el of Object.values(els)) {
  el.addEventListener('change', save);
  el.addEventListener('input', save);
}

/* ---- статус зі сторінки ---- */

const statusEl = document.getElementById('status');

function show(cls, html) {
  statusEl.innerHTML = `<span class="dot ${cls}"></span>${html}`;
}

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab || !/^https:\/\/(beta\.)?xo\.market\//.test(tab.url || '')) {
    show('', 'Відкрий <b>beta.xo.market/pulse</b>');
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'xo-runner-status' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      show('warn', 'Скрипт не відповідає — перезавантаж сторінку.');
      return;
    }
    const { status, reason, line } = res;
    if (status === 'ok') {
      const c = line ? `rgb(${line.r},${line.g},${line.b})` : '';
      show(
        'ok',
        `Лінію знайдено${
          c
            ? ` <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${c};vertical-align:middle"></span>`
            : ''
        }, персонаж біжить.`
      );
    } else if (status === 'no-chart') {
      show('warn', 'Графік на сторінці не знайдено.');
    } else if (status === 'error') {
      show('err', reason || 'Не вдалося прочитати графік.');
    } else {
      show('warn', reason || 'Чекаю, поки з’явиться лінія…');
    }
  });
});
