const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { readFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');

const ddsm = path.resolve(__dirname, '..');

// Keep the real delivery screen and marker logic, with a local stand-in for NAVER.
function mockNaverMap() {
  class Marker {
    constructor({ map, position, icon }) {
      this.position = position;
      this.element = document.createElement('div');
      this.element.innerHTML = icon.content;
      map.canvas.append(this.element);
    }
    getPosition() { return this.position; }
    setMap(map) { if (!map) this.element.remove(); }
  }
  class Map {
    constructor(canvas) { this.canvas = canvas; }
    setCenter() {
      this.canvas.dataset.centerCalls = Number(this.canvas.dataset.centerCalls || 0) + 1;
    }
    setZoom() {}
  }
  const maps = {
    Map, Marker, Size: class {}, Point: class {}, LatLng: class {},
    Position: { TOP_RIGHT: 0 },
    Event: {
      addListener(target, type, handler) { target.element?.addEventListener(type, handler); },
      trigger() {}
    }
  };
  window.DDSM_NaverMap = { loadSdk: async () => maps, open() {}, close() {}, update() {} };
}

async function checkDeliveryScreen() {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  try {
    const now = new Date();
    const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      .map(value => String(value).padStart(2, '0')).join('-');
    const makeStop = (id, recipient) => ({
      id, recipient, waybill: '12345678901', address: '충주시', phone: '', memo: '',
      status: 'pending', lat: 36.991, lng: 127.925
    });
    localStorage.setItem('ddsm:identity:phone:v1', '01000000000');
    localStorage.setItem('ddsm:data:v1:phone:01000000000', JSON.stringify({
      version: 1,
      days: { [date]: { selected: 1, rounds: [
        { no: 1, stops: [makeStop('first', '가상배송지1')] },
        { no: 2, stops: [makeStop('second', '가상배송지2')] }
      ] } }
    }));
    const frame = document.createElement('iframe');
    frame.style.cssText = 'display:block;border:0;width:390px;height:844px';
    const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
    frame.src = '/index.html';
    document.body.append(frame);
    await loaded;

    const doc = frame.contentDocument;
    const byId = id => doc.getElementById(id);
    const rect = id => byId(id).getBoundingClientRect();
    const marker = () => doc.querySelector('#deliveryMapCanvas .ddsm-map-marker');
    byId('listButton').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    check(marker()?.textContent.includes('가상배송지1'), 'First round marker missing');

    const sizes = [];
    for (const [width, height] of [[320, 568], [390, 844], [667, 320], [768, 1024], [1180, 820]]) {
      Object.assign(frame.style, { width: width + 'px', height: height + 'px' });
      const stage = rect('deliveryMapStage');
      const canvas = rect('deliveryMapCanvas');
      const round = rect('deliveryRoundSelect');
      const fit = rect('deliveryMapFitBtn');
      const label = width + '×' + height;
      check(stage.left <= 2 && width - stage.right <= 2, label + ': map gutters too wide');
      check(stage.height >= height * 0.5 && stage.bottom <= height, label + ': map does not fill viewport');
      check(canvas.width === stage.width && canvas.height === stage.height, label + ': canvas has gaps');
      check(round.height > 0 && round.top >= 0 && round.bottom <= stage.top, label + ': round picker obscured');
      const fitTarget = doc.elementFromPoint(fit.left + fit.width / 2, fit.top + fit.height / 2);
      check(fit.height > 0 && fit.right <= width && fit.top >= round.top && fit.bottom <= stage.bottom
        && byId('deliveryMapFitBtn').contains(fitTarget), label + ': fit button obscured');
      for (const id of ['backButton', 'workScanButton']) {
        const button = rect(id);
        check(button.height > 0 && button.left >= 0 && button.right <= width && button.bottom <= stage.top,
          label + ': ' + id + ' obscured');
      }
      const panel = frame.contentWindow.getComputedStyle(doc.querySelector('.delivery-map-panel'));
      check(panel.borderTopWidth === '0px' && panel.boxShadow === 'none', label + ': map panel has a border or shadow');
      if (width === 667) check(stage.height >= 230, label + ': landscape map shrank');
      check(doc.documentElement.scrollWidth === width, label + ': page overflows horizontally');
      check(rect('stopList').top > stage.bottom, label + ': list overlaps map');
      sizes.push(label + ' → ' + Math.round(stage.width) + '×' + Math.round(stage.height));
    }

    const picker = byId('deliveryRoundSelect');
    picker.value = '2';
    picker.dispatchEvent(new frame.contentWindow.Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    check(doc.querySelectorAll('#deliveryMapCanvas .ddsm-map-marker').length === 1
      && marker()?.textContent.includes('가상배송지2'), 'Map includes markers from a different round');
    check(byId('stopList').textContent.includes('가상배송지2'), 'List did not switch rounds');
    const canvas = byId('deliveryMapCanvas');
    const previousCenterCalls = Number(canvas.dataset.centerCalls || 0);
    byId('deliveryMapFitBtn').click();
    check(Number(canvas.dataset.centerCalls) === previousCenterCalls + 1, 'Fit button did not center on the selected round');
    marker().click();
    check(byId('editDialog').open && byId('recipientInput').value === '가상배송지2', 'Marker opened the wrong stop');
    document.getElementById('result').textContent = 'PASS ' + sizes.join(', ');
  } catch (error) {
    document.getElementById('result').textContent = 'FAIL ' + error.message;
  }
}

async function readBrowserResult(url) {
  const browser = spawn(process.env.CHROMIUM_BIN || 'chromium', [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-pipe'
  ], { stdio: ['ignore', 'ignore', 'inherit', 'pipe', 'pipe'] });
  let nextId = 0;
  let buffer = '';
  const pending = new Map();
  browser.stdio[4].setEncoding('utf8');
  browser.stdio[4].on('data', chunk => {
    buffer += chunk;
    const messages = buffer.split('\0');
    buffer = messages.pop();
    for (const message of messages) {
      const { id, result, error } = JSON.parse(message);
      const callback = pending.get(id);
      if (!callback) continue;
      pending.delete(id);
      if (error) callback.reject(new Error(error.message));
      else callback.resolve(result);
    }
  });
  const rejectPending = error => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  browser.on('error', rejectPending);
  browser.on('exit', code => rejectPending(new Error('Chromium exited: ' + code)));
  browser.stdio[3].on('error', rejectPending);
  const send = (method, params, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
  const timer = setTimeout(() => browser.kill(), 15000);
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.navigate', { url }, sessionId);
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const { result } = await send('Runtime.evaluate', {
        expression: 'document.getElementById("result")?.textContent',
        returnByValue: true
      }, sessionId);
      if (result.value && result.value !== 'Pending') return result.value;
      await delay(100);
    }
    throw new Error('Delivery map browser assertions did not finish');
  } finally {
    clearTimeout(timer);
    browser.kill();
  }
}

test('delivery map fills phone and tablet viewports and keeps round selection working', async () => {
  const server = createServer(async (req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1);
    if (!name) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end('<!doctype html><meta charset="utf-8"><pre id="result">Pending</pre><script>('
        + checkDeliveryScreen.toString() + ')()</script>');
    }
    if (name === 'naver-map.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end('(' + mockNaverMap.toString() + ')()');
    }
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
    const type = types[path.extname(name)];
    if (type && name === path.basename(name)) {
      try {
        const body = await readFile(path.join(ddsm, name));
        res.setHeader('Content-Type', type + '; charset=utf-8');
        return res.end(body);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await readBrowserResult('http://127.0.0.1:' + server.address().port);
    assert.match(result || '', /^PASS /);
    console.log(result);
  } finally {
    server.close();
  }
});
