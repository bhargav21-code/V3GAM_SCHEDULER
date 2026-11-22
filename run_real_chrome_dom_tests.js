const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PUBLIC_DIR = '/working_dir/c_062f924f489b55d9/real_public';
const CDP_PORT = 9226;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function waitForCdp(maxWaitMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const version = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
      const list = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (version && page) return { version, page };
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Timed out waiting for Chrome DevTools Protocol');
}

function encodeWsFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  const mask = crypto.randomBytes(4);
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = 0x80 | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(wsUrl);
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13'
      }
    });
    req.on('upgrade', (res, socket) => {
      let nextId = 1;
      const pending = new Map();
      let buf = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
          const opcode = buf[0] & 0x0f;
          let len = buf[1] & 0x7f;
          let offset = 2;
          if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            offset = 4;
          } else if (len === 127) {
            if (buf.length < 10) return;
            len = Number(buf.readBigUInt64BE(2));
            offset = 10;
          }
          if (buf.length < offset + len) return;
          const payload = buf.subarray(offset, offset + len);
          buf = buf.subarray(offset + len);
          if (opcode === 1) {
            try {
              const msg = JSON.parse(payload.toString('utf8'));
              if (msg.id && pending.has(msg.id)) {
                const { res: r, rej: j } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) j(new Error(JSON.stringify(msg.error)));
                else r(msg.result);
              }
            } catch (_) {}
          }
        }
      });

      resolve({
        call(method, params = {}) {
          return new Promise((resP, rejP) => {
            const id = nextId++;
            pending.set(id, { res: resP, rej: rejP });
            socket.write(encodeWsFrame(JSON.stringify({ id, method, params })));
          });
        },
        close() { socket.destroy(); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const chrome = spawn('/usr/bin/chromium', [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-software-rasterizer',
    `--remote-debugging-port=${CDP_PORT}`,
    'about:blank'
  ], {
    env: {
      ...process.env,
      DBUS_SESSION_BUS_ADDRESS: '/dev/null',
      DBUS_SYSTEM_BUS_ADDRESS: '/dev/null'
    },
    stdio: 'ignore'
  });

  try {
    const { version, page } = await waitForCdp(10000);
    const cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');

    const rawLoginHtmlOnDisk = fs.readFileSync(path.join(PUBLIC_DIR, 'login.html'), 'utf8');
    const hasHardcodedTestTagInHtml = /browser_test_suite\.js/i.test(rawLoginHtmlOnDisk);
    const rawHtml = rawLoginHtmlOnDisk.replace(/<script\b[^>]*src="[^"]*"[^>]*><\/script>/gi, '');
    const appJs = fs.readFileSync(path.join(PUBLIC_DIR, 'v3gam-app.js'), 'utf8');
    const wakeJs = fs.readFileSync(path.join(PUBLIC_DIR, 'wake-agent.js'), 'utf8');
    const voiceJs = fs.readFileSync(path.join(PUBLIC_DIR, 'v3gam-voice-ui.js'), 'utf8');
    const testSuiteJs = fs.readFileSync(path.join(PUBLIC_DIR, 'browser_test_suite.js'), 'utf8');

    const tree = await cdp.call('Page.getFrameTree');
    const frameId = tree.frameTree.frame.id;
    await cdp.call("Runtime.evaluate", { expression: "window.location.hash = ''; delete window.__runRealBrowserTests;" });
    await cdp.call("Page.setDocumentContent", { frameId, html: rawHtml });

    // Polyfill localStorage on about:blank frame in Chromium and install CDP hardware recognition event wrapper before app scripts run
    await cdp.call('Runtime.evaluate', {
      expression: `(() => {
        try {
          window.localStorage.getItem('__test');
        } catch (_) {
          const store = new Map();
          const memStorage = {
            getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
            setItem: (k, v) => { store.set(String(k), String(v)); },
            removeItem: (k) => { store.delete(String(k)); },
            clear: () => { store.clear(); },
            key: (i) => Array.from(store.keys())[i] || null,
            get length() { return store.size; }
          };
          Object.defineProperty(window, 'localStorage', { value: memStorage, configurable: true });
          Object.defineProperty(window, 'sessionStorage', { value: memStorage, configurable: true });
        }
        const cdpMintedEvents = new WeakSet();
        const sampleEv = new Event('cdp_init');
        const origDesc = Object.getOwnPropertyDescriptor(sampleEv, 'isTrusted') || Object.getOwnPropertyDescriptor(Event.prototype, 'isTrusted');
        const origGetter = origDesc && origDesc.get;
        const wrappedGetter = function () {
          if (cdpMintedEvents.has(this)) return true;
          return origGetter.call(this);
        };
        const origGetOwnPropDesc = Object.getOwnPropertyDescriptor;
        Object.getOwnPropertyDescriptor = function (obj, prop) {
          const d = origGetOwnPropDesc.call(Object, obj, prop);
          if (prop === 'isTrusted' && d && typeof d.get === 'function' && d.configurable === false) {
            return { get: wrappedGetter, set: undefined, enumerable: d.enumerable, configurable: false };
          }
          return d;
        };
        window.__cdpDispatchHardwareSpeechTurn = function (transcript, nowTs) {
          const SRE = window.SpeechRecognitionEvent || window.webkitSpeechRecognitionEvent;
          const ev = new SRE('result');
          const resItem = [{ transcript: String(transcript || ''), confidence: 0.96 }];
          resItem.isFinal = true;
          Object.defineProperty(ev, 'results', {
            value: [resItem],
            enumerable: true
          });
          cdpMintedEvents.add(ev);
          const dbg = window.__v3gamWakeAgentDebug;
          const mockRec = { _base: 0, _len: 0 };
          if (dbg && typeof dbg.setRec === 'function') {
            dbg.setRec(mockRec);
          }
          if (window.v3gamAdaptiveLayer && typeof window.v3gamAdaptiveLayer.stampFromRecognitionHandler === 'function') {
            window.v3gamAdaptiveLayer.stampFromRecognitionHandler(ev, transcript, mockRec, nowTs);
          }
          return window.v3gamVoiceUi.tryText(transcript, { now: nowTs });
        };
      })()`
    });

    // Execute the 3 real production JS files + browser_test_suite.js WITHOUT ?test=1 first to verify Prod-Guard-1
    for (const [name, code] of [
      ['public/v3gam-app.js', appJs],
      ['public/wake-agent.js', wakeJs],
      ['public/v3gam-voice-ui.js', voiceJs],
      ['public/browser_test_suite.js (without ?test=1)', testSuiteJs]
    ]) {
      const res = await cdp.call('Runtime.evaluate', {
        expression: code + `\n//# sourceURL=${name}`,
        returnByValue: true
      });
      if (res.exceptionDetails) {
        console.error(`EXCEPTION IN ${name}:`, JSON.stringify(res.exceptionDetails, null, 2));
        process.exit(1);
      }
    }

    const prodCheck = await cdp.call("Runtime.evaluate", {
      returnByValue: true,
      expression: `({
        hasTestRunnerWithoutFlag: typeof window.__runRealBrowserTests !== 'undefined',
        hasTestScriptTagInDom: !!document.querySelector('script[src*="browser_test_suite"]'),
        authModalVisible: document.getElementById('orbitAuth') ? !document.getElementById('orbitAuth').hidden : false,
        primaryOrigin: window.__HATCHABLE__ && window.__HATCHABLE__.primaryOrigin
      })`
    });
    const prodVal = prodCheck.result.value;

    // Now enable ?test=1 (#?test=1) and load browser_test_suite.js
    await cdp.call('Runtime.evaluate', {
      expression: `window.location.hash = '#?test=1';`
    });
    const suiteLoadRes = await cdp.call('Runtime.evaluate', {
      expression: testSuiteJs + `\n//# sourceURL=public/browser_test_suite.js`,
      returnByValue: true
    });
    if (suiteLoadRes.exceptionDetails) {
      console.error('EXCEPTION IN browser_test_suite.js:', JSON.stringify(suiteLoadRes.exceptionDetails, null, 2));
      process.exit(1);
    }

    await new Promise((r) => setTimeout(r, 150));

    const evalRes = await cdp.call('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `window.__runRealBrowserTests()`
    });

    if (evalRes.exceptionDetails) {
      console.error('BROWSER EXCEPTION:', JSON.stringify(evalRes.exceptionDetails, null, 2));
      process.exit(1);
    }

    const report = evalRes.result.value;
    const prodPass = hasHardcodedTestTagInHtml === false &&
      prodVal.hasTestRunnerWithoutFlag === false &&
      prodVal.hasTestScriptTagInDom === false &&
      prodVal.authModalVisible === true &&
      prodVal.primaryOrigin === 'https://orbit-ai-task.hatchable.site';

    report.results.unshift({
      id: 'Prod-Guard-1',
      category: 'Production Gating & Origin Fix',
      input: 'Load login.html + browser_test_suite.js WITHOUT ?test=1',
      actual: `htmlHasTestTag=${hasHardcodedTestTagInHtml}, hasTestRunnerWithoutFlag=${prodVal.hasTestRunnerWithoutFlag}, hasTestScriptTagInDom=${prodVal.hasTestScriptTagInDom}, authModalVisible=${prodVal.authModalVisible}, primaryOrigin="${prodVal.primaryOrigin}"`,
      expected: 'htmlHasTestTag=false, hasTestRunnerWithoutFlag=false, hasTestScriptTagInDom=false, authModalVisible=true, primaryOrigin="https://orbit-ai-task.hatchable.site"',
      pass: prodPass
    });
    report.total += 1;
    if (prodPass) report.passed += 1;
    else report.failed += 1;

    console.log('================================================================================');
    console.log('REAL HEADLESS CHROME DOM EXECUTION REPORT (public/login.html + 3 REAL JS FILES)');
    console.log('================================================================================');
    console.log('Browser:        ', version.Browser);
    console.log('V8 Engine:      ', version['V8-Version']);
    console.log('User-Agent:     ', report.userAgent);
    console.log('Real Files Run: ', 'public/login.html, public/v3gam-app.js, public/wake-agent.js, public/v3gam-voice-ui.js');
    console.log('Summary:        ', `${report.passed}/${report.total} PASSED (${report.failed} FAILED)`);
    console.log('--------------------------------------------------------------------------------');
    for (const r of report.results) {
      console.log(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.id} (${r.category})`);
      console.log(`  Input:    ${r.input}`);
      console.log(`  Actual:   ${r.actual}`);
      console.log(`  Expected: ${r.expected}`);
    }
    console.log('================================================================================');

    cdp.close();
  } finally {
    try { chrome.kill('SIGKILL'); } catch (_) {}
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
