const message = document.querySelector('#message');
const card = document.querySelector('#code-card');
const codeLabel = document.querySelector('#code');
const openButton = document.querySelector('#open');
let detectedCode = '';

const CODE_PATTERN = /\b\d{3,}-\d{1,}-[A-Z]{1,2}\d{2,}\b/i;
const MARKETPLACE_HOSTS = new Set(['mercadopublico.cl', 'www.mercadopublico.cl']);

function detectCodeOnActivePage() {
  const url = new URL(location.href);
  const candidates = [];
  for (const key of ['codigo', 'codigoExterno', 'idLicitacion']) {
    const value = url.searchParams.get(key);
    if (value) candidates.push(value);
  }
  candidates.push(document.title, document.body?.innerText ?? '');
  for (const text of candidates) {
    const match = String(text).match(/\b\d{3,}-\d{1,}-[A-Z]{1,2}\d{2,}\b/i);
    if (match) return match[0].toUpperCase();
  }
  return '';
}

async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) { message.textContent = 'No hay una pestaña activa disponible.'; return; }
  let activeUrl;
  try { activeUrl = new URL(tab.url); } catch { activeUrl = null; }
  if (!activeUrl || activeUrl.protocol !== 'https:' || !MARKETPLACE_HOSTS.has(activeUrl.hostname)) {
    message.textContent = 'Abre una ficha pública en mercadopublico.cl y vuelve a abrir la extensión.';
    return;
  }
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: detectCodeOnActivePage });
    detectedCode = typeof result?.result === 'string' ? result.result : '';
    if (!detectedCode) { message.textContent = 'No encontré un código en la información visible de esta pestaña. Abre una ficha pública e inténtalo de nuevo.'; return; }
    codeLabel.textContent = detectedCode;
    card.hidden = false;
    message.textContent = 'Código de la ficha pública detectado.';
    openButton.disabled = false;
  } catch {
    message.textContent = 'Chrome no permitió leer esta pestaña. Abre una ficha pública y vuelve a abrir la extensión.';
  }
}

openButton.addEventListener('click', async () => {
  if (!detectedCode) return;
  openButton.disabled = true;
  const target = new URL('http://127.0.0.1:5180/mercado-publico');
  target.searchParams.set('codigo', detectedCode);
  await chrome.tabs.create({ url: target.toString() });
  window.close();
});

void initialize();
