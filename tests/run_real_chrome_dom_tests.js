const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const REPO_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(REPO_DIR, 'public');
const TESTS_DIR = __dirname;
const CDP_PORT = 9227;

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

// Convert ES module source (api/tasks.js or api/assistant.js) to runnable CJS function with injected mocks
function loadApiModule(filePath, mocks) {
  let code = fs.readFileSync(filePath, 'utf8');
  code = code
    .replace(/import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]hatchable['"];?/g, 'const { $1 } = __mocks.hatchable;')
    .replace(/import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]\.\.\/lib\/supabase\.js['"];?/g, 'const { $1 } = __mocks.supabase;')
    .replace(/import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]\.\.\/lib\/security\.js['"];?/g, 'const { $1 } = __mocks.security;')
    .replace(/export\s+const\s+([a-zA-Z0-9_]+)\s*=/g, "const $1 = exports.$1 =")
    .replace(/export\s+function\s+([a-zA-Z0-9_]+)/g, "function $1")
    .replace(/export\s+default\s+async\s+function/g, 'exports.default = async function');
  const mod = { exports: {} };
  const fn = new Function('exports', '__mocks', code);
  fn(mod.exports, mocks);
  return mod.exports;
}

async function runServerApiTests() {
  const results = [];
  const record = (id, category, input, actual, expected, pass) => {
    results.push({ id, category, input, actual, expected, pass: Boolean(pass) });
  };

  // Mock infrastructure for api/tasks.js and api/assistant.js
  let dbQueries = [];
  let allowPermission = true;
  let nextModelResponse = { action: 'complete_task', task_id: 101, reply: 'Done' };
  let lastGeneratedPrompt = '';

  const mocks = {
    hatchable: {
      db: {
        async query(sql, params = []) {
          dbQueries.push({ sql, params });
          if (/INSERT INTO orbit_tasks/i.test(sql)) {
            return {
              rows: [{
                id: 777,
                user_id: params[0],
                workspace_id: params[1],
                title: params[2],
                category: params[3],
                duration_minutes: params[4]
              }]
            };
          }
          if (/SELECT .* FROM orbit_tasks/i.test(sql)) {
            return {
              rows: [{
                id: 101,
                user_id: 'usr_1',
                workspace_id: null,
                title: 'ADA problem set',
                category: 'study',
                duration_minutes: 90,
                starts_at: '2026-11-23T05:00:00.000Z',
                due_date: '2026-11-23',
                status: 'planned'
              }]
            };
          }
          if (/UPDATE orbit_tasks/i.test(sql)) {
            return {
              rows: [{
                id: 101,
                user_id: 'usr_1',
                workspace_id: null,
                title: 'ADA problem set',
                category: params[0] || 'study',
                duration_minutes: 90,
                status: params[0] === 'done' || params[0] === 'skipped' ? params[0] : 'planned'
              }]
            };
          }
          return { rows: [], rowCount: 1 };
        }
      },
      ai: {
        async generateText({ prompt }) {
          lastGeneratedPrompt = prompt;
          return { text: JSON.stringify(nextModelResponse), finishReason: 'stop' };
        }
      }
    },
    supabase: {
      async requireSupabaseUser() { return 'usr_1'; }
    },
    security: {
      setApiSecurityHeaders() {},
      async enforceWriteLimit() { return true; },
      async checkRateLimit() { return { allowed: true }; },
      respondRateLimited() {},
      async canMutateTask() { return { allowed: allowPermission }; }
    }
  };

  function makeRes() {
    return {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };
  }

  const tasksApi = loadApiModule(path.join(REPO_DIR, 'api', 'tasks.js'), mocks);
  const assistantApi = loadApiModule(path.join(REPO_DIR, 'api', 'assistant.js'), mocks);

  // Item-5 (Server): POST /api/tasks, PATCH /api/tasks, and POST /api/assistant (add_task) category normalization + prompt list
  dbQueries = [];
  const resPostUnknown = makeRes();
  await tasksApi.default({ method: 'POST', body: { title: 'Some Task', category: 'invalid_category_xyz', duration_minutes: 45 } }, resPostUnknown);
  const postUnknownCat = resPostUnknown.body && resPostUnknown.body.task && resPostUnknown.body.task.category;

  const resPostValid = makeRes();
  await tasksApi.default({ method: 'POST', body: { title: 'Valid Task', category: 'lecture', duration_minutes: 60 } }, resPostValid);
  const postValidCat = resPostValid.body && resPostValid.body.task && resPostValid.body.task.category;

  dbQueries = [];
  const resPatchUnknown = makeRes();
  await tasksApi.default({ method: 'PATCH', query: { id: '101' }, body: { category: 'bogus_cat' } }, resPatchUnknown);
  const patchUpdateQuery = dbQueries.find((q) => /UPDATE orbit_tasks/i.test(q.sql));
  const patchUnknownCat = patchUpdateQuery && patchUpdateQuery.params[0];

  nextModelResponse = {
    action: 'add_task',
    task: { title: 'AI Task', category: 'unlisted_ai_category', duration_minutes: 30, due_date: '2026-11-23', start_time: '10:00', detail: '' },
    reply: 'Added AI Task'
  };
  const resAiAdd = makeRes();
  await assistantApi.default({ method: 'POST', body: { message: 'Add AI task at 10 AM' } }, resAiAdd);
  const aiAddCat = resAiAdd.body && resAiAdd.body.task && resAiAdd.body.task.category;
  const promptHasAllowedList = /study,\s*lab,\s*lecture,\s*gym,\s*meal,\s*personal/.test(lastGeneratedPrompt);

  record('Item-5 (Server)', 'Server Category Normalization (tasks.js & assistant.js)', 'POST/PATCH /api/tasks and POST /api/assistant add_task with unknown vs valid categories + prompt allowed list',
    `postUnknown="${postUnknownCat}", postValid="${postValidCat}", patchUnknown="${patchUnknownCat}", aiAddUnknown="${aiAddCat}", promptHasAllowedList=${promptHasAllowedList}`,
    'postUnknown="personal", postValid="lecture", patchUnknown="personal", aiAddUnknown="personal", promptHasAllowedList=true',
    postUnknownCat === 'personal' &&
    postValidCat === 'lecture' &&
    patchUnknownCat === 'personal' &&
    aiAddCat === 'personal' &&
    promptHasAllowedList === true);

  // Item-7 (Server): complete_task, skip_task, snooze_task, reschedule_task return {action:'confirm', proposed:{...}, reply:'...'} with 0 DB UPDATEs, then execute & re-check permission on confirm
  const mutationActions = [
    { action: 'complete_task', task_id: 101, reply: 'Done' },
    { action: 'skip_task', task_id: 101, reply: 'Skipped' },
    { action: 'snooze_task', task_id: 101, reply: 'Snoozed' },
    { action: 'reschedule_task', task_id: 101, task: { due_date: '2026-11-24', start_time: '15:00' }, reply: 'Moved' }
  ];

  let allProposalsStageWithoutMutating = true;
  const stagedSummaries = [];
  for (const mSpec of mutationActions) {
    dbQueries = [];
    nextModelResponse = mSpec;
    const r = makeRes();
    await assistantApi.default({ method: 'POST', body: { message: 'mutate task 101 at 3:00 PM' } }, r);
    const updateCount = dbQueries.filter((q) => /UPDATE orbit_tasks/i.test(q.sql)).length;
    const isConfirm = r.statusCode === 200 && r.body && r.body.action === 'confirm' && r.body.proposed && r.body.proposed.action === mSpec.action && updateCount === 0;
    stagedSummaries.push(`${mSpec.action}:action=${r.body && r.body.action}(updates=${updateCount})`);
    if (!isConfirm) allProposalsStageWithoutMutating = false;
  }

  // Re-check ownership/permission on confirm: first deny permission (expect 403, 0 UPDATEs), then allow permission (expect 200, 1 UPDATE)
  allowPermission = false;
  dbQueries = [];
  const rDeniedConfirm = makeRes();
  await assistantApi.default({
    method: 'POST',
    body: {
      confirm: true,
      confirm_proposed: { action: 'complete_task', task_id: 101, status: 'done' }
    }
  }, rDeniedConfirm);
  const deniedUpdates = dbQueries.filter((q) => /UPDATE orbit_tasks/i.test(q.sql)).length;
  const deniedCheckOk = rDeniedConfirm.statusCode === 403 && deniedUpdates === 0;

  allowPermission = true;
  dbQueries = [];
  const rAllowedConfirm = makeRes();
  await assistantApi.default({
    method: 'POST',
    body: {
      confirm: true,
      confirm_proposed: { action: 'complete_task', task_id: 101, status: 'done' }
    }
  }, rAllowedConfirm);
  const allowedUpdates = dbQueries.filter((q) => /UPDATE orbit_tasks/i.test(q.sql)).length;
  const allowedCheckOk = rAllowedConfirm.statusCode === 200 && rAllowedConfirm.body && rAllowedConfirm.body.confirmed === true && allowedUpdates === 1;

  record('Item-7 (Server)', 'Server AI Mutation Confirmation & Permission Re-Check', 'Unconfirmed complete/skip/snooze/reschedule return {action:"confirm", proposed} with 0 UPDATEs; confirm call re-checks canMutateTask (403 when denied, 200+UPDATE when allowed)',
    `${stagedSummaries.join(', ')} | confirmDeniedStatus=${rDeniedConfirm.statusCode}(updates=${deniedUpdates}) | confirmAllowedStatus=${rAllowedConfirm.statusCode}(updates=${allowedUpdates})`,
    'All 4 return action="confirm" with 0 UPDATEs; confirmDeniedStatus=403(updates=0); confirmAllowedStatus=200(updates=1)',
    allProposalsStageWithoutMutating && deniedCheckOk && allowedCheckOk);

  return results;
}

async function runFullSuite() {
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
    const appJs = fs.readFileSync(path.join(PUBLIC_DIR, 'v3gam-app.js'), 'utf8');
    const wakeJs = fs.readFileSync(path.join(PUBLIC_DIR, 'wake-agent.js'), 'utf8');
    const voiceJs = fs.readFileSync(path.join(PUBLIC_DIR, 'v3gam-voice-ui.js'), 'utf8');
    const testSuiteJs = fs.readFileSync(path.join(TESTS_DIR, 'browser_test_suite.js'), 'utf8');

    // Static checks for Items 3, 6, 8
    const publicHasTestSuite = fs.existsSync(path.join(PUBLIC_DIR, 'browser_test_suite.js'));
    const rootHasTestRunner = fs.existsSync(path.join(REPO_DIR, 'run_real_chrome_dom_tests.js'));
    const appHasQueryTestLoader = /browser_test_suite\.js/.test(appJs);
    const htmlHasTestScriptTag = /browser_test_suite\.js/i.test(rawLoginHtmlOnDisk);
    const supabaseSriMatch = /<script\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.117\.3\/dist\/umd\/supabase\.js"\s+integrity="sha384-[A-Za-z0-9+/=]+"[^>]*crossorigin="anonymous"><\/script>/i.test(rawLoginHtmlOnDisk);
    const onAuthUsesSetTimeout = /if\s*\(\s*event\s*===\s*["']SIGNED_IN["']\s*&&\s*session\s*\)\s*\{\s*setTimeout\s*\(\s*\(\)\s*=>\s*\{\s*orbitCompleteSignedInBootstrap\s*\(\s*session\s*\)\s*;?\s*\}\s*,\s*0\s*\)/m.test(appJs);

    const rawHtml = rawLoginHtmlOnDisk.replace(/<script\b[^>]*src="[^"]*"[^>]*><\/script>/gi, '');
    const tree = await cdp.call('Page.getFrameTree');
    const frameId = tree.frameTree.frame.id;
    await cdp.call('Runtime.evaluate', { expression: 'window.__V3GAM_LOCAL_TEST_FLAG__ = false; delete window.__runRealBrowserTests;' });
    await cdp.call('Page.setDocumentContent', { frameId, html: rawHtml });

    await cdp.call('Runtime.evaluate', {
      expression: `(() => {
        window.__v3gamOnAuthUsesSetTimeout = ${onAuthUsesSetTimeout};
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

    for (const [name, code] of [
      ['public/v3gam-app.js', appJs],
      ['public/wake-agent.js', wakeJs],
      ['public/v3gam-voice-ui.js', voiceJs],
      ['tests/browser_test_suite.js (without local flag)', testSuiteJs]
    ]) {
      const res = await cdp.call('Runtime.evaluate', {
        expression: code + `\n//# sourceURL=${name}`,
        returnByValue: true
      });
      if (res.exceptionDetails) {
        throw new Error(`EXCEPTION IN ${name}: ${JSON.stringify(res.exceptionDetails)}`);
      }
    }

    const prodCheck = await cdp.call('Runtime.evaluate', {
      returnByValue: true,
      expression: `({
        hasTestRunnerWithoutLocalFlag: typeof window.__runRealBrowserTests !== 'undefined',
        primaryOrigin: window.__HATCHABLE__ && window.__HATCHABLE__.primaryOrigin
      })`
    });
    const prodVal = prodCheck.result.value;

    // Enable local test flag in test runner only and load tests/browser_test_suite.js
    await cdp.call('Runtime.evaluate', { expression: `window.__V3GAM_LOCAL_TEST_FLAG__ = true;` });
    const suiteLoadRes = await cdp.call('Runtime.evaluate', {
      expression: testSuiteJs + `\n//# sourceURL=tests/browser_test_suite.js`,
      returnByValue: true
    });
    if (suiteLoadRes.exceptionDetails) {
      throw new Error(`EXCEPTION IN browser_test_suite.js: ${JSON.stringify(suiteLoadRes.exceptionDetails)}`);
    }

    await new Promise((r) => setTimeout(r, 150));

    const evalRes = await cdp.call('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `window.__runRealBrowserTests()`
    });

    if (evalRes.exceptionDetails) {
      throw new Error(`BROWSER EXCEPTION: ${JSON.stringify(evalRes.exceptionDetails)}`);
    }

    const report = evalRes.result.value;
    const serverResults = await runServerApiTests();

    const item6And8Pass = publicHasTestSuite === false &&
      rootHasTestRunner === false &&
      appHasQueryTestLoader === false &&
      htmlHasTestScriptTag === false &&
      prodVal.hasTestRunnerWithoutLocalFlag === false &&
      supabaseSriMatch === true &&
      prodVal.primaryOrigin === 'https://orbit-ai-task.hatchable.site';

    report.results.unshift({
      id: 'Item-6 & 8',
      category: 'Production Test Removal & Supabase SRI',
      input: 'Check /public has no test files, v3gam-app.js has no ?test=1 loader, suite requires __V3GAM_LOCAL_TEST_FLAG__, and Supabase <script> has sha384 integrity',
      actual: `publicHasTestSuite=${publicHasTestSuite}, rootHasTestRunner=${rootHasTestRunner}, appHasQueryLoader=${appHasQueryTestLoader}, hasRunnerWithoutFlag=${prodVal.hasTestRunnerWithoutLocalFlag}, supabaseHasSRI=${supabaseSriMatch}`,
      expected: 'publicHasTestSuite=false, rootHasTestRunner=false, appHasQueryLoader=false, hasRunnerWithoutFlag=false, supabaseHasSRI=true',
      pass: item6And8Pass
    });

    for (const sr of serverResults) {
      report.results.push(sr);
    }

    report.total = report.results.length;
    report.passed = report.results.filter((r) => r.pass).length;
    report.failed = report.results.filter((r) => !r.pass).length;
    report.browserVersion = version.Browser;
    report.v8Version = version['V8-Version'];

    cdp.close();
    return report;
  } finally {
    try { chrome.kill('SIGKILL'); } catch (_) {}
  }
}

async function verifyEachFixRevertFails() {
  console.log('\n================================================================================');
  console.log('ITEM 9: REVERT-EACH-FIX VERIFICATION (ONE AT A TIME -> CONFIRM TEST FAILS)');
  console.log('================================================================================');

  const mutations = [
    {
      name: 'Revert Item 1 (Move "run" out of CAT_GENERIC_WEIGHTS back into CAT_WORDS with weight 3)',
      file: path.join(PUBLIC_DIR, 'v3gam-voice-ui.js'),
      expectedFailingTestId: 'Item-1',
      mutate: (s) => s.replace('yoga: "gym", walking: "gym"', 'yoga: "gym", run: "gym", walking: "gym"').replace('    run: { cat: "gym", weight: 1 },\n', '')
    },
    {
      name: 'Revert Item 2 (Skip consent prompt and save immediately on 2nd occurrence)',
      file: path.join(PUBLIC_DIR, 'v3gam-voice-ui.js'),
      expectedFailingTestId: 'Item-2',
      mutate: (s) => s.replace(
        'return { learned: false, awaitingConsent: true, target: succeededTarget, label, prompt };',
        'this.learnedMap.set(norm, { target: succeededTarget, confidence: 0.9, failStreak: 0, lastUsedAt: now, expiresAt: now + this.TTL_MS }); return { learned: true, promoted: true, target: succeededTarget };'
      )
    },
    {
      name: 'Revert Item 3 (Remove orbitAuthNotice(err.message, true) in catch & setTimeout in onAuthStateChange)',
      file: path.join(PUBLIC_DIR, 'v3gam-app.js'),
      expectedFailingTestId: 'Item-3',
      mutate: (s) => s.replace(
        'orbitAuthNotice((err&&err.message)||"Could not load your workspace data.",true);',
        '/* reverted */'
      )
    },
    {
      name: 'Revert Item 5 Client (Use names[t.category] without ||names.personal fallback in public/v3gam-app.js)',
      file: path.join(PUBLIC_DIR, 'v3gam-app.js'),
      expectedFailingTestId: 'Item-5 (Client)',
      mutate: (s) => s.replace("esc(names[t.category]||names.personal)", "names[t.category]")
    },
    {
      name: 'Revert Item 5 Server (Stop normalizing unknown category to "personal" in api/tasks.js)',
      file: path.join(REPO_DIR, 'api', 'tasks.js'),
      expectedFailingTestId: 'Item-5 (Server)',
      mutate: (s) => s.replace(
        'const category = normalizeCategory(b.category);',
        'const category = typeof b.category === "string" ? b.category.slice(0, 40) : "study";'
      )
    },
    {
      name: 'Revert Item 6 & 8 (Drop integrity attribute from Supabase script tag in public/login.html)',
      file: path.join(PUBLIC_DIR, 'login.html'),
      expectedFailingTestId: 'Item-6 & 8',
      mutate: (s) => s.replace(
        'integrity="sha384-BWcjm9OdFth9TbhCxZPdm+gAOUMAzQy9nmTs12ioXdCcbVnJaPMn+fMUoQCLt60R" ',
        ''
      )
    },
    {
      name: 'Revert Item 7 (Execute complete_task immediately in api/assistant.js instead of returning action:"confirm")',
      file: path.join(REPO_DIR, 'api', 'assistant.js'),
      expectedFailingTestId: 'Item-7 (Server)',
      mutate: (s) => s.replace(
        "      action:'confirm',\n      proposed:{\n        action,\n        task_id:id,",
        "      action,\n      proposed:{\n        action,\n        task_id:id,"
      )
    }
  ];

  for (const m of mutations) {
    const original = fs.readFileSync(m.file, 'utf8');
    const mutated = m.mutate(original);
    if (mutated === original) {
      throw new Error(`Mutation pattern did not match in ${m.file} for ${m.name}`);
    }
    fs.writeFileSync(m.file, mutated);
    try {
      const rep = await runFullSuite();
      const targetRow = rep.results.find((r) => r.id === m.expectedFailingTestId);
      const caught = targetRow && targetRow.pass === false;
      console.log(`[${caught ? 'CAUGHT (TEST FAILED AS EXPECTED)' : 'MISSED!'}] ${m.name}`);
      console.log(`  Target Test: ${m.expectedFailingTestId} -> pass=${targetRow ? targetRow.pass : 'not found'}`);
      console.log(`  Actual on Revert: ${targetRow ? targetRow.actual : 'N/A'}`);
      if (!caught) {
        throw new Error(`Revert of ${m.name} was NOT caught by ${m.expectedFailingTestId}!`);
      }
    } finally {
      fs.writeFileSync(m.file, original);
    }
  }
  console.log('================================================================================\n');
}

async function main() {
  if (process.argv.includes('--verify-reverts')) {
    await verifyEachFixRevertFails();
  }
  const report = await runFullSuite();
  console.log('================================================================================');
  console.log('REAL HEADLESS CHROME DOM + SERVER API EXECUTION REPORT');
  console.log('================================================================================');
  console.log('Browser:        ', report.browserVersion);
  console.log('V8 Engine:      ', report.v8Version);
  console.log('User-Agent:     ', report.userAgent);
  console.log('Files Tested:   ', 'public/login.html, public/v3gam-app.js, public/wake-agent.js, public/v3gam-voice-ui.js, api/tasks.js, api/assistant.js');
  console.log('Summary:        ', `${report.passed}/${report.total} PASSED (${report.failed} FAILED)`);
  console.log('--------------------------------------------------------------------------------');
  for (const r of report.results) {
    console.log(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.id} (${r.category})`);
    console.log(`  Input:    ${r.input}`);
    console.log(`  Actual:   ${r.actual}`);
    console.log(`  Expected: ${r.expected}`);
  }
  console.log('================================================================================');
  if (report.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
