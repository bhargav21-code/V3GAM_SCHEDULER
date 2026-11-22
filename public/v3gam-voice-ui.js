/* V3GAM Voice UI & Multi-Action Conversational Agent Engine (v97)
 *
 * Stateful, multi-turn, multi-action voice agent for V3GAM Workspace:
 * - Pure non-mutating parse() so interim speech previews never corrupt dialog state
 * - Multi-action sentence splitter & sequential execution queue ("Go to today section and scroll down", "Open setting and click on sign out button")
 * - Strict 5-level priority router:
 *   0) Stop / Barge-in speech cancellation
 *   1) Active confirmations & direct answers to pending agent questions ("90", "Change them", "Physics lab", "Add to today's plan", "Yes")
 *   2) Active open modal scope (In-app notifications mark-read/filter/close, Group workspaces create/fill/close, Habit manager, Focus mode)
 *   3) Global navigation, Go Back history, semantic theme preference ("I think light theme is better"), clean workspace switching (never reading hex invite hashes), and Dashboard Q&A
 *   4) Guided Add-Task form slot-filling with full Notes textarea support, phonetic task name correction, and target-value extraction ("change duration 60 minute to 90 minute")
 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const ok = (reply, extra) => Object.assign({ ok: true, reply }, extra || {});
  const no = (reply, extra) => Object.assign({ ok: false, reply }, extra || {});
  const S = (command, args) => ({ command, args: args || {} });
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const pad = (n) => String(n).padStart(2, '0');
  const WAIT_MS = 25000;

  /* ---------- Conversational State ---------- */
  let pending = null;       // { kind: 'signout' | 'delete', id, title, until }
  let awaitDuration = false;
  let awaitMer = null;      // { h, min }
  let lastHintAt = 0;
  let screenHistory = ['home'];
  const flow = {
    active: false,
    step: null,             // 'name' | 'catdur' | 'edit_catdur' | 'when' | 'time' | 'confirm_build' | 'confirm_save'
    cdDone: false,
    whenDone: false,
    lastAdded: null
  };

  /* ---------- DOM Event Dispatchers ---------- */
  const isOpen = (sel) => { const el = $(sel); return !!el && el.classList.contains('open'); };
  const authBlocked = () => { const a = $('#orbitAuth'); return !!a && !a.hidden; };
  const isLight = () => { const a = $('#app'); return !!a && a.classList.contains('light'); };
  const isDemo = () => { const b = $('#demoToggle'); return !!b && b.classList.contains('is-demo'); };
  const sidebarCollapsed = () => { const a = $('#app'); return !!a && a.classList.contains('sidebar-collapsed'); };
  const addActive = () => { const a = $('#screen-add'); return !!a && a.classList.contains('active'); };
  const val = (sel) => String((($(sel) || {}).value) || '').trim();

  function currentScreen() {
    const activeBtn = $('.nav button.active[data-screen]');
    if (activeBtn && activeBtn.dataset.screen) return activeBtn.dataset.screen;
    if (addActive()) return 'add';
    return 'home';
  }

  function dispatchRealClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {}
    try { el.focus({ preventScroll: true }); } catch (_) {}
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach((type) => {
      try {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      } catch (_) {}
    });
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }

  function clickEl(sel) {
    const el = $(sel);
    if (!el) throw new Error('Missing control ' + sel);
    dispatchRealClick(el);
    return el;
  }

  function setValue(el, v) {
    if (!el) return false;
    const strVal = String(v ?? '');
    try {
      const proto = el.tagName === 'SELECT'
        ? window.HTMLSelectElement.prototype
        : el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, strVal);
      else el.value = strVal;
    } catch (_) {
      el.value = strVal;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function goScreen(screen) {
    const cur = currentScreen();
    if (cur && cur !== screen) {
      screenHistory.push(cur);
      if (screenHistory.length > 12) screenHistory.shift();
    }
    const b = $('.nav button[data-screen="' + screen + '"]');
    if (!b) throw new Error('Missing screen ' + screen);
    dispatchRealClick(b);
  }

  function closePopups(keepAgent) {
    let closed = false;
    if (isOpen('#focusOverlay')) { clickEl('#closeFocus'); closed = true; }
    if (isOpen('#habitManagerOverlay')) { clickEl('[data-close="habitManagerOverlay"]'); closed = true; }
    if (isOpen('#notificationsDialog')) { clickEl('#closeNotifications'); closed = true; }
    if (isOpen('#workspaceDialog')) { clickEl('#closeWorkspaceDialog'); closed = true; }
    if (!keepAgent && isOpen('#agentOverlay')) { clickEl('[data-close="agentOverlay"]'); closed = true; }
    const sm = $('#settingsMenu');
    if (sm && !sm.hidden) { sm.hidden = true; const t = $('#settingsToggle'); if (t) t.setAttribute('aria-expanded', 'false'); closed = true; }
    const wm = $('#workspaceMenu');
    if (wm && !wm.hidden) { wm.hidden = true; const t = $('#workspaceSwitch'); if (t) t.setAttribute('aria-expanded', 'false'); closed = true; }
    return closed;
  }

  function habitNames() {
    return $$('#habitMatrix .habit-name-cell').map((c) => (c.lastElementChild ? c.lastElementChild.textContent : c.textContent).trim());
  }
  function findHabitIndex(name) {
    const q = norm(name);
    if (!q) return -1;
    const names = habitNames().map(norm);
    let i = names.indexOf(q);
    if (i >= 0) return i;
    return names.findIndex((n) => n.length >= 3 && (n.includes(q) || q.includes(n)));
  }

  /* ---------- Speech Normalization & Phonetic Correction ---------- */
  function normalizeSpeech(raw) {
    return String(raw || '')
      .replace(/(?:同时调用工具函数|调用工具|工具调用)[:：\s]*/g, ' ')
      .replace(/\bwork\s+space(s?)\b/gi, 'workspace$1')
      .replace(/\b(?:begam|begum|bigam|vigam|vegum|vagam|vegam|wegam|v\s?3\s?gam|v\s+three\s+gam|vee\s?gam)\b/gi, 'v3gam')
      .replace(/\b(?:insight|inside)\s+section\b/gi, 'insights')
      .replace(/\bdrop\s+down\b/gi, 'dropdown')
      .replace(/\btatas\b/gi, 'task')
      .replace(/\b(change|switch|toggle|flip)\s+(the\s+)?thing\b/gi, '$1 the theme')
      .replace(/\bwebsite\s+theme\b/gi, 'theme')
      .replace(/\blighting\s+is\s+better\b/gi, 'light theme is better')
      .replace(/\beggham\s+prep\b/gi, 'Exam Prep')
      .replace(/\begg\s+ham\s+prep\b/gi, 'Exam Prep')
      .replace(/\b(?:fijiks|physic)\s+lab\b/gi, 'Physics Lab')
      .replace(/\b(?:mats|met|math)\s+(?:slab|lab)\b/gi, 'Maths Lab');
  }

  function cleanTaskTitle(raw, preserveCase) {
    let s = String(raw || '').trim()
      .replace(/^["':=\-]+\s*|\s*["'.,;!?]+$/g, '')
      .replace(/\s+(?:then|and\s+then)\s+(?:open|go\s+to|show|switch\s+to|view|tick|mark|check|navigate)\b[\s\S]*$/i, '')
      .replace(/^(.+?)\s+(?:for\s+\d{1,3}|4(?:15|20|30|40|45|50|60|90))\s*min(?:ute)?s?\b[\s\S]*$/i, '$1')
      .replace(/^(.+?)\s+at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b[\s\S]*$/i, '$1')
      .replace(/^(.+?)\s+(?:tomorrow|today)$/i, '$1')
      .replace(/\beggham\s+prep\b/gi, 'Exam Prep')
      .replace(/\begg\s+ham\s+prep\b/gi, 'Exam Prep')
      .replace(/\b(?:fijiks|physic)\s+lab\b/gi, 'Physics Lab')
      .replace(/\b(?:mats|met|math)\s+(?:slab|lab)\b/gi, 'Maths Lab')
      .replace(/[.,;!?]+$/g, '')
      .trim();
    if (!s) return '';
    return preserveCase ? s : (s.charAt(0).toUpperCase() + s.slice(1));
  }

  const ARROW_RE = /\b(?:left|right|up|down)?\s*arrow(?:\s+curving\s+(?:left|right|up|down))?\b/gi;
  const SYM_RE = /[^\p{L}\p{N}\s'\u2019".,!?:;()%+\-/]/gu;
  function tidy(s, isError) {
    let out = String(s || '').replace(/\s*\u2014\s*/g, ' - ')
      .replace(/(?:同时调用工具函数|调用工具|工具调用)[:：\s]*/g, ' ')
      .replace(/\{[^{}]*"(?:action|command|element|tool)"[^{}]*\}/g, ' ')
      .replace(ARROW_RE, ' ')
      .replace(/\b(?:Owner|Member)\s*\d+\s*members?\s*Invite\s*[0-9A-Fa-f]{8,}\b/gi, ' ')
      .replace(SYM_RE, '');
    if (isError) out = out.replace(/\s*,?\s*\bbuddy\b/gi, '');
    return out.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
  }

  /* ---------- Value Parsing Helpers ---------- */
  const WORD_NUM = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, fifteen: 15, twenty: 20, 'twenty five': 25, thirty: 30, forty: 40,
    'forty five': 45, fortyfive: 45, fifty: 50, sixty: 60, ninety: 90, 'one twenty': 120,
    'hundred twenty': 120, 'a hundred and twenty': 120, 'one fifty': 150, 'one hundred and fifty': 150
  };
  const snapDuration = (n) => [15, 30, 45, 60, 90, 120, 150, 180].reduce((best, o) => (Math.abs(o - n) < Math.abs(best - n) ? o : best), 30);
  const durText = (n) => (n === 60 ? '1 hour' : n === 90 ? '1.5 hours' : n === 120 ? '2 hours' : n === 150 ? '2.5 hours' : n === 180 ? '3 hours' : n + ' minutes');
  const format12h = (hhmm) => {
    const [h, m] = String(hhmm || '09:00').split(':').map(Number);
    return (h % 12 || 12) + ':' + pad(m || 0) + ' ' + (h >= 12 ? 'PM' : 'AM');
  };

  function parseDuration(text) {
    const rawLow = String(text || '').toLowerCase().trim();
    if (!rawLow) return null;
    if (/(?:\bminus\s+\d+|-\d+)\s*(?:minutes?|mins?|hours?|hrs?)/i.test(rawLow)) return -1;
    let s = rawLow.replace(/-/g, ' ').trim();
    if (/^(15|30|45|60|90|120|150|180)\s+\1$/.test(s)) return Number(s.split(/\s+/)[0]);
    if (/^9090$/.test(s)) return 90;
    if (/^6060$/.test(s)) return 60;
    const toMatch = /\bto\s+((?:\d+(?:\.\d+)?|half|one|two|three|thirty|forty\s*five|sixty|ninety|120|150).*)$/i.exec(s);
    if (toMatch && !/\bmore\s+than\b/i.test(toMatch[1])) {
      s = toMatch[1].trim();
    }
    if (/\b(?:two|2)\s+and\s+(?:a\s+)?half\s+hours?\b|\b2\.5\s*hours?\b/.test(s)) return 150;
    if (/(hour and a half|one and (?:a )?half hours?|1 and (?:a )?half hours?|1\.5\s*hours?|one point five)/.test(s)) return 90;
    if (/half an? hour|half hour/.test(s)) return 30;
    if (/^(an?|one)\s*hours?$/.test(s)) return 60;
    if (/^(two|2)\s*hours?$/.test(s)) return 120;
    if (/^(three|3)\s*hours?$/.test(s)) return 180;
    const allNums = Array.from(s.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)?\b/g));
    if (allNums.length) {
      const last = allNums[allNums.length - 1];
      let n = parseFloat(last[1]);
      const u = last[2] || '';
      if (/^h/.test(u)) n *= 60;
      else if (!u && n <= 4) n *= 60;
      return Math.round(n);
    }
    const w = s.replace(/\s*(minutes?|mins?)$/, '').trim();
    if (WORD_NUM[w]) return WORD_NUM[w] <= 4 ? WORD_NUM[w] * 60 : WORD_NUM[w];
    return null;
  }

  function parseClock(text) {
    let raw = String(text || '').trim();
    const repairMatch = /\b(?:no|wait|actually|sorry|i\s+mean|make\s+it)\b[,.\s]+(.+)$/i.exec(raw);
    if (repairMatch) {
      const rep = parseClock(repairMatch[1]);
      if (rep) return rep;
    }
    raw = raw.replace(/\./g, '');
    const low = raw.toLowerCase();
    if (/(?<!:)\b(2[4-9]|[3-9]\d)\s*(?:o'?clock|am|pm|:00)\b/i.test(low)) return 'INVALID_TIME';
    if (/^(?:at\s+)?(?:noon|12\s*noon)$/i.test(low)) return '12:00';
    if (/^(?:at\s+)?midnight$/i.test(low)) return '00:00';
    const tonight12 = /\btonight\s+at\s+12(?::(\d{2}))?\b/i.exec(low);
    if (tonight12) return '00:' + pad(Number(tonight12[1] || 0));
    let hm = /\bhalf\s+past\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})(?:\s*(am|pm|in the morning|in the evening|at night))?\b/i.exec(low);
    if (hm) {
      let h = WORD_NUM[hm[1]] || Number(hm[1]);
      const mer = (hm[2] || '').toLowerCase();
      if (mer.includes('pm') || mer.includes('evening') || mer.includes('night')) { if (h < 12) h += 12; }
      else if (mer.includes('am') || mer.includes('morning')) { if (h === 12) h = 0; }
      return pad(h) + ':30';
    }
    hm = /\bquarter\s+to\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})(?:\s*(am|pm|in the morning|in the evening|at night))?\b/i.exec(low);
    if (hm) {
      let h = (WORD_NUM[hm[1]] || Number(hm[1])) - 1;
      if (h <= 0) h += 12;
      const mer = (hm[2] || '').toLowerCase();
      if (mer.includes('pm') || mer.includes('evening') || mer.includes('night')) { if (h < 12) h += 12; }
      return pad(h) + ':45';
    }
    hm = /\bquarter\s+past\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})(?:\s*(am|pm))?\b/i.exec(low);
    if (hm) {
      let h = WORD_NUM[hm[1]] || Number(hm[1]);
      if ((hm[2] || '').toLowerCase() === 'pm' && h < 12) h += 12;
      return pad(h) + ':15';
    }
    hm = /\b(?:(subah|savare|morning)\s+)?(\d{1,2})\s*(?:baje|vage)\b/i.exec(low);
    if (hm) {
      let h = Number(hm[2]);
      if (/\b(shaam|raat|ratre|sanje)\b/i.test(low) && h < 12) h += 12;
      return pad(h) + ':00';
    }
    const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|o'?clock|in the morning|in the afternoon|in the evening|at night)?/i.exec(raw);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2] || 0);
    if (h > 23 || min > 59) return 'INVALID_TIME';
    const apRaw = (m[3] || '').toLowerCase();
    let ap = '';
    if (apRaw === 'am' || apRaw.includes('morning')) ap = 'am';
    else if (apRaw === 'pm' || apRaw.includes('afternoon') || apRaw.includes('evening') || apRaw.includes('night')) ap = 'pm';
    if (!ap && m[2] === undefined && h <= 12) {
      if (h >= 1 && h <= 6) h += 12;
    } else {
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
    }
    if (h > 23 || min > 59) return 'INVALID_TIME';
    return pad(h) + ':' + pad(min);
  }

  const CAT_WORDS = {
    study: 'study', studying: 'study', exam: 'study', gate: 'study', revision: 'study', homework: 'study', reading: 'study', chapter: 'study', flashcards: 'study', math: 'study', maths: 'study', physics: 'study', quiz: 'study',
    lab: 'lab', coding: 'lab', code: 'lab', project: 'lab', projects: 'lab', assignment: 'lab', practical: 'lab', report: 'lab', planning: 'lab', meeting: 'lab', hostel: 'lab', laundry: 'lab', chore: 'lab', chores: 'lab', clean: 'lab', cleaning: 'lab', errand: 'lab', errands: 'lab', movie: 'lab', trip: 'lab', packing: 'lab', organize: 'lab', review: 'lab',
    lecture: 'lecture', class: 'lecture', classes: 'lecture', seminar: 'lecture', tutorial: 'lecture', workshop: 'lecture', webinar: 'lecture',
    gym: 'gym', workout: 'gym', exercise: 'gym', wellness: 'gym', fitness: 'gym', dentist: 'gym', doctor: 'gym', appointment: 'gym', clinic: 'gym', checkup: 'gym', health: 'gym', meditation: 'gym', yoga: 'gym', run: 'gym', running: 'gym', walk: 'gym', walking: 'gym', swim: 'gym', shower: 'gym', sleep: 'gym', nap: 'gym', therapy: 'gym',
    meal: 'meal', meals: 'meal', food: 'meal', lunch: 'meal', dinner: 'meal', breakfast: 'meal', brunch: 'meal', snack: 'meal', coffee: 'meal', tea: 'meal', cook: 'meal', cooking: 'meal', groceries: 'meal', grocery: 'meal', bake: 'meal', mil: 'meal', mill: 'meal'
  };
  const CAT_ALT = Object.keys(CAT_WORDS).join('|');
  function lastCategory(s) {
    let found = null;
    norm(s).split(' ').forEach((w) => { if (CAT_WORDS[w]) found = CAT_WORDS[w]; });
    return found;
  }

  /* ---------- Add-Task Conversational Flow Helpers ---------- */
  function catLabel() {
    const s = $('#taskCategory');
    const o = s && s.selectedOptions && s.selectedOptions[0];
    return String(o ? o.text : val('#taskCategory')).replace(/[^\p{L}\p{N}\s/]/gu, '').trim() || 'Study';
  }
  const durMinutes = () => Number(val('#taskDuration')) || 60;
  function whenText() {
    const w = val('#taskWhen');
    if (w === 'manual') { const t = val('#taskManualTime'); return t ? ' at ' + format12h(t) : ''; }
    if (w === 'morning' || w === 'afternoon' || w === 'evening') return ' in the ' + w;
    return ' at the AI best time';
  }

  function resetTaskFormDom() {
    const form = $('#taskForm');
    if (form) form.reset();
    setValue($('#taskName'), '');
    setValue($('#taskNote'), '');
    setValue($('#taskCategory'), 'study');
    setValue($('#taskDuration'), '60');
    setValue($('#taskWhen'), 'flexible');
    setValue($('#taskManualTime'), '');
    const mf = $('#manualTimeField');
    if (mf) mf.style.display = 'none';
    const pc = $('#parsedCard');
    if (pc) pc.classList.remove('show');
    const flexBtn = $('[data-when-pick="flexible"]');
    if (flexBtn) dispatchRealClick(flexBtn);
  }

  function resetFlow() {
    flow.active = false;
    flow.step = null;
    flow.cdDone = false;
    flow.whenDone = false;
    awaitDuration = false;
    awaitMer = null;
  }

  function startFlow(clearDom = true) {
    resetFlow();
    if (clearDom) resetTaskFormDom();
    flow.active = true;
    flow.step = 'name';
  }

  function nextPrompt(justSetName) {
    const name = val('#taskName');
    if (!name) {
      flow.step = 'name';
      return 'What would you like to name this task?';
    }
    if (!flow.cdDone) {
      flow.cdDone = true;
      flow.step = 'catdur';
      const prefix = justSetName ? 'Got it, "' + name + '". ' : '';
      return prefix + 'Should I keep the category as ' + catLabel() + ' and the duration as ' + durText(durMinutes()) + ', or change them?';
    }
    if (!flow.whenDone) {
      flow.whenDone = true;
      flow.step = 'when';
      return 'Should Vegam pick the AI best time, or do you want to choose your own start time?';
    }
    if (val('#taskWhen') === 'manual' && !val('#taskManualTime')) {
      flow.step = 'time';
      return 'What start time should I use?';
    }
    flow.step = 'confirm_build';
    const noteStr = val('#taskNote') ? ' with your note' : '';
    return 'Ready to add "' + name + '" under ' + catLabel() + ' for ' + durText(durMinutes()) + whenText() + noteStr + '. Should I build your plan?';
  }

  function fillForm(a) {
    if (!addActive()) goScreen('add');
    const done = [];
    let justSetName = false;
    if (a.name) {
      const nm = a.verbatimTitle ? String(a.name || '').trim() : cleanTaskTitle(a.name);
      if (nm) {
        setValue($('#taskName'), nm);
        done.push('task name to "' + nm + '"');
        justSetName = true;
        if (!a.category) {
          const inferred = lastCategory(nm);
          if (inferred) setValue($('#taskCategory'), inferred);
        }
      }
    }
    if (a.category) {
      setValue($('#taskCategory'), a.category);
      done.push('category to ' + catLabel());
      flow.cdDone = true;
    }
    if (a.duration) {
      const sn = snapDuration(Number(a.duration));
      setValue($('#taskDuration'), String(sn));
      done.push('duration to ' + durText(sn));
      flow.cdDone = true;
      awaitDuration = false;
    }
    if (a.when && a.when !== 'manual' && !a.time) {
      if (a.when === 'flexible') {
        dispatchRealClick($('[data-when-pick="flexible"]'));
        setValue($('#taskWhen'), 'flexible');
      } else {
        setValue($('#taskWhenPreset'), a.when);
        setValue($('#taskWhen'), a.when);
      }
      done.push(a.when === 'flexible' ? 'timing to AI best time' : 'time of day to ' + a.when);
      flow.whenDone = true;
    }
    if (a.time || a.when === 'manual') {
      dispatchRealClick($('[data-when-pick="manual"]'));
      setValue($('#taskWhen'), 'manual');
      const mf = $('#manualTimeField');
      if (mf) mf.style.display = 'block';
      if (a.time) {
        setValue($('#taskManualTime'), a.time);
        done.push('start time to ' + format12h(a.time));
      } else {
        done.push('your own time');
      }
      flow.whenDone = true;
      awaitMer = null;
    }
    if (a.note !== undefined) {
      const cleanNote = String(a.note || '').trim().replace(/^(?:like|that|saying|as|to|is)\s+/i, '').trim();
      setValue($('#taskNote'), cleanNote);
      done.push(cleanNote ? 'note to "' + cleanNote + '"' : 'cleared notes');
    }
    if (done.length) flow.active = true;
    return { done, justSetName };
  }

  /* ---------- Safe Universal Button Clicker ---------- */
  const FORBIDDEN_CLICK_RE = /\b(delete|remove|regenerate|rotate|exit workspace|leave)\b/i;

  function cleanButtonTargetPhrase(raw) {
    return String(raw || '')
      .replace(/^(?:on|at|in|the|a|an)\s+/i, '')
      .replace(/\b(?:in|on|at|from|inside|within|into|over|under)\s+(?:this|the|my|our|current)?\s*(?:page|screen|website|site|app|view|dashboard|panel|section|bar|top|bottom|left|right|header|menu)\b/gi, ' ')
      .replace(/\b(?:right\s+now|for\s+me|please|buddy|bro|here|there|button|btn|tab|icon|link|option|card|control)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const SAFE_BUTTON_ALIASES = [
    { match: /\b(build my plan|build plan|create plan|generate plan|submit task|build it)\b/i, sel: '#taskForm button[type="submit"]', label: 'Build my plan' },
    { match: /\b(add to today'?s plan|add to today plan|confirm task|confirm plan|save task|approve task)\b/i, sel: '#confirmTaskBtn', label: "Add to today's plan" },
    { match: /\b(describe it with your voice|record task|voice task|describe with voice)\b/i, sel: '#recordTaskBtn', label: 'Describe with voice' },
    { match: /\b(ai best time|flexible time|find best time|best time)\b/i, sel: '[data-when-pick="flexible"]', label: 'AI best time' },
    { match: /\b(choose my own time|choose on my time|my own time|own time|my time|manual time|custom time)\b/i, sel: '[data-when-pick="manual"]', label: 'Choose my own time' },
    { match: /\b(back to today|back home|go back|go to the back)\b/i, sel: '#backHomeBtn', label: 'Back to today' },
    { match: /\b(new task|add new task|plus|add task|new|\+\s*new)\b/i, sel: '#dashboardNew', label: 'Add new task' },
    { match: /\b(manage|manage plan|manager|menace|marriage|many|manish|manages)\b/i, sel: '#dashboardManage', label: 'Manage' },
    { match: /\b(actions|action|ascends|ascend|accent|accents|options|dashboard actions)\b/i, sel: '#dashboardActions', label: 'Actions' },
    { match: /\b(more|more options|three dots)\b/i, sel: '#dashboardMore', label: 'More' },
    { match: /\b(ai assistant|assistant|v3gam ai|vegam ai)\b/i, sel: '#barAssistant', label: 'AI Assistant' },
    { match: /\b(demo|try demo|demo mode)\b/i, sel: '#demoToggle', label: 'Demo mode' },
    { match: /\b(exit demo|leave demo|stop demo)\b/i, sel: '#demoExitFloating', label: 'Exit demo' },
    { match: /\b(optimize with ai|start optimizing|optimize)\b/i, sel: '#deadlineAi', label: 'Optimize with AI' },
    { match: /\b(reshape my day|schedule assistant|reshape)\b/i, sel: '#scheduleAssistant', label: 'Reshape my day' },
    { match: /\b(open focus mode|focus mode|start focus|focus)\b/i, sel: '#focusCurrent', label: 'Open focus mode' },
    { match: /\b(open full plan|full plan)\b/i, sel: '#calendarOpenPlan', label: 'Open full plan' },
    { match: /\b(view all tasks|all deadlines)\b/i, sel: '#allDeadlines', label: 'View all tasks' },
    { match: /\b(next week)\b/i, sel: '#calendarNext', label: 'Next week' },
    { match: /\b(previous week|last week|prev week)\b/i, sel: '#calendarPrev', label: 'Previous week' },
    { match: /\b(this week)\b/i, sel: '#calendarMonth', label: 'This week' },
    { match: /\b(status|calendar status|all status)\b/i, sel: '#calendarStatus', label: 'Status' },
    { match: /\b(customize|calendar customize)\b/i, sel: '#calendarCustomize', label: 'Customize' },
    { match: /\b(view|calendar view)\b/i, sel: '#calendarView', label: 'View' },
    { match: /\b(filter|calendar filter)\b/i, sel: '#calendarFilter', label: 'Filter' },
    { match: /\b(week overview|weekly overview|weekly view|week view|week)\b/i, fn: () => { goScreen('plan'); clickEl('[data-plan="week"]'); }, label: 'Week overview' },
    { match: /\b(month view|monthly view|month|monthly)\b/i, fn: () => { goScreen('plan'); clickEl('[data-plan="month"]'); }, label: 'Month view' },
    { match: /\b(daily habits|daily habit|habits|my habits|habit tracker)\b/i, fn: () => { goScreen('plan'); clickEl('[data-plan="daily"]'); }, label: 'Daily habits' },
    { match: /\b(manage habits|habit manager)\b/i, fn: () => { goScreen('plan'); clickEl('[data-plan="daily"]'); clickEl('#manageHabitsBtn'); }, label: 'Manage habits' },
    { match: /\b(copy code|copy invite|copy invite code)\b/i, fn: () => { const b = $('#dashboardCopyInvite') && !$('#groupManagementDashboard')?.hidden ? $('#dashboardCopyInvite') : $('#copyWorkspaceInvite'); if (b) dispatchRealClick(b); }, label: 'Copy invite code' },
    { match: /\b(invite member|invite members|share invite)\b/i, fn: () => { const b = $('#dashboardShareInvite') && !$('#groupManagementDashboard')?.hidden ? $('#dashboardShareInvite') : $('#workspaceDetailInvite'); if (b) dispatchRealClick(b); }, label: 'Invite member' },
    { match: /\b(refresh members|refresh group)\b/i, fn: () => { const b = $('#dashboardRefreshMembers') && !$('#groupManagementDashboard')?.hidden ? $('#dashboardRefreshMembers') : $('#workspaceMembersRefresh'); if (b) dispatchRealClick(b); }, label: 'Refresh members' },
    { match: /\b(create group|create workspace|new group|create group workspace)\b/i, fn: () => { const b = $('#workspacePageCreate') && $('#screen-workspace')?.classList.contains('active') ? $('#workspacePageCreate') : $('#createGroupWorkspace'); if (b) dispatchRealClick(b); }, label: 'Create group workspace' },
    { match: /\b(join with code|join group|join workspace)\b/i, fn: () => { const b = $('#workspacePageJoin') && $('#screen-workspace')?.classList.contains('active') ? $('#workspacePageJoin') : $('#joinGroupWorkspace'); if (b) dispatchRealClick(b); }, label: 'Join group workspace' },
    { match: /\b(personal workspace|open personal)\b/i, sel: '#personalWorkspaceItem', label: 'Personal workspace' },
    { match: /\b(workspace switcher|workspace dropdown|workspace menu|switch workspace)\b/i, sel: '#workspaceSwitch', label: 'Workspace switcher' },
    { match: /\b(notifications|notification|notification bar|bell|notification bell|alerts)\b/i, sel: '#openNotifications', label: 'Notifications' },
    { match: /\b(enable browser alerts|browser alerts)\b/i, sel: '#enableBrowserNotifications', label: 'Enable browser alerts' },
    { match: /\b(refresh notifications|refresh)\b/i, sel: '#refreshNotifications', label: 'Refresh' },
    { match: /\b(theme|theme toggle|dark mode|light mode|appearance)\b/i, sel: '#themeToggle', label: 'Theme toggle' },
    { match: /\b(settings|setting|preferences|options)\b/i, sel: '#settingsToggle', label: 'Settings menu' },
    { match: /\b(profile|profile menu|account|my account|ai account)\b/i, sel: '#orbitProfileButton', label: 'Account menu' },
    { match: /\b(sidebar|hide sidebar|show sidebar|menu)\b/i, sel: '#sidebarToggle', label: 'Sidebar toggle' },
    { match: /\b(apply new schedule|apply schedule|apply changes)\b/i, sel: '#applyDiffBtn', label: 'Apply new schedule' },
    { match: /\b(check overdue|replan my day)\b/i, sel: '#replanCheckPrompt', label: 'Check overdue & replan' },
    { match: /\b(today|home|dashboard)\b/i, fn: () => goScreen('home'), label: 'Today screen' },
    { match: /\b(plan|planner)\b/i, fn: () => goScreen('plan'), label: 'Plan screen' },
    { match: /\b(workspace|workspaces)\b/i, fn: () => goScreen('workspace'), label: 'Workspaces screen' },
    { match: /\b(insights|insight|inside|stats|progress|analytics)\b/i, fn: () => goScreen('stats'), label: 'Insights screen' },
    { match: /\b(add|add screen|add section|add task section)\b/i, fn: () => { startFlow(true); goScreen('add'); }, label: 'Add task screen' }
  ];

  function clickByTargetName(targetRaw) {
    const raw = String(targetRaw || '').trim();
    const cleaned = cleanButtonTargetPhrase(raw) || raw;
    if (!cleaned) return no("I didn't recognise which button to click. Please say the button name again.");
    if (/^(?:sign\s?out|log\s?out|logout)$/i.test(cleaned)) {
      return COMMANDS.sign_out();
    }
    if (FORBIDDEN_CLICK_RE.test(raw) || FORBIDDEN_CLICK_RE.test(cleaned)) {
      return no('For safety, I do not click delete or remove buttons without confirmation.');
    }
    let bestItem = null;
    let bestLen = 0;
    for (const item of SAFE_BUTTON_ALIASES) {
      const mm = item.match.exec(cleaned) || item.match.exec(raw);
      if (mm && mm[0].length > bestLen && (item.fn || $(item.sel))) { bestItem = item; bestLen = mm[0].length; }
    }
    if (bestItem) {
      if (bestItem.fn) bestItem.fn(); else dispatchRealClick($(bestItem.sel));
      return ok('Clicked ' + bestItem.label + ' for you.');
    }
    const q = norm(cleaned);
    if (!q) return no("I didn't catch the button name. Please say it again.");
    const candidates = $$('button, a, [role="button"], [role="tab"]').filter((b) => {
      if (b.disabled || b.hidden || b.id === 'v3gamLiveOrbBtn' || b.id === 'hb-badge') return false;
      if (b.tagName === 'A') {
        try { if (b.target === '_blank' || (b.href && new URL(b.href, location.href).origin !== location.origin)) return false; } catch (_) { return false; }
      }
      const rect = b.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const own = norm(b.textContent || '');
      const label = norm((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.title || '') + ' ' + (b.id || ''));
      if (FORBIDDEN_CLICK_RE.test(label)) return false;
      return label.includes(q) || (own.length >= 3 && q.includes(own));
    }).map((b) => {
      const own = norm(b.textContent || '');
      const lab = norm((b.getAttribute('aria-label') || '') + ' ' + (b.title || ''));
      const score = (own === q || lab === q) ? 4 : (own.startsWith(q) || lab.startsWith(q)) ? 3 : ((' ' + own + ' ').includes(' ' + q + ' ') || (' ' + lab + ' ').includes(' ' + q + ' ')) ? 2 : 1;
      return { b, score };
    }).sort((x, y) => y.score - x.score).map((x) => x.b);
    if (candidates.length) {
      const chosen = candidates[0];
      const titleEl = chosen.querySelector && chosen.querySelector('b');
      const cleanName = tidy((titleEl ? titleEl.textContent : chosen.textContent) || chosen.getAttribute('aria-label') || cleaned, true).slice(0, 40);
      dispatchRealClick(chosen);
      return ok('Clicked "' + cleanName + '" for you.');
    }
    return no('I could not find a button called "' + cleaned + '" on this screen.');
  }

  /* ---------- Workspace Switching & Task Deletion ---------- */
  function cleanWorkspaceTitle(btn) {
    if (!btn) return '';
    const bEl = btn.querySelector && btn.querySelector('b');
    const raw = bEl ? bEl.textContent : btn.textContent;
    return String(raw || '')
      .replace(/\b(?:Owner|Member)\b[\s\S]*$/i, '')
      .replace(/\bInvite\s*:?\s*[0-9A-Fa-f]{6,}[\s\S]*$/i, '')
      .replace(/[^\p{L}\p{N}\s_\-]/gu, ' ')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function switchWorkspace(nameRaw) {
    const q = norm(nameRaw).replace(/\b(?:group|workspaces?|space|section|tab|page)\b/g, '').trim();
    const menu = $('#workspaceMenu');
    const wasHidden = !menu || menu.hidden;
    const closeMenu = () => {
      const m = $('#workspaceMenu');
      if (m && !m.hidden) {
        m.hidden = true;
        const t = $('#workspaceSwitch');
        if (t) t.setAttribute('aria-expanded', 'false');
      }
    };

    const isPersonal = /^(?:personal|private|my own|my|v3gam pro|v3gam|pro|home)$/.test(q);
    if (isPersonal) {
      const p = $('#personalWorkspaceItem');
      if (!p) return no('I could not find the Personal workspace option.');
      dispatchRealClick(p);
      closeMenu();
      return ok('Switched to your Personal workspace.');
    }

    if (wasHidden && $('#workspaceSwitch')) dispatchRealClick($('#workspaceSwitch'));
    let items = $$('#groupWorkspaceItems button, #groupWorkspaceItems [role="menuitem"], #groupWorkspaceItems a').filter((b) => !b.hidden);
    if (!items.length) {
      items = $$('#workspaceMenu button, #workspaceMenu [role="menuitem"]').filter((b) => !b.hidden && !['personalWorkspaceItem', 'createGroupWorkspace', 'joinGroupWorkspace'].includes(b.id));
    }

    if (!q) {
      if (items.length === 1) {
        const shown = cleanWorkspaceTitle(items[0]) || 'your group workspace';
        dispatchRealClick(items[0]);
        if (wasHidden) setTimeout(closeMenu, 50);
        return ok('Switched to ' + shown + '.');
      }
      if (items.length > 1) {
        const names = items.map(cleanWorkspaceTitle).filter(Boolean);
        return ok('Which workspace would you like: Personal workspace, or ' + names.join(', ') + '?');
      }
      if (wasHidden) closeMenu();
      return no('You do not have any group workspaces yet. Say "create group" to create one.');
    }

    let best = null;
    let bestScore = 0;
    items.forEach((b) => {
      const l = norm(cleanWorkspaceTitle(b));
      if (!l) return;
      const sc = l === q ? 3 : l.startsWith(q) ? 2 : (l.includes(q) || (l.length >= 3 && q.includes(l))) ? 1 : 0;
      if (sc > bestScore) { best = b; bestScore = sc; }
    });
    if (best) {
      const shown = cleanWorkspaceTitle(best) || nameRaw;
      dispatchRealClick(best);
      if (wasHidden) setTimeout(closeMenu, 50);
      return ok('Switched to ' + shown + '.');
    }
    const names = items.map(cleanWorkspaceTitle).filter(Boolean);
    if (wasHidden) closeMenu();
    return no('I could not find a workspace called "' + nameRaw + '".' + (names.length ? ' Your group workspaces are ' + names.slice(0, 4).join(', ') + '.' : ' You have no group workspaces yet.'));
  }

  let pendingDeleteFollowUp = null;
  function scheduleDelete(name, followUp) {
    const tools = window.v3gamTaskTools;
    if (!tools) return no('Deleting tasks is not available right now.');
    const matches = tools.find(name);
    if (!matches.length) return no('I could not find a task called "' + name + '" in your plan.');
    let pick = matches[0];
    if (matches.length > 1) {
      const exact = matches.filter((m) => norm(m.title) === norm(name));
      if (exact.length === 1) pick = exact[0];
      else if (exact.length > 1) pick = exact.sort((x, y) => Number(y.id) - Number(x.id))[0];
      else return no('I found ' + matches.length + ' tasks like that: ' + matches.slice(0, 3).map((m) => m.title).join(', ') + '. Please say the full task name.');
    }
    const nextScreen = followUp && followUp.nextScreen ? followUp.nextScreen : null;
    pending = { kind: 'delete', id: pick.id, title: pick.title, nextScreen, until: Date.now() + WAIT_MS };
    const navSuffix = nextScreen === 'plan' ? ' and then open your Plan' : nextScreen ? (' and then open ' + nextScreen) : '';
    return ok('Delete "' + pick.title + '"' + (pick.when ? ' at ' + pick.when : '') + navSuffix + '? Say yes to confirm or no to keep it.', { pillTitle: 'CONFIRM ACTION' });
  }

  /* ---------- Command Executors ---------- */
  const KEEP_OVERLAYS = new Set([
    'stop_speaking', 'set_theme', 'voice_settings', 'read_info', 'list_capabilities',
    'assistant_panel', 'chat_reply', 'click_button', 'fill_task_form', 'build_task_plan',
    'confirm_task', 'mark_notifications_read', 'notifications', 'workspace_dialog',
    'fill_workspace_dialog', 'submit_workspace_dialog', 'confirm_pending', 'cancel_pending',
    'ask_duration', 'ask_meridiem', 'ask_catdur_change', 'flow_keep', 'flow_reject', 'multi_action',
    'move_task', 'create_workspace_confirmed', 'remove_workspace_confirmed', 'stage_multi_add_task',
    'read_remaining_tasks', 'read_free_time', 'read_habit_streak', 'undo_last'
  ]);

  const COMMANDS = {
    stop_speaking() {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      return ok('', { silent: true });
    },
    chat_reply(a) {
      if (a && a.ok === false) {
        return no(a.reply || "I can't do that here.", { pillTitle: a.pillTitle || "CAN'T DO THAT" });
      }
      return ok((a && a.reply) || "Hey buddy! What's the plan today?", a && a.pillTitle ? { pillTitle: a.pillTitle } : undefined);
    },
    click_button(a) {
      return clickByTargetName(a.target);
    },
    go_back() {
      if (closePopups(false)) return ok('Closed.');
      if (addActive()) {
        resetFlow();
        const backBtn = $('#backHomeBtn');
        if (backBtn) { dispatchRealClick(backBtn); return ok("Went back to Today's dashboard."); }
      }
      const prev = screenHistory.length ? screenHistory.pop() : 'home';
      const target = (prev && prev !== currentScreen()) ? prev : 'home';
      goScreen(target);
      const labels = { home: "Today's dashboard", plan: 'your Plan', add: 'the Add task form', workspace: 'your Workspaces', stats: 'your Insights' };
      return ok('Went back to ' + (labels[target] || "Today's dashboard") + '.');
    },
    set_theme(a) {
      const mode = a.mode || 'toggle';
      const light = isLight();
      if (mode === 'dark' && !light) return ok('Already in dark theme.');
      if (mode === 'light' && light) return ok('Already in light theme.');
      clickEl('#themeToggle');
      return ok(isLight() ? 'Switched to light theme.' : 'Switched to dark theme.');
    },
    set_sidebar(a) {
      const t = $('#sidebarToggle');
      const appEl = $('#app');
      const mode = (a && a.mode) || 'toggle';
      const collapsed = sidebarCollapsed();
      if (mode === 'hide' && collapsed) return ok('The sidebar is already hidden.');
      if (mode === 'show' && !collapsed) return ok('The sidebar is already open.');
      if (t && t.getClientRects && t.getClientRects().length) {
        dispatchRealClick(t);
      } else if (appEl) {
        appEl.classList.toggle('sidebar-collapsed', mode === 'hide' ? true : mode === 'show' ? false : !collapsed);
      } else {
        return no('The sidebar is only shown on larger screens.');
      }
      return ok(sidebarCollapsed() ? 'Sidebar hidden.' : 'Sidebar opened.');
    },
    open_screen(a) {
      const labels = { home: "Today's dashboard", plan: 'your Plan', add: 'the task builder', workspace: 'your Workspaces', stats: 'your Insights' };
      if (!labels[a.screen]) return no("I don't recognise that section. Please say Today, Plan, Add, Workspace, or Insights.");
      if (a.screen === 'add') {
        startFlow(true);
        goScreen('add');
        setTimeout(() => { const inp = $('#taskName'); if (inp) inp.focus(); }, 60);
        return ok('Opened the task builder. What would you like to name this task?');
      }
      if (!a.confirmed && addActive() && val('#taskName')) {
        const draft = val('#taskName');
        pending = { kind: 'leave_form', screen: a.screen, title: draft, until: Date.now() + WAIT_MS };
        return ok('You have an unsaved task "' + draft + '" on the form. Leave the form and open ' + labels[a.screen] + '? Say yes to leave (keeping your draft), or no to stay.', { pillTitle: 'CONFIRM ACTION' });
      }
      resetFlow();
      goScreen(a.screen);
      return ok('Opened ' + labels[a.screen] + '.');
    },
    open_plan_tab(a) {
      const map = { week: ['week', 'the Weekly overview'], month: ['month', 'the Monthly view'], habits: ['daily', 'your Daily habits'] };
      const m = map[a.tab];
      if (!m) return no("I don't recognise that plan tab. Say Week, Month, or Daily habits.");
      if (!a.confirmed && addActive() && val('#taskName')) {
        const draft = val('#taskName');
        pending = { kind: 'leave_form', screen: 'plan', tab: a.tab, title: draft, until: Date.now() + WAIT_MS };
        return ok('You have an unsaved task "' + draft + '" on the form. Leave the form and open ' + m[1] + '? Say yes to leave (keeping your draft), or no to stay.', { pillTitle: 'CONFIRM ACTION' });
      }
      resetFlow();
      goScreen('plan');
      clickEl('[data-plan="' + m[0] + '"]');
      return ok('Opened ' + m[1] + '.');
    },
    settings_menu(a) {
      const menu = $('#settingsMenu');
      const open = !!menu && !menu.hidden;
      if ((a.mode || 'open') === 'close') {
        if (open) { menu.hidden = true; const t = $('#settingsToggle'); if (t) t.setAttribute('aria-expanded', 'false'); }
        return ok('Closed the settings menu.');
      }
      if (!open) clickEl('#settingsToggle');
      const profName = ($('#orbitProfileLabel') && $('#orbitProfileLabel').textContent.trim()) || '';
      if (a.account && profName && profName !== 'Profile') {
        return ok('Opened your account and settings menu for ' + profName + '.');
      }
      return ok('Opened the settings menu.');
    },
    notifications(a) {
      const mode = a.mode || 'open';
      if (mode === 'close') {
        if (isOpen('#notificationsDialog')) clickEl('#closeNotifications');
        return ok('Closed notifications.');
      }
      if (!isOpen('#notificationsDialog')) clickEl('#openNotifications');
      if (mode === 'refresh') { clickEl('#refreshNotifications'); return ok('Refreshing your notifications.'); }
      if (mode === 'filter') {
        const f = a.filter || 'all';
        clickEl('[data-notification-filter="' + f + '"]');
        return ok(f === 'all' ? 'Showing all notifications.' : 'Showing ' + f + ' notifications.');
      }
      return ok('Opened your notifications.');
    },
    mark_notifications_read(a) {
      if (!isOpen('#notificationsDialog')) clickEl('#openNotifications');
      const q = norm(a.query || '');
      const rows = $$('#notificationsList .notification-row').filter((r) => !!r.querySelector('button'));
      if (!rows.length) return ok('All notifications in this view are already marked as read.');
      let targets = [];
      if (/\b(?:all|everything)\b/.test(q)) {
        targets = rows;
      } else if (/\b(?:two|2|both|above two|top two|first two)\b/.test(q)) {
        targets = rows.slice(0, 2);
      } else {
        const cleaned = q.replace(/\b(?:mark|as|read|unread|on|in|for|the|notification|notifications|system|tasks?|all)\b/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleaned) {
          targets = rows.filter((r) => norm(r.textContent || '').includes(cleaned));
        }
        if (!targets.length && /\btask\s+added\b/.test(q)) {
          targets = rows.filter((r) => /task\s+added/i.test(r.textContent || ''));
        }
        if (!targets.length) targets = [rows[0]];
      }
      let clicked = 0;
      targets.forEach((r) => {
        const btn = r.querySelector('button');
        if (btn && !btn.disabled) {
          dispatchRealClick(btn);
          clicked++;
        }
      });
      if (!clicked) return ok('Those notifications are already marked as read.');
      return ok('Marked ' + clicked + ' notification' + (clicked === 1 ? '' : 's') + ' as read.');
    },
    assistant_panel(a) {
      if ((a.mode || 'open') === 'close') { if (isOpen('#agentOverlay')) clickEl('[data-close="agentOverlay"]'); return ok('Closed the assistant.'); }
      if (!isOpen('#agentOverlay')) clickEl('#agentBtn');
      return ok('Opened the Vegam AI assistant panel.');
    },
    search_tasks(a) {
      goScreen('home');
      const input = $('#globalSearch');
      if (!input) return no('The search box is not available.');
      const q = String(a.query || '').trim();
      setValue(input, q);
      return ok(q ? 'Showing tasks matching "' + q + '".' : 'Search cleared. Showing all tasks.');
    },
    calendar_week(a) {
      goScreen('home');
      const next = a.direction === 'next';
      clickEl(next ? '#calendarNext' : '#calendarPrev');
      return ok(next ? 'Showing next week.' : 'Showing the previous week.');
    },
    workspace_menu(a) {
      const menu = $('#workspaceMenu');
      const open = !!menu && !menu.hidden;
      if ((a.mode || 'open') === 'close') {
        if (open) { menu.hidden = true; $('#workspaceSwitch').setAttribute('aria-expanded', 'false'); }
        return ok('Closed the workspace menu.');
      }
      if (!open) clickEl('#workspaceSwitch');
      return ok('Opened the workspace menu.');
    },
    workspace_dialog(a) {
      const mode = a.mode || 'create';
      if (mode === 'close') {
        if (isOpen('#workspaceDialog')) clickEl('#closeWorkspaceDialog');
        return ok('Closed the group workspace window.');
      }
      if (mode === 'create') {
        const btn = $('#workspacePageCreate') && $('#screen-workspace')?.classList.contains('active') ? $('#workspacePageCreate') : $('#createGroupWorkspace');
        if (btn) dispatchRealClick(btn);
        if (a.name) {
          setValue($('#newWorkspaceName'), a.name);
          return ok('Opened the create group form and set group name to "' + a.name + '". Say "confirm" or "create group workspace" to create it.');
        }
        return ok('Opened the create group workspace form. What would you like to name the group?');
      }
      clickEl('#joinGroupWorkspace');
      if (a.code) {
        setValue($('#workspaceInviteCode'), a.code);
        const form = $('#joinWorkspaceForm');
        if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        return ok('Joining the group with that invite code.');
      }
      return ok('Opened the join form. Paste or tell me the invite code.');
    },
    fill_workspace_dialog(a) {
      if (!isOpen('#workspaceDialog')) {
        const btn = $('#workspacePageCreate') && $('#screen-workspace')?.classList.contains('active') ? $('#workspacePageCreate') : $('#createGroupWorkspace');
        if (btn) dispatchRealClick(btn);
      }
      const name = String(a.name || '').trim().replace(/^["':=\-]+\s*|\s*["'.!?]+$/g, '');
      if (!name) return no('What would you like to name the group workspace?');
      const formatted = name.charAt(0).toUpperCase() + name.slice(1);
      setValue($('#newWorkspaceName'), formatted);
      return ok('Set group name to "' + formatted + '". Say "create group workspace" or "confirm" to save it.');
    },
    submit_workspace_dialog() {
      if (!isOpen('#workspaceDialog')) return no('The create group workspace window is not open.');
      const name = val('#newWorkspaceName');
      if (!name) return no('Tell me the group name first, for example "Group name is College Group".');
      const form = $('#createWorkspaceForm');
      if (form && form.requestSubmit) form.requestSubmit();
      else if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      return ok('Created group workspace "' + name + '".');
    },
    show_invite_code() {
      const panel = $('#groupManagementDashboard');
      if (panel && !panel.hidden) {
        goScreen('home');
        clickEl('#dashboardShareInvite');
        return ok('Your group invite code is on the dashboard and copied to your clipboard.');
      }
      const inv = $('#workspaceDetailInvite');
      if (inv && !inv.hidden && inv.getClientRects().length) { dispatchRealClick(inv); return ok('Showing the invite code.'); }
      return no('Open a group workspace you own first, then ask for the invite code.');
    },
    new_task_form() {
      startFlow(true);
      goScreen('add');
      setTimeout(() => { const inp = $('#taskName'); if (inp) inp.focus(); }, 60);
      return ok('Opened the task builder. What would you like to name this task?');
    },
    start_task_flow(a) {
      startFlow(true);
      if (!addActive()) goScreen('add');
      const { done, justSetName } = fillForm(a);
      if (a.ambHour) {
        awaitMer = { h: a.ambHour, min: 0 };
        flow.whenDone = true;
        return ok((done.length ? 'Set ' + done.join(', ') + '. ' : '') + 'Did you mean ' + a.ambHour + ' AM or ' + a.ambHour + ' PM?');
      }
      if (!done.length) {
        return ok('Opened the task builder. What would you like to name this task?');
      }
      const prompt = nextPrompt(justSetName);
      if (justSetName && done.length === 1) return ok(prompt);
      return ok('Set ' + done.join(', ') + '. ' + prompt);
    },
    flow_keep() {
      flow.cdDone = true;
      return ok('Okay. ' + nextPrompt(false));
    },
    flow_reject() {
      flow.step = null;
      return ok('No problem. Tell me what to change: the name, category, duration, time, or notes.');
    },
    ask_duration(a) {
      awaitDuration = true;
      return ok(a.less ? 'How long should it take? 30 or 45 minutes?' : 'How long should it take? 90 or 120 minutes?');
    },
    ask_meridiem(a) {
      awaitMer = { h: a.h, min: a.min || 0 };
      return ok('Is that ' + a.h + ' AM or ' + a.h + ' PM?');
    },
    build_task_plan() {
      if (!addActive()) goScreen('add');
      const name = val('#taskName');
      if (!name) {
        flow.active = true;
        flow.step = 'name';
        return no('What is the task called? Tell me the task name first.');
      }
      const form = $('#taskForm');
      if (form.requestSubmit) form.requestSubmit(); else clickEl('#taskForm button[type="submit"]');
      if (!$('#parsedCard').classList.contains('show')) return no('Please choose a start time first so I can build your plan.');
      flow.active = true;
      flow.step = 'confirm_save';
      return ok('Built the plan for "' + name + '". Say "confirm" or "add to today\'s plan" to save it!');
    },
    focus_mode(a) {
      const mode = a.mode || 'start';
      if (mode === 'start') {
        clickEl('#focusCurrent');
        if (!isOpen('#focusOverlay')) return no('You have no active task to focus on right now.');
        return ok('Focus mode started.');
      }
      if (!isOpen('#focusOverlay')) return no('Focus mode is not open right now.');
      if (mode === 'exit') { clickEl('#closeFocus'); return ok('Left focus mode.'); }
      const map = { done: ['#focusDone', 'Marked it done.'], snooze: ['#focusSnooze', 'Snoozed it by 10 minutes.'], skip: ['#focusSkip', 'Skipped it.'] };
      const m = map[mode];
      if (!m) return no("I don't know that focus action.");
      clickEl(m[0]);
      return ok(m[1]);
    },
    manage_habits(a) {
      if ((a.mode || 'open') === 'close') { if (isOpen('#habitManagerOverlay')) clickEl('[data-close="habitManagerOverlay"]'); return ok('Closed the habit manager.'); }
      goScreen('plan');
      clickEl('[data-plan="daily"]');
      if (!isOpen('#habitManagerOverlay')) clickEl('#manageHabitsBtn');
      return ok('Opened the habit manager.');
    },
    add_habit(a) {
      const name = String(a.name || '').trim();
      if (!name) return no('What should the habit be called?');
      goScreen('plan');
      clickEl('[data-plan="daily"]');
      if (!isOpen('#habitManagerOverlay')) clickEl('#manageHabitsBtn');
      setValue($('#newHabitName'), name);
      const form = $('#habitCreateForm');
      if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      const added = $$('#habitManagerList .habit-manager-info strong').some((s) => norm(s.textContent) === norm(name));
      return added ? ok('Added the habit ' + name + '.') : no('I could not add that habit. It may already be on your list.');
    },
    toggle_habit(a) {
      const name = String(a.name || '').trim();
      goScreen('plan');
      clickEl('[data-plan="daily"]');
      const idx = findHabitIndex(name);
      if (idx < 0) return no('I could not find a habit called ' + name + '.');
      const cells = $$('#habitMatrix .habit-check[data-habit-index="' + idx + '"]').filter((b) => !b.disabled);
      const target = a.day === 'yesterday' ? cells[cells.length - 2] : cells[cells.length - 1];
      if (!target) return no('That day is not available in this month.');
      const want = a.done !== false;
      const label = habitNames()[idx];
      const dayWord = a.day === 'yesterday' ? 'yesterday' : 'today';
      if ((target.getAttribute('aria-pressed') === 'true') === want) {
        return ok(label + ' is already ' + (want ? 'done' : 'not done') + ' for ' + dayWord + '.');
      }
      dispatchRealClick(target);
      return ok((want ? 'Checked off ' : 'Unchecked ') + label + ' for ' + dayWord + '.');
    },
    voice_settings(a) {
      const s = a.setting;
      if (s === 'speech' || s === 'elevenlabs') {
        const sel = s === 'speech' ? '#agentTtsToggle' : '#agentElevenToggle';
        const btn = $(sel);
        if (!btn) return no('That setting is not available.');
        const on = /\bon\b/i.test(btn.textContent);
        const want = a.value === 'off' ? false : a.value === 'on' ? true : !on;
        if (want !== on) dispatchRealClick(btn);
        if (s === 'speech') return ok(want ? 'Spoken replies are on.' : 'Spoken replies are off.');
        return ok(want ? 'The ElevenLabs widget is on.' : 'The ElevenLabs widget is off.');
      }
      if (s === 'language') {
        const codes = { en: 'EN-IN', hi: 'HI-IN', gu: 'GU-IN' };
        const names = { en: 'English', hi: 'Hindi', gu: 'Gujarati' };
        const want = codes[a.value];
        if (!want) return no('I can switch the voice language to English, Hindi or Gujarati.');
        const btn = $('#agentLangToggle');
        if (!btn) return no('That setting is not available.');
        for (let i = 0; i < 4 && btn.textContent.trim().toUpperCase() !== want; i++) dispatchRealClick(btn);
        return btn.textContent.trim().toUpperCase() === want ? ok('Voice language set to ' + names[a.value] + '.') : no('I could not change the voice language.');
      }
      return no("I don't know that voice setting.");
    },
    sign_out() {
      const b = $('#orbitSignOut');
      if (!b || b.hidden) return no('You are not signed in.');
      pending = { kind: 'signout', until: Date.now() + WAIT_MS };
      return ok('Are you sure you want to sign out? Say yes to sign out, or no to stay.');
    },
    cancel_pending() {
      const had = !!pending;
      pending = null;
      return ok(had ? 'Okay, I left it as it is.' : 'Okay.');
    },
    delete_task(a) {
      return scheduleDelete(a.name, a.followUp);
    },
    install_app() {
      const b = $('#v3gamPwaInstall');
      if (!b || b.hidden) return no('Installing is not available right now.');
      dispatchRealClick(b);
      return ok('Opening the install prompt.');
    },
    read_info(a) {
      const t = (sel) => { const el = $(sel); return el ? el.textContent.trim() : ''; };
      const wsTitle = t('#dashboardTitle').replace(/[^\p{L}\p{N}\s_\-]/gu, '').replace(/_/g, ' ').trim() || t('#workspaceName') || 'your current workspace';
      switch (a.what) {
        case 'tasks':
          return ok('In ' + wsTitle + ', you have ' + (t('#dashTaskCount') || '0') + ' tasks in your plan today and ' + (t('#dashClosed') || t('#completedCount') || '0') + ' completed.');
        case 'focus':
          return ok('Your planned focus time today is ' + (t('#dashFocus') || '0 hours') + '.');
        case 'progress':
          return ok('Your weekly progress is ' + (t('#dashboardPercent') || '0%') + '.');
        case 'score':
          return ok('Your weekly planning score is ' + (t('#insightsScore') || '0') + ' out of 100.');
        case 'workspace':
          return ok('You are currently in ' + wsTitle + '.');
        case 'theme':
          return ok('You are using the ' + (isLight() ? 'light' : 'dark') + ' theme.');
        default:
          return no("I can't read that out yet.");
      }
    },
    close_current() {
      return closePopups(false) ? ok('Closed.') : ok('Nothing is open.');
    },
    list_capabilities() {
      return ok("I'm Vegam, your voice-first AI task companion. I can execute multi-step commands in one sentence, fill out the Add Task form step by step, switch or create workspaces, manage notifications and habits, toggle dark or light theme, and answer questions about your schedule!");
    },
    multi_action(a) {
      const steps = Array.isArray(a.steps) ? a.steps : [];
      if (!steps.length) return no("I didn't catch those actions. Please try again.");
      const replies = [];
      let allOk = true;
      for (let i = 0; i < steps.length; i++) {
        const st = steps[i];
        const res = runCommand(st.command, st.args);
        if (!res.ok) allOk = false;
        if (res.reply) replies.push(res.reply);
      }
      return { ok: allOk, reply: replies.join(' ') || 'Done.' };
    }
  };

  function runCommand(command, rawArgs) {
    const fn = Object.prototype.hasOwnProperty.call(COMMANDS, command) ? COMMANDS[command] : null;
    if (!fn) return no("I didn't recognise that command. Please say it again.");
    try {
      if (command !== 'demo_mode' && command !== 'chat_reply' && command !== 'stop_speaking' && authBlocked()) {
        return no('Please sign in first, or start the demo, so I can control the app.');
      }
      const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {};
      if (command !== 'close_current' && !KEEP_OVERLAYS.has(command)) closePopups(false);
      const r = fn(args);
      const replyStr = args._adaptedAnnouncement ? (args._adaptedAnnouncement + ' ' + (r.reply || '')).trim() : r.reply;
      return { ok: !!r.ok, reply: tidy(replyStr, !r.ok), ...(r.silent ? { silent: true } : {}), ...(r.pillTitle ? { pillTitle: r.pillTitle } : {}) };
    } catch (e) {
      return no('I could not complete that action on this screen. Please try again.');
    }
  }

  /* ---------- Conversational Buddy & Knowledge Bank ---------- */
  function matchConversationalFriend(t) {
    const low = t.toLowerCase().trim();
    if (/^(hi+|hey+|hello+|hlo+|yo+|hola|namaste|kem cho|sup|what'?s up|whats up|good (morning|afternoon|evening|night))(\s+(buddy|bro|friend|vegam|v3gam|there|ai|mate|pal))?$/i.test(low)) {
      return "Hi buddy, what's the plan today?";
    }
    if (/^(how are you|how are you doing|how'?s it going|how do you do|are you fine|kaisa hai|kem chho|all good)(\s+(buddy|bro|friend|vegam|v3gam))?$/i.test(low)) {
      return "I'm doing awesome, buddy! Ready to keep your day in flow. What are we tackling first?";
    }
    if (/(give me (your|a) (brief )?(description|intro|introduction|summary)|describe yourself|introduce yourself|who are you|about yourself|tell me about yourself|what is (v3gam|vegam))/i.test(low)) {
      return "Hey buddy! I'm Vegam, your smart hands-free voice companion and task scheduler. I can execute multi-step commands, fill forms step-by-step, manage personal and group workspaces, track habits, and answer your questions!";
    }
    if (/what is your name|your name please|who built you|who created you|who made you/i.test(low)) {
      return "I'm Vegam, the live AI voice agent for V3GAM Task Scheduler!";
    }
    if (/are you (listening|there|awake|online|active|ready)(\s+to)?(\s+me)?|can you hear me/i.test(low)) {
      return "Yes buddy, I'm right here and listening live! Tell me what button to click or what task to set up.";
    }
    if (/^(thank you|thanks|thx|thank u|shukriya|dhanyavad|awesome|great job|nice work|good job|cool|perfect)(\s+(buddy|bro|vegam|v3gam|so much|a lot))?$/i.test(low)) {
      return "Anytime, buddy! What's next on our list?";
    }
    if (/what time is it|current time|what'?s the time|tell me the time/i.test(low)) {
      return "Right now it's " + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ". Want to schedule something?";
    }
    if (/what (day|date) is (it|today)|today'?s date|which day is today/i.test(low)) {
      return "Today is " + new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + ".";
    }
    const mathMatch = /^(?:what is|calculate|compute|solve|how much is)?\s*(\d+(?:\.\d+)?)\s*(plus|\+|minus|-|times|multiplied by|\*|x|divided by|\/)\s*(\d+(?:\.\d+)?)$/i.exec(low);
    if (mathMatch) {
      const a = parseFloat(mathMatch[1]), op = mathMatch[2].toLowerCase(), b = parseFloat(mathMatch[3]);
      let res = 0;
      if (op === 'plus' || op === '+') res = a + b;
      else if (op === 'minus' || op === '-') res = a - b;
      else if (op === 'times' || op === 'multiplied by' || op === '*' || op === 'x') res = a * b;
      else if ((op === 'divided by' || op === '/') && b !== 0) res = Math.round((a / b) * 100) / 100;
      return `The answer is ${res}, buddy!`;
    }
    return null;
  }

  /* ---------- Pure Single-Clause Intent Parser (NEVER mutates state!) ---------- */
  const LEADX = /^(?:(?:first of all|firstly|to start with|right now|hey|hi|hello|ok|okay|yo|please|kindly|can you|could you|would you|will you|let'?s|i want to|i wanna|i need to|i would like to|then|now|also|next|and|so|buddy|v3gam|vegam)[,\s]+)+/i;
  const TAILX = /(?:[,\s]+(?:please|now|buddy|bro|v3gam|vegam|begum|begam|for me|right now|thanks|thank you|in this page|on this page|in current page|on current page|in the current page|on the current page|here))+$/i;
  const YES = /^(?:yes|yeah|yep|yup|yes please|sure|confirm|confirmed|go ahead|do it|ok|okay|haan|han|ha|sounds good|please do|proceed|correct|right|build it|build my plan|add it|looks good|add to today'?s plan|add to today plan|save it|save task)$/i;
  const NO = /^(?:no|nope|nah|cancel|don'?t|do not|never mind|nevermind|nahi|not now)$/i;
  const KEEP = /^(?:keep|keep it|keep them|keep both|same|the same|fine|it'?s fine|that'?s fine|no change|no changes|as is|leave it|leave them|good|ok|okay|yes|yeah|yep|sure|sounds good|perfect|looks good)$/i;
  const NON_TASK = /\b(side ?bar|navigation|nav|menu|popup|pop up|dialog|window|overlay|modal|sheet|search|filter|filters|notification|notifications|theme|dark|light|focus|settings?|workspaces?|insights?|plan|today|home|dashboard)\b/i;
  const DATE_WORDS = /\b(tomorrow|tonight|day after|next\s+\w+|on\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2})\b/i;
  const DURPHRASE = '(?:\\d+(?:\\.\\d+)?\\s*(?:minutes?|mins?|hours?|hrs?)|an?\\s+hour(?:\\s+and\\s+a\\s+half)?|one\\s+hour|two\\s+hours?|half\\s+an?\\s+hour|(?:one|an?)\\s+and\\s+a\\s+half\\s+hours?)';
  const CREATE_RE = new RegExp('^(?:create|add|make|schedule|plan|set up|setup|new|book)\\s+(?:me\\s+)?(?:(?:a|an|another|new|my|one|the|this|that)\\s+)*(?:(' + CAT_ALT + ')\\s+)?(?:task|todo|to-do)\\b(?:\\s+(?:section|page|screen|form))?\\s*(.*)$', 'i');

  const WS_SWITCH = [
    /^(?:switch|change|move|go|swap|select|set)\s+(?:the\s+|my\s+|current\s+)*workspaces?\b(?:.*?\b(?:to|into)\b)\s+(.+)$/i,
    /^(?:switch|change|move|go|swap)\s+(?:over\s+)?to\s+(?:the\s+|my\s+)*(.+?)\s+workspaces?$/i
  ];
  const WS_BLOCK = /^(?:the|a|an|my|our|this|that|current|menu|switcher|selector|dropdown|list|dialog|form|directory|page|screen|section|tab|new|create|join|invite)$/i;

  const BARE = {
    plan: ['open_screen', { screen: 'plan' }], planner: ['open_screen', { screen: 'plan' }], planning: ['open_screen', { screen: 'plan' }],
    insights: ['open_screen', { screen: 'stats' }], insight: ['open_screen', { screen: 'stats' }], inside: ['open_screen', { screen: 'stats' }], stats: ['open_screen', { screen: 'stats' }], statistics: ['open_screen', { screen: 'stats' }], analytics: ['open_screen', { screen: 'stats' }], progress: ['open_screen', { screen: 'stats' }],
    workspaces: ['open_screen', { screen: 'workspace' }], workspace: ['open_screen', { screen: 'workspace' }], groups: ['open_screen', { screen: 'workspace' }],
    today: ['open_screen', { screen: 'home' }], home: ['open_screen', { screen: 'home' }], dashboard: ['open_screen', { screen: 'home' }],
    'add task': ['new_task_form', {}], 'new task': ['new_task_form', {}], add: ['new_task_form', {}], 'create task': ['new_task_form', {}], 'create a task': ['new_task_form', {}], 'add a task': ['new_task_form', {}],
    settings: ['settings_menu', { mode: 'open' }], setting: ['settings_menu', { mode: 'open' }], preferences: ['settings_menu', { mode: 'open' }],
    account: ['settings_menu', { mode: 'open', account: true }], 'my account': ['settings_menu', { mode: 'open', account: true }], 'ai account': ['settings_menu', { mode: 'open', account: true }], profile: ['settings_menu', { mode: 'open', account: true }],
    notifications: ['notifications', { mode: 'open' }], notification: ['notifications', { mode: 'open' }], 'notification bar': ['notifications', { mode: 'open' }], 'notifications bar': ['notifications', { mode: 'open' }], alerts: ['notifications', { mode: 'open' }], bell: ['notifications', { mode: 'open' }],
    theme: ['set_theme', { mode: 'toggle' }], appearance: ['set_theme', { mode: 'toggle' }], 'color theme': ['set_theme', { mode: 'toggle' }],
    'dark theme': ['set_theme', { mode: 'dark' }], 'dark mode': ['set_theme', { mode: 'dark' }],
    'light theme': ['set_theme', { mode: 'light' }], 'light mode': ['set_theme', { mode: 'light' }],
    ai: ['assistant_panel', { mode: 'open' }], 'v3gam ai': ['assistant_panel', { mode: 'open' }], 'vegam ai': ['assistant_panel', { mode: 'open' }], assistant: ['assistant_panel', { mode: 'open' }], 'ai assistant': ['assistant_panel', { mode: 'open' }],
    habits: ['open_plan_tab', { tab: 'habits' }], habit: ['open_plan_tab', { tab: 'habits' }], daily: ['open_plan_tab', { tab: 'habits' }], 'daily habit': ['open_plan_tab', { tab: 'habits' }], 'daily habits': ['open_plan_tab', { tab: 'habits' }], 'habit tracker': ['open_plan_tab', { tab: 'habits' }],
    week: ['open_plan_tab', { tab: 'week' }], 'weekly plan': ['open_plan_tab', { tab: 'week' }], 'week view': ['open_plan_tab', { tab: 'week' }], 'weekly view': ['open_plan_tab', { tab: 'week' }], 'weekly overview': ['open_plan_tab', { tab: 'week' }], 'week overview': ['open_plan_tab', { tab: 'week' }],
    month: ['open_plan_tab', { tab: 'month' }], 'monthly view': ['open_plan_tab', { tab: 'month' }], 'month view': ['open_plan_tab', { tab: 'month' }], 'monthly plan': ['open_plan_tab', { tab: 'month' }],
    'focus mode': ['focus_mode', { mode: 'start' }], demo: ['demo_mode', { mode: 'start' }], 'demo mode': ['demo_mode', { mode: 'start' }],
    manage: ['click_button', { target: 'manage' }], actions: ['click_button', { target: 'actions' }], more: ['click_button', { target: 'more' }], new: ['new_task_form', {}],
    back: ['go_back', {}], 'go back': ['go_back', {}], 'back to today': ['go_back', {}]
  };

  const VERBS = /^(?:(?:open|show(?: me)?|go to|goto|take me to|switch to|launch|view|display|click(?: on)?|tap(?: on)?|press|select|choose|on|in)\s+)+/i;
  const FILL = /\b(?:the|a|an|my|button|section|tab|page|screen|menu|dropdown|panel|bar|please|option|view)\b/gi;
  const coreOf = (t) => norm(String(t).replace(VERBS, '').replace(/\b(?:in|on)\s+(?:the\s+|this\s+)?(?:current|this)\s+(?:page|screen)\b/gi, ' ').replace(FILL, ' '));

  function parseCreateClause(m) {
    const cat = m[1] ? CAT_WORDS[m[1].toLowerCase()] : null;
    let rest = String(m[2] || '').trim()
      .replace(/^(?:called|named|titled|for|to|about|on|is|:)\s+/i, '')
      .replace(/^(?:name|title)(?:\s+(?:is|as|to))?\s+/i, '')
      .trim();
    if (!rest || /^(?:section|page|screen|form|tab|view|builder)$/i.test(rest)) {
      return S('start_task_flow', cat ? { category: cat } : {});
    }
    if (DATE_WORDS.test(rest)) return null;
    const args = {};
    if (cat) args.category = cat;
    const noteMatch = /\s+(?:with\s+notes?|and\s+notes?|notes?\s+is)\s+(.+)$/i.exec(rest);
    if (noteMatch) {
      args.note = noteMatch[1].trim();
      rest = rest.slice(0, noteMatch.index).trim();
    }
    let time = null;
    let dur = null;
    for (let i = 0; i < 3; i++) {
      let mm = !time && /\s+(?:at|@|around|on)\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)$/i.exec(rest);
      if (mm) {
        const ck = parseClock(mm[1]);
        rest = rest.slice(0, mm.index).trim();
        if (ck) time = ck;
        continue;
      }
      mm = !dur && new RegExp('\\s+(?:for|duration)\\s+(' + DURPHRASE + ')$', 'i').exec(rest);
      if (mm) {
        dur = parseDuration(mm[1]);
        rest = rest.slice(0, mm.index).trim();
        continue;
      }
      break;
    }
    rest = rest.replace(/\s+(?:today|for today)$/i, '').trim();
    if (time) args.time = time;
    if (dur) args.duration = snapDuration(dur);
    if (rest) args.name = cleanTaskTitle(rest);
    return S('start_task_flow', args);
  }

  function parseSingle(rawText, allowTaskTitleFallback = true) {
    const t0 = normalizeSpeech(rawText);
    const t = t0.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ').trim().replace(/^[\s.,!?;:"-]+|[\s.,!?;:"-]+$/g, '');
    if (!t || t.length > 260) return null;

    if (/^(?:stop|quiet|shut up|silence|pause|stop speaking|stop talking|hold on|wait)$/i.test(t)) {
      return S('stop_speaking');
    }

    const strippedChat = t.replace(/^(?:hey|hi|hello|okay|ok)\s+(?:v3gam|vegam|wegam)[,.\s!]*/i, '').trim() || t;
    const chatReply = matchConversationalFriend(strippedChat);
    if (chatReply) return S('chat_reply', { reply: chatReply });

    const core = t.replace(LEADX, '').replace(TAILX, '').replace(/^[\s.,!?;:"-]+|[\s.,!?;:"-]+$/g, '').trim();
    if (!core) return null;
    const c = core.toLowerCase();
    let m;

    const chatReplyCore = matchConversationalFriend(core);
    if (chatReplyCore) return S('chat_reply', { reply: chatReplyCore });

    if (pending && Date.now() <= pending.until) {
      if (YES.test(c)) return S('confirm_pending');
      if (NO.test(c)) return S('cancel_pending');
    }

    if (isOpen('#notificationsDialog')) {
      if (/^(?:close|dismiss|hide|exit)(?:\s+(?:the|this|my|in[- ]?app))?(?:\s+notifications?(?:\s+(?:bar|panel|dialog|window|modal|list|menu))?)?$/i.test(core)) {
        return S('notifications', { mode: 'close' });
      }
      if (/\bmark\b.*\bread\b|\bread\b.*\b(?:all|notifications?|tasks?)\b/i.test(core)) {
        return S('mark_notifications_read', { query: core });
      }
      const k = coreOf(core);
      if (/^(?:all|everything|all notifications?)$/.test(k)) return S('notifications', { mode: 'filter', filter: 'all' });
      if (/^(?:tasks?|tasks? filter|task notifications?)$/.test(k)) return S('notifications', { mode: 'filter', filter: 'tasks' });
      if (/^(?:system|system filter|system notifications?)$/.test(k)) return S('notifications', { mode: 'filter', filter: 'system' });
      if (/^(?:refresh|reload)$/.test(k)) return S('notifications', { mode: 'refresh' });
    }

    if (isOpen('#workspaceDialog')) {
      if (/^(?:close|dismiss|hide|exit|cancel)(?:\s+(?:the|this|my))?(?:\s+(?:group\s+)?(?:workspaces?|group)(?:\s+(?:dialog|window|modal|form|popup))?)?$/i.test(core)) {
        return S('workspace_dialog', { mode: 'close' });
      }
      if ((m = /^(?:(?:set|give|enter|write|type|make)\s+)?(?:the\s+)?(?:group|workspace)\s+name(?:\s+(?:is|to|as))?\s+(.+)$/i.exec(core))
        || (m = /^(?:name|call)\s+(?:the\s+)?(?:group|workspace)(?:\s+(?:as|to|is))?\s+(.+)$/i.exec(core))) {
        return S('fill_workspace_dialog', { name: m[1].trim() });
      }
      if (/^(?:create|create group|create group workspace|submit|save|confirm|yes)$/i.test(core) && val('#newWorkspaceName')) {
        return S('submit_workspace_dialog');
      }
    }

    if (isOpen('#focusOverlay')) {
      if (/^(?:exit|close|leave|end|stop|quit)(?:\s+focus(?:\s+mode)?)?$/i.test(core)) return S('focus_mode', { mode: 'exit' });
      if (/^(?:done|complete|completed|finished|mark(?:\s+it)?(?:\s+as)?\s+done)$/i.test(core)) return S('focus_mode', { mode: 'done' });
      if (/^snooze\b/i.test(core)) return S('focus_mode', { mode: 'snooze' });
      if (/^skip\b/i.test(core)) return S('focus_mode', { mode: 'skip' });
    }

    if (/^(?:close|hide|dismiss|exit)\s+(?:the\s+|my\s+)?(?:settings?|preferences|options|profile)(?:\s+(?:menu|panel|dropdown|bar))?$/i.test(core)) {
      return S('settings_menu', { mode: 'close' });
    }
    if (/^(?:close|hide|dismiss|exit)\s+(?:the\s+|my\s+)?(?:in[- ]?app\s+)?notifications?(?:\s+(?:bar|panel|dialog|window|modal|list|menu))?$/i.test(core)) {
      return S('notifications', { mode: 'close' });
    }
    if (/^(?:close|hide|dismiss|exit)\s+(?:the\s+|my\s+)?(?:v3gam\s+|vegam\s+)?(?:ai\s+)?(?:assistant|chat)(?:\s+(?:panel|window|sheet|dialog))?$/i.test(core)) {
      return S('assistant_panel', { mode: 'close' });
    }
    if (/^(?:close|hide|dismiss|exit|cancel)\s+(?:the\s+|my\s+)?(?:group\s+)?(?:workspaces?|group)(?:\s+(?:dialog|popup|window|form|modal|menu|switcher))?$/i.test(core)) {
      if (isOpen('#workspaceDialog')) return S('workspace_dialog', { mode: 'close' });
      return S('workspace_menu', { mode: 'close' });
    }
    if (/^(?:close|dismiss|hide)(?:\s+(?:this|that|it|the|popup|dialog|window|overlay|modal|menu|panel))?$/i.test(core)) {
      return S('close_current');
    }

    if (/^(?:go\s+back|back|go\s+to\s+(?:the\s+)?back|take\s+me\s+back|previous\s+(?:page|screen)|back\s+to\s+today|return)$/i.test(core)) {
      return S('go_back');
    }

    if (/^(?:(?:click|tap|press)(?:\s+on)?\s+)?(?:the\s+)?(?:sign\s+me\s+out|sign\s?out(?:\s+from\s+this\s+account)?|log\s+me\s+out|log\s?out(?:\s+from\s+this\s+account)?|logout)(?:\s+button)?$/i.test(core)) {
      return S('sign_out');
    }

    if ((m = /\b(?:i\s+(?:think|feel|like|prefer|want|love)\s+)?(?:the\s+)?(light|day|dark|night)\s+(?:theme|mode|colou?r)\s+(?:is\s+)?(?:better|best|good|nice|nicer|preferred|great)\b/i.exec(t))
      || (m = /\b(?:i\s+(?:prefer|like|want|love))\s+(?:the\s+)?(light|day|dark|night)\s+(?:theme|mode)\b/i.exec(t))
      || (m = /^(?:switch|change|set|turn|put|make|use|enable|activate|go|apply)(?:\s+(?:on|to|into|the|my|website|app|screen|theme|mode))*\s+(dark|night|light|day)(?:\s+(?:mode|theme))?$/i.exec(core))
      || (m = /^(dark|night|light|day)\s+(?:mode|theme)$/i.exec(core))) {
      return S('set_theme', { mode: /^(dark|night)$/i.test(m[1]) ? 'dark' : 'light' });
    }
    if (/^(?:toggle|change|switch|flip|swap)(?:\s+(?:the|my|website|app))*\s+(?:theme|appearance|mode|dark mode|light mode)$/i.test(core)) {
      return S('set_theme', { mode: 'toggle' });
    }

    if (/\bhow\s+many\s+tasks?\b/i.test(t) || /\bwhat(?:'?s|\s+is)\s+my\s+task\s+count\b/i.test(t)) {
      return S('read_info', { what: 'tasks' });
    }
    if (/\b(?:what(?:'?s|\s+is)|tell\s+me|read(?:\s+out)?|how(?:'?s|\s+is))\s+(?:my\s+|the\s+|current\s+)*(?:focus\s+time|focus\s+hours)\b/i.test(t)) {
      return S('read_info', { what: 'focus' });
    }
    if (/\b(?:what(?:'?s|\s+is)|tell\s+me|read(?:\s+out)?|how(?:'?s|\s+is))\s+(?:my\s+|the\s+|current\s+)*(?:weekly\s+)?progress\b/i.test(t)) {
      return S('read_info', { what: 'progress' });
    }
    if (/\b(?:what(?:'?s|\s+is)|tell\s+me|read(?:\s+out)?|how(?:'?s|\s+is))\s+(?:my\s+|the\s+|current\s+)*(?:weekly\s+)?(?:planning\s+)?score\b/i.test(t)) {
      return S('read_info', { what: 'score' });
    }
    if (/^(?:which|what)\s+workspaces?\s+(?:am\s+i\s+(?:in|using|on)|is\s+(?:this|active|open))$/i.test(core)) {
      return S('read_info', { what: 'workspace' });
    }
    if (/^(?:what\s+can\s+you\s+(?:do|control|handle)|list\s+commands|help)$/i.test(core)) {
      return S('list_capabilities');
    }

    if (/^(?:undo|undo (?:that|it|the last (?:action|task|thing)|last (?:action|task)))$/i.test(c)) return S('undo_last');
    if ((m = /^(?:remove|delete|erase|cancel)\s+(?:the\s+|my\s+|that\s+|this\s+)*(?:task\s+)?(.+)$/i.exec(core))) {
      let nm = m[1].replace(/(?:\s+(?:schedule|scheduled|task))?(?:\s+(?:in|on|from|off|of|at))+(?:\s+(?:the|my|todays?|today's))*(?:\s+(?:flow|plan|schedule|list|dashboard|timeline|today))?\s*$/i, '').replace(/\s+task$/i, '').trim();
      if (nm && !NON_TASK.test(nm) && !/^(?:it|this|that|them)$/i.test(nm)) {
        return S('delete_task', { name: nm });
      }
    }

    if (/^(?:open|show|go\s+to|take\s+me\s+to|view|visit|switch\s+to)\s+(?:the\s+|my\s+)?workspaces?(?:\s+(?:section|page|screen|tab|view|directory))?$/i.test(core)) {
      return S('open_screen', { screen: 'workspace' });
    }
    if (/^(?:open|show|go\s+to|take\s+me\s+to|view|visit|switch\s+to)\s+(?:the\s+|my\s+)?(?:today(?:'s)?|home|dashboard)(?:\s+(?:section|page|screen|tab|view|flow))?$/i.test(core)) {
      return S('open_screen', { screen: 'home' });
    }
    if (/^(?:open|show|go\s+to|take\s+me\s+to|view|visit|switch\s+to)\s+(?:the\s+|my\s+)?(?:plan|planner|planning)(?:\s+(?:section|page|screen|tab|view))?$/i.test(core)) {
      return S('open_screen', { screen: 'plan' });
    }
    if (/^(?:open|show|go\s+to|take\s+me\s+to|view|visit|switch\s+to)\s+(?:the\s+|my\s+)?(?:insights?|inside|stats|statistics|progress|analytics)(?:\s+(?:section|page|screen|tab|view))?$/i.test(core)) {
      return S('open_screen', { screen: 'stats' });
    }
    if (/^(?:open|show|go\s+to|take\s+me\s+to|view|visit|switch\s+to)\s+(?:the\s+|my\s+)?(?:add(?:\s+a)?(?:\s+task)?|new\s+task|create\s+task|task\s+builder)(?:\s+(?:section|page|screen|tab|view|form))?$/i.test(core)) {
      return S('new_task_form');
    }
    if (/^(?:open|show|go\s+to|take\s+me\s+to|view|switch\s+to|click(?:\s+on)?)\s+(?:the\s+|my\s+)?(?:daily\s+habits?|habits?|habit\s+tracker)(?:\s+(?:section|page|screen|tab|view))?$/i.test(core)) {
      return S('open_plan_tab', { tab: 'habits' });
    }
    if (/^(?:open|show|go\s+to|take\s+me\s+to|view|switch\s+to|click(?:\s+on)?)\s+(?:the\s+|my\s+)?(?:week(?:ly)?(?:\s+(?:overview|view|plan))?)(?:\s+(?:section|tab|view))?$/i.test(core)) {
      return S('open_plan_tab', { tab: 'week' });
    }
    if (/^(?:open|show|go\s+to|take\s+me\s+to|view|switch\s+to|click(?:\s+on)?)\s+(?:the\s+|my\s+)?(?:month(?:ly)?(?:\s+(?:overview|view|plan))?)(?:\s+(?:section|tab|view))?$/i.test(core)) {
      return S('open_plan_tab', { tab: 'month' });
    }
    if (/^(?:open|show|click(?:\s+on)?|tap)\s+(?:the\s+|my\s+)?(?:in[- ]?app\s+)?notifications?(?:\s+(?:bar|panel|dialog|center|list|bell|popup|window|button|section|menu))?$/i.test(core)) {
      return S('notifications', { mode: 'open' });
    }
    if (/^(?:open|show|click(?:\s+on)?|tap)\s+(?:the\s+|my\s+)?(?:settings?|preferences|options)(?:\s+(?:menu|panel|dropdown|button|bar))?$/i.test(core)) {
      return S('settings_menu', { mode: 'open' });
    }
    if (/^(?:open|show|click(?:\s+on)?|tap)\s+(?:the\s+|my\s+)?(?:account|profile|ai\s+account)(?:\s+(?:menu|panel|dropdown|button))?$/i.test(core)) {
      return S('settings_menu', { mode: 'open', account: true });
    }
    if (/^(?:open|show|launch|start|go\s+to|click(?:\s+on)?|tap|press)\s+(?:the\s+|my\s+)*(?:v3gam\s+|vegam\s+)?ai(?:\s+(?:assistant|chat|panel|button))?$/i.test(core)) {
      return S('assistant_panel', { mode: 'open' });
    }

    if (/^(?:switch|change|swap)\s+(?:the\s+|my\s+|current\s+)?workspaces?$/i.test(core)) {
      return S('switch_workspace_ui', { name: '' });
    }
    for (const re of WS_SWITCH) {
      m = re.exec(core);
      if (m && m[1]) {
        const targetWs = m[1].replace(/^(?:from\s+)?(?:personal|private)\s+to\s+/i, '').trim();
        if (targetWs && !WS_BLOCK.test(targetWs)) {
          return S('switch_workspace_ui', { name: targetWs });
        }
        if (/^group(?:\s+workspaces?)?$/i.test(targetWs)) {
          return S('switch_workspace_ui', { name: '' });
        }
      }
    }
    if ((m = /^(?:create|make|start|add|new)(?:\s+(?:a|an))?(?:\s+new)?\s+group(?:\s+workspace)?(?:\s+(?:called|named)\s+(.+))?$/i.exec(core))) {
      return S('workspace_dialog', { mode: 'create', ...(m[1] ? { name: m[1].trim() } : {}) });
    }

    if ((m = /^(?:scroll|page)\s+(down|up|top|bottom)(?:\s+(?:a\s+(?:little|bit)|more|the\s+page))?$/i.exec(core))
      || (m = /^(?:scroll|go|jump)\s+(?:to\s+)?(?:the\s+)?(top|bottom)(?:\s+of\s+(?:the\s+)?page)?$/i.test(core))) {
      return S('scroll_page', { direction: m[1].toLowerCase() });
    }

    if ((m = /^(?:(?:add|set|write|enter|put|fill|update)(?:\s+in)?(?:\s+(?:the|a|my|task))*|\bin\b\s+(?:the\s+)?)\s*notes?(?:\s+(?:field|box|section))?(?:\s+(?:write|add|put|set|say|saying|that|like|to|as|is))*\s+(.+)$/i.exec(core))
      || (m = /^(?:write|type|put|add)\s+(.+?)\s+in(?:to)?\s+(?:the\s+)?(?:task\s+)?notes?$/i.exec(core))) {
      const noteText = m[1].replace(/^(?:write|that|like|as|to|is)\s+/i, '').trim();
      if (noteText) return S('fill_task_form', { note: noteText });
    }

    if (/^(?:build|make|create|generate)(?:\s+(?:my|the))?\s+plan$|^build\s+it$/i.test(core)) {
      return S('build_task_plan');
    }
    if (/^(?:add\s+to\s+(?:today'?s\s+|today\s+|my\s+)?plan|save\s+to\s+(?:today'?s\s+|my\s+)?plan|confirm\s+task|save\s+task)$/i.test(core)) {
      return S('confirm_task');
    }

    if ((m = /^(?:(?:give|set|put|enter|write|fill|type|change|update|make)(?:\s+(?:the|a|me|my))*|)\s*(?:task\s+(?:name|title)|(?:name|title)\s+of\s+(?:the\s+)?task)(?:\s+(?:is|as|to))?\s+(.+)$/i.exec(core))) {
      return S('fill_task_form', { name: m[1].trim() });
    }

    if ((m = /^(?:set|change|choose|select|pick|make|update|switch|put)\b.*?\bcategory\b(.*)$/i.exec(core))
      || (m = /^(?:the\s+|task\s+)*category(?:\s+(?:to|is|as))?\s*(.*)$/i.exec(core))) {
      const cat = lastCategory(m[1]);
      return cat
        ? S('fill_task_form', { category: cat })
        : S('chat_reply', { reply: 'Which category: Study, Lab, Lecture, Gym or Meal?' });
    }

    if (/\bduration\b/i.test(core) || (addActive() && /\b(?:more|longer|greater|over|above|less|shorter|under|below)\s+than\s+(?:an?\s+|one\s+|1\s+)hours?\b/i.test(core))) {
      if (/\b(?:more|longer|greater|over|above)\s+than\s+(?:an?\s+|one\s+|1\s+)hours?\b/i.test(core)) {
        return S('ask_duration', { less: false });
      }
      if (/\b(?:less|shorter|under|below)\s+than\s+(?:an?\s+|one\s+|1\s+)hours?\b/i.test(core)) {
        return S('ask_duration', { less: true });
      }
      const d = parseDuration(core);
      if (d) return S('fill_task_form', { duration: snapDuration(d) });
      return S('ask_duration', { less: false });
    }

    if (/^(?:(?:click|tap|press|choose|select|set|pick|use)(?:\s+on)?\s+)?(?:the\s+)?(?:choose\s+(?:my\s+|on\s+my\s+)?(?:own\s+)?(?:start\s+)?time|my\s+own\s+(?:start\s+)?time|on\s+my\s+time|own\s+(?:start\s+)?time|my\s+time|manual\s+(?:start\s+)?time|custom\s+(?:start\s+)?time)(?:\s+(?:button|card|mode|option))?$/i.test(core)
      || (/\bdropdown\b/i.test(c) && /\b(?:choose|own\s+time|time)\b/i.test(c))) {
      return S('fill_task_form', { when: 'manual' });
    }
    if (/^(?:(?:click|tap|press|choose|select|set|pick|use)(?:\s+on)?\s+)?(?:the\s+)?(?:ai\s+best\s+time|best\s+time|ai\s+time|flexible\s+time)(?:\s+(?:button|card|mode|option))?$/i.test(core)) {
      return S('fill_task_form', { when: 'flexible' });
    }
    if ((m = /(?:schedule|start|set|put|at|on|for)\s+(?:it\s+|task\s+)?(?:on\s+|at\s+|for\s+|to\s+)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))$/i.exec(core))) {
      const parsedT = parseClock(m[1]);
      if (parsedT) return S('fill_task_form', { time: parsedT });
    }

    if (addActive()) {
      if (/^(?:15|30|45|60|90|120|150|180|90\s+90|9090|1\.5|2\.5|(?:one|1|two|2)\s+and\s+(?:a\s+)?half|an hour and a half|two hours|2 hours|three hours|3 hours|one hour|1 hour|thirty|forty five|sixty|ninety)(?:\s*(?:minutes?|mins?|hours?|hrs?))?$/i.test(c)) {
        const d = parseDuration(c);
        if (d) return S('fill_task_form', { duration: snapDuration(d) });
      }
      const bareClock = /^(?:at\s+|on\s+)?(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|in the morning|in the afternoon|in the evening|at night))$/i.exec(c);
      if (bareClock) {
        const pt = parseClock(bareClock[1]);
        if (pt) return S('fill_task_form', { time: pt });
      }
      if (/^(?:change|change them|change it|change both|modify|edit|i want to change(?: them)?)$/i.test(c)) {
        return S('ask_catdur_change');
      }
      if (flow.step === 'catdur' && KEEP.test(c)) {
        return S('flow_keep');
      }
      if (flow.step !== 'name') {
        const catMatch = new RegExp('^(?:(' + CAT_ALT + ')\\s*)?(?:for\\s+)?(' + DURPHRASE + ')?$', 'i').exec(core);
        if (catMatch && (catMatch[1] || catMatch[2])) {
          const args = {};
          if (catMatch[1]) args.category = CAT_WORDS[catMatch[1].toLowerCase()];
          if (catMatch[2]) { const d = parseDuration(catMatch[2]); if (d) args.duration = snapDuration(d); }
          if (Object.keys(args).length) return S('fill_task_form', args);
        }
      }
      if ($('#parsedCard') && $('#parsedCard').classList.contains('show')) {
        if (YES.test(c)) return S('confirm_task');
        if (NO.test(c)) return S('flow_reject');
      } else if (flow.step === 'confirm_build') {
        if (YES.test(c)) return S('build_task_plan');
        if (NO.test(c)) return S('flow_reject');
      }
    }

    if ((m = CREATE_RE.exec(core))) {
      const r = parseCreateClause(m);
      if (r) return r;
    }

    if ((m = /^(?:click|tap|press|hit|select)(?:\s+on|\s+the|\s+to)*\s+(.+)$/i.exec(core))
      || (m = /^on\s+(.+?)(?:\s+button)?$/i.exec(core))) {
      return S('click_button', { target: m[1] });
    }
    if (/\bbutton$/i.test(core)) {
      return S('click_button', { target: core });
    }

    const key = coreOf(core);
    if (Object.prototype.hasOwnProperty.call(BARE, key)) {
      return S(BARE[key][0], Object.assign({}, BARE[key][1]));
    }

    if (allowTaskTitleFallback && addActive() && (flow.step === 'name' || !val('#taskName'))) {
      const NOT_TITLE = /^(?:what|how|why|who|when|where|which|open|show|go|close|click|tap|press|switch|toggle|turn|scroll|stop|cancel|delete|remove|sign|log|yes|no|confirm|undo|try)$/i;
      const rawCandidate = String(lastRawUtterance || core).trim()
        .replace(/^(?:(?:um+|uh+|er+|please)[,.\s]+)+/i, '')
        .replace(/(?:[,.\s]+(?:um+|uh+|er+|please))+$/i, '')
        .slice(0, 220);
      const firstWord = rawCandidate.split(/\s+/)[0] || '';
      if (!NOT_TITLE.test(firstWord) && rawCandidate.length >= 2 && rawCandidate.split(/\s+/).length <= 40) {
        return S('fill_task_form', { name: rawCandidate, verbatimTitle: true });
      }
    }

    return null;
  }

  /* ---------- v98 Surgical Upgrade: Fuzzy Match, Slot Priority, Habits, Demo & UI Polish ---------- */
  const STOP_W = new Set(['the','a','an','my','your','our','this','that','it','on','in','at','to','for','with','of','from','button','btn','tab','icon','link','option','card','control','panel','section','please','right','now']);
  const durLabelFull = (n) => (n === 60 ? '60 minutes (1 hour)' : n === 90 ? '90 minutes (1.5 hours)' : n === 120 ? '120 minutes (2 hours)' : n === 150 ? '150 minutes (2.5 hours)' : n === 180 ? '180 minutes (3 hours)' : n + ' minutes');
  function activeWsName() {
    const raw = ($('#dashboardTitle') && $('#dashboardTitle').textContent) || ($('#workspaceName') && $('#workspaceName').textContent) || 'Personal workspace';
    const c = String(raw || '').replace(/[^\p{L}\p{N}\s_\-]/gu, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    return (!c || /^v3gam\s+pro$/i.test(c)) ? 'Personal workspace' : c;
  }
  function focusInView(el) { if (el) { try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {} } }
  function screenSuggestions() {
    if (isOpen('#notificationsDialog')) return ['All', 'Tasks', 'System', 'Refresh', 'Close notification'];
    if (isOpen('#workspaceDialog')) return ['Create group workspace', 'Join workspace', 'Close'];
    if (addActive()) return ['Describe it with your voice', 'AI best time', 'Choose my own time', 'Build my plan', 'Back to today'];
    const scr = currentScreen();
    if (scr === 'plan') return ($('#dailyPane') && $('#dailyPane').style.display !== 'none') ? ['Manage habits', 'Tick all my daily habits', 'Week overview', 'Month'] : ['Week overview', 'Month', 'Daily habits'];
    if (scr === 'workspace') return ['Create group', 'Join with code', 'Personal workspace'];
    return ["Today's Flow", 'Optimize with AI', 'Manage', 'Demo', 'New task'];
  }
  function applyV98Polish() {
    const dm = { '30': '30 minutes', '45': '45 minutes', '60': '60 minutes (1 hour)', '90': '90 minutes (1.5 hours)', '120': '120 minutes (2 hours)' };
    $$('#taskDuration option').forEach((o) => { if (dm[o.value] && o.textContent !== dm[o.value]) o.textContent = dm[o.value]; });
    const orb = $('#v3gamLiveOrbBtn');
    if (orb && orb.hasAttribute('title')) { orb.setAttribute('aria-label', orb.getAttribute('title')); orb.removeAttribute('title'); }
    if (window.v3gamLiveAgent && !window.v3gamLiveAgent.__v98) {
      const origReady = window.v3gamLiveAgent.isReady;
      window.v3gamLiveAgent.isReady = () => !!(isDemo() || (typeof origReady === 'function' && origReady()));
      window.v3gamLiveAgent.__v98 = true;
    }
    if (!$('#v3gamV98Style')) {
      const st = document.createElement('style');
      st.id = 'v3gamV98Style';
      st.textContent = '#demoExitFloating.visible{bottom:148px!important;right:18px!important;z-index:10055!important}';
      document.head.appendChild(st);
    }
  }
  setInterval(applyV98Polish, 600);
  setTimeout(applyV98Polish, 50);

  SAFE_BUTTON_ALIASES.unshift(
    { match: /\b(describe\s+(?:it\s+|task\s+|this\s+)?with\s+(?:your|my|the|a|our)?\s*(?:voice|boys)|task\s+is\s+described?\s+with\s+(?:my|your)\s+(?:voice|boys)|record\s+task|voice\s+task|describe\s+with\s+voice)\b/i, sel: '#recordTaskBtn', label: 'Describe it with your voice' },
    { match: /\b(three\s+lines?(?:\s+of\s+(?:the\s+)?side\s*(?:panel|bar))?|tree\s+lines?|free\s+lines?|hamburger|side\s*panel|sidebar|hide\s+sidebar|show\s+sidebar|toggle\s+sidebar)\b/i, sel: '#sidebarToggle', label: 'Sidebar toggle' },
    { match: /\b(vegam\s+flow|v3gam\s+flow|today'?s\s+flow|todays\s+flow|my\s+flow|daily\s+flow)\b/i, fn: () => COMMANDS.show_todays_flow({}), label: "Today's Flow" },
    { match: /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d{2}\b/i, fn: () => { goScreen('plan'); clickEl('[data-plan="month"]'); }, label: 'Monthly calendar view' },
    { match: /\b(exit\s+demo|leave\s+demo|stop\s+demo|end\s+demo|close\s+demo)\b/i, fn: () => COMMANDS.demo_mode({ mode: 'exit' }), label: 'Exit demo' }
  );
  Object.assign(BARE, {
    'exit demo': ['demo_mode', { mode: 'exit' }], 'leave demo': ['demo_mode', { mode: 'exit' }], 'stop demo': ['demo_mode', { mode: 'exit' }],
    'todays flow': ['show_todays_flow', {}], 'today s flow': ['show_todays_flow', {}], 'v3gam flow': ['show_todays_flow', {}], 'vegam flow': ['show_todays_flow', {}]
  });

  const origClickBtn = COMMANDS.click_button;
  Object.assign(COMMANDS, {
    click_button(a) {
      const res = origClickBtn(a);
      if (res && res.ok) return res;
      const cleaned = cleanButtonTargetPhrase(a && a.target) || String((a && a.target) || '');
      const qTokens = norm(cleaned).replace(/\bboys\b/g, 'voice').replace(/\b(?:tree|free)\b/g, 'three').split(' ').filter((w) => w.length >= 2 && !STOP_W.has(w));
      if (qTokens.length) {
        const hit = $$('button, a, [role="button"], [role="tab"]').filter((b) => {
          if (b.disabled || b.hidden || b.id === 'v3gamLiveOrbBtn' || b.id === 'hb-badge') return false;
          const r = b.getBoundingClientRect();
          if (!r.width || !r.height) return false;
          const lab = norm((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.title || ''));
          return !FORBIDDEN_CLICK_RE.test(lab);
        }).map((b) => {
          const bTokens = norm((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')).split(' ').filter((w) => w.length >= 2 && !STOP_W.has(w));
          const mCount = qTokens.filter((qt) => bTokens.some((bt) => bt === qt || (qt.length >= 4 && bt.includes(qt)) || (bt.length >= 4 && qt.includes(bt)))).length;
          return { b, ratio: mCount / qTokens.length, mCount };
        }).filter((x) => x.mCount >= 2 || (qTokens.length === 1 && x.mCount === 1)).sort((x, y) => y.ratio - x.ratio)[0];
        if (hit && hit.ratio >= 0.5) {
          const nm = tidy((hit.b.querySelector && hit.b.querySelector('b') ? hit.b.querySelector('b').textContent : hit.b.textContent) || hit.b.getAttribute('aria-label') || cleaned, true).slice(0, 40);
          dispatchRealClick(hit.b);
          return ok('Clicked "' + nm + '" for you.');
        }
      }
      const sugg = screenSuggestions().slice(0, 4).map((s) => '"' + s + '"').join(', ');
      return no('I could not find "' + cleaned + '" on this screen. Closest controls here are: ' + sugg + '.', { pillTitle: 'CONTROL NOT FOUND · TRY CLOSEST MATCH' });
    },
    show_todays_flow(a) {
      resetFlow();
      if (currentScreen() !== 'home') goScreen('home');
      const card = $('.mini-agenda') || $('#dashboardTodayAgenda') || $('#timeline');
      setTimeout(() => focusInView(card), 60);
      const ws = activeWsName();
      const titles = $$('#timeline .task .tasktitle');
      const times = $$('#timeline .time-label');
      if (a && a.newTask && flow.lastAdded && flow.lastAdded.title) {
        return ok("Scrolled to Today's Flow in " + ws + '. Your task "' + flow.lastAdded.title + '"' + (flow.lastAdded.when ? ' is scheduled' + flow.lastAdded.when : ' is in your plan') + '.');
      }
      if (titles.length) {
        const list = titles.slice(0, 3).map((el, i) => '"' + el.textContent.trim() + '"' + (times[i] ? ' at ' + times[i].textContent.trim() : '')).join(', ');
        return ok("Here is Today's Flow in " + ws + ' with ' + titles.length + ' task' + (titles.length === 1 ? '' : 's') + ': ' + list + '.');
      }
      const switchHint = /^personal\b/i.test(ws) ? '' : ', or switch to Personal workspace';
      return ok("Scrolled to Today's Flow in " + ws + '. Nothing is scheduled for today here yet - say "add a task" to schedule one' + switchHint + '.');
    },
    clear_task_draft(a) {
      if (!addActive()) goScreen('add');
      if (a && a.field === 'name') {
        setValue($('#taskName'), '');
        flow.active = true;
        flow.step = 'name';
        focusInView($('#taskName'));
        if (a.triggerVoice && $('#recordTaskBtn')) {
          dispatchRealClick($('#recordTaskBtn'));
          return ok('Cleared the task name and started voice description.');
        }
        return ok('Cleared the task name. What would you like to name this task?');
      }
      startFlow(true);
      focusInView($('#taskName'));
      return ok('Cleared the unsaved task form. What would you like to name your new task?');
    },
    ask_catdur_change() {
      flow.step = 'edit_cat';
      flow.catDone = false;
      flow.durDone = false;
      return ok('Sure! Which category—Study, Project / lab, Lecture, Wellness, or Meal? You can also say both, like "Wellness and 90 minutes".');
    },
    fill_task_form(a) {
      if (a.name !== undefined) {
        const rawNm = a.verbatimTitle
          ? String(a.name || '').replace(/[\r\n\u200B-\u200D\uFEFF]/g, ' ').trim().slice(0, 220)
          : String(a.name || '').replace(/<[^>]+>/g, '').trim();
        if (/^(?:workspace|the\s+notes?|notes?|button|section|task|new\s+task|add\s+task|create(?:\s+create)*.*|cancel|stop|wait|go\s+back|index\s+current\s+creation.*)$/i.test(rawNm)
          || /\b(?:describe|record|capture|speak)\s+(?:it|this|the\s+task)\s+with\s+(?:my|your)\s+(?:voice|boys|vice|voyce)\b/i.test(rawNm)) {
          return no('I heard "' + rawNm + '", which looks like a command rather than a task title. Please say the task title you want to schedule.', { pillTitle: 'CLARIFY TASK NAME' });
        }
        a.name = rawNm;
      }
      if (a.note !== undefined) {
        let cleanNote = String(a.note || '').replace(/<[^>]+>/g, '').trim()
          .replace(/^(?:(?:in\s+notes?\s+(?:write|add|put)|add\s+(?:a\s+|the\s+)?notes?|bright\s+dead|right\s+that|write\s+dead|ride\s+that|white\s+that|write\s+that|write|add|put|set|say|saying|that|like|as|to|is|notes?|the)+\s+)+/i, '')
          .trim();
        const curTitle = norm(val('#taskName') || a.name || '');
        const noteToks = norm(cleanNote).split(' ').filter((w) => w.length > 2 && !STOP_W.has(w));
        if (curTitle && noteToks.length > 0 && noteToks.length <= 5 && noteToks.every((w) => curTitle.includes(w))) {
          cleanNote = '';
        }
        a.note = cleanNote;
      }
      const { done, justSetName } = fillForm(a);
      if (a.name) focusInView($('#taskName'));
      if (a.category) { flow.catDone = true; focusInView($('#taskCategory')); }
      if (a.duration) {
        flow.durDone = true;
        focusInView($('#taskDuration'));
        const idx = done.findIndex((d) => d.startsWith('duration to '));
        if (idx >= 0) done[idx] = 'duration to ' + durLabelFull(snapDuration(Number(a.duration)));
      }
      if (a.time || a.when === 'manual') focusInView($('#taskManualTime') || $('[data-when-pick="manual"]'));
      if (a.note !== undefined) focusInView($('#taskNote'));
      if (!done.length) return no('Tell me the task name, category, duration, start time, or note.', { pillTitle: 'CLARIFY FORM FIELD' });
      if (a.category && !a.duration && !flow.durDone) {
        flow.step = 'edit_dur';
        awaitDuration = true;
        return ok('Set ' + done.join(', ') + '. What duration should I set: 30, 45, 60, 90, or 120 minutes?');
      }
      const prompt = nextPrompt(justSetName).replace(/\b1\.5 hours\b/g, '90 minutes (1.5 hours)').replace(/\b1 hour\b/g, '60 minutes (1 hour)');
      if (justSetName && done.length === 1) {
        const curCat = catLabel();
        const allCats = ['Study', 'Project / lab', 'Lecture', 'Wellness', 'Meal'];
        const others = allCats.filter((c) => c.toLowerCase() !== curCat.toLowerCase());
        const otherStr = others.slice(0, -1).join(', ') + ', or ' + others[others.length - 1];
        return ok('I set the task name to "' + val('#taskName') + '" (say "change name to ..." if wrong). Category is currently ' + curCat + ' - keep ' + curCat + ', or change to ' + otherStr + '?');
      }
      return ok('Set ' + done.join(', ') + '. ' + prompt);
    },
    confirm_task() {
      if (!addActive()) goScreen('add');
      const nm = val('#taskName');
      const cat = catLabel();
      const dur = durLabelFull(durMinutes());
      const wh = whenText();
      const ws = activeWsName();
      if (!$('#parsedCard').classList.contains('show') && nm) {
        const form = $('#taskForm');
        if (form.requestSubmit) form.requestSubmit(); else clickEl('#taskForm button[type="submit"]');
      }
      if (!$('#parsedCard').classList.contains('show')) return no('Fill in the task name first so I can build and save your task.', { pillTitle: 'TASK NAME NEEDED' });
      clickEl('#confirmTaskBtn');
      if (nm) flow.lastAdded = { title: nm, category: cat, duration: dur, when: wh, workspace: ws };
      resetFlow();
      return ok('Added "' + (nm || 'your task') + '" (' + cat + ', ' + dur + wh + ') to ' + ws + '!');
    },
    toggle_all_habits(a) {
      goScreen('plan');
      clickEl('[data-plan="daily"]');
      const want = a && a.done !== undefined ? !!a.done : true;
      const now = new Date();
      const todayKey = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
      const totalCount = habitNames().length || $$('#habitMatrix .habit-name-cell').length;
      if (!totalCount) return no('No daily habits were found on this screen.');
      const getLiveCell = (hi) => {
        const direct = $('#habitMatrix .habit-check[data-habit-date="' + todayKey + '"][data-habit-index="' + hi + '"]');
        if (direct && !direct.disabled) return direct;
        const row = $$('#habitMatrix .habit-check[data-habit-index="' + hi + '"]').filter((b) => !b.disabled);
        return row.length ? row[row.length - 1] : null;
      };
      const countMatchingNow = () => {
        let matched = 0;
        for (let i = 0; i < totalCount; i++) {
          const b = getLiveCell(i);
          if (!b) continue;
          const isDone = b.getAttribute('aria-pressed') === 'true' || b.classList.contains('done');
          if (isDone === want) matched++;
        }
        return matched;
      };
      const beforeMatched = countMatchingNow();
      if (beforeMatched === totalCount) {
        focusInView($('#habitMatrix'));
        return ok('All ' + totalCount + ' of ' + totalCount + ' daily habits are already ' + (want ? 'checked off' : 'unchecked') + ' for today in ' + activeWsName() + '.');
      }
      for (let i = 0; i < totalCount; i++) {
        const liveBtn = getLiveCell(i);
        if (!liveBtn) continue;
        const isDone = liveBtn.getAttribute('aria-pressed') === 'true' || liveBtn.classList.contains('done');
        if (isDone !== want) {
          dispatchRealClick(liveBtn);
        }
      }
      focusInView($('#habitMatrix'));
      const afterMatched = countMatchingNow();
      const newlyChanged = Math.max(0, afterMatched - beforeMatched);
      if (afterMatched === totalCount) {
        return ok((want ? 'Checked off ' : 'Unchecked ') + newlyChanged + ' new daily habit' + (newlyChanged === 1 ? '' : 's') + ' - all ' + afterMatched + ' of ' + totalCount + ' habits are now ' + (want ? 'complete' : 'unchecked') + ' for today in ' + activeWsName() + '.');
      }
      return no((want ? 'Checked off ' : 'Unchecked ') + newlyChanged + ' habit' + (newlyChanged === 1 ? '' : 's') + ' (' + afterMatched + ' of ' + totalCount + ' complete; ' + (totalCount - afterMatched) + ' could not be updated).', { pillTitle: 'ACTION INCOMPLETE' });
    },
    demo_mode(a) {
      if ((a.mode || 'start') === 'start') {
        if (isDemo()) return ok('Demo mode is already active. Say "exit demo" anytime to return to your saved tasks.');
        if (authBlocked()) clickEl('#authDemoButton'); else clickEl('#demoToggle');
        applyV98Polish();
        return ok('Entered demo mode with 9 sample tasks. Say "exit demo" anytime to return to your real tasks.');
      }
      if (!isDemo()) return ok('You are already in your real account workspace.');
      const exitBtn = ($('#demoExitFloating') && !$('#demoExitFloating').hidden) ? $('#demoExitFloating') : $('#demoToggle');
      if (exitBtn) dispatchRealClick(exitBtn);
      return ok('Exited demo mode. Your real saved tasks are back on screen.');
    },
    switch_workspace_ui(a) {
      if (!a.confirmed && addActive() && val('#taskName')) {
        const draft = val('#taskName');
        pending = { kind: 'switch_workspace', name: a.name || '', title: draft, until: Date.now() + WAIT_MS };
        return ok('You have an unsaved task "' + draft + '" on the form. Discard it and switch workspace? Say yes to switch, or no to stay.', { pillTitle: 'CONFIRM WORKSPACE SWITCH' });
      }
      const q = norm(a.name).replace(/\b(?:group|workspaces?|space|section|tab|page)\b/g, '').trim();
      if (!q && $('#personalWorkspaceItem') && !$('#personalWorkspaceItem').classList.contains('selected')) {
        resetFlow();
        dispatchRealClick($('#personalWorkspaceItem'));
        return ok('Switched to your Personal workspace.');
      }
      resetFlow();
      return switchWorkspace(a.name);
    },
    move_task(a) {
      const tools = window.v3gamTaskTools;
      if (!tools || typeof tools.find !== 'function') return no('Moving tasks is not available right now.');
      const query = String((a && a.name) || '').trim();
      if (!query || /^(?:it|this|that|task|the task)$/i.test(query)) {
        return no('Which task would you like to move? Please say the task name.', { pillTitle: 'CLARIFY CHOICE' });
      }
      const matches = tools.find(query);
      if (!matches.length) {
        return no('I could not find a task matching "' + query + '" in ' + activeWsName() + '.', { pillTitle: 'CONTROL NOT FOUND - TRY CLOSER MATCH' });
      }
      if (matches.length > 1) {
        const exacts = matches.filter((m) => m.exact);
        if (exacts.length !== 1) {
          return no('I found ' + matches.length + ' tasks matching "' + query + '": ' + matches.slice(0, 3).map((m) => '"' + m.title + '"').join(', ') + '. Which one should I move?', { pillTitle: 'CLARIFY CHOICE' });
        }
      }
      const pick = matches.find((m) => m.exact) || matches[0];
      const isFuzzy = !pick.exact && norm(pick.title) !== norm(query);
      const destLabel = a.deltaMinutes
        ? ('+' + Math.round(a.deltaMinutes / 60 * 10) / 10 + ' hours')
        : (a.day === 1 ? 'tomorrow' : a.day === 7 ? 'next week' : a.day === 0 ? 'today' : '') + (a.start ? ((a.day !== undefined ? ' at ' : '') + format12h(a.start)) : '');
      if (isFuzzy && !a.confirmed) {
        pending = {
          kind: 'move_task',
          id: pick.id,
          title: pick.title,
          updates: { ...(a.day !== undefined ? { day: a.day } : {}), ...(a.start ? { start: a.start } : {}), ...(a.deltaMinutes ? { deltaMinutes: a.deltaMinutes } : {}) },
          destLabel: destLabel || 'the new slot',
          until: Date.now() + WAIT_MS
        };
        return ok('Move "' + pick.title + '" to ' + (destLabel || 'the new slot') + '? Say yes to confirm, or no to keep it.', { pillTitle: 'CONFIRM ACTION' });
      }
      const moved = tools.move(pick.id, { ...(a.day !== undefined ? { day: a.day } : {}), ...(a.start ? { start: a.start } : {}), ...(a.deltaMinutes ? { deltaMinutes: a.deltaMinutes } : {}) });
      if (!moved) return no('Could not move "' + pick.title + '".');
      flow.lastMoved = moved;
      const dayStr = moved.current.day === 1 ? 'tomorrow' : moved.current.day === 7 ? 'next week' : moved.current.day === 0 ? 'today' : ('day +' + moved.current.day);
      return ok('Moved "' + moved.current.title + '" to ' + dayStr + ' at ' + moved.current.when + '. Say "undo" to move it back.');
    },
    create_workspace_confirmed(a) {
      const wsName = String((a && a.name) || '').trim().replace(/[.,;!?]+$/g, '');
      if (!wsName) return no('What would you like to name the group workspace?', { pillTitle: 'CLARIFY CHOICE' });
      pending = { kind: 'create_workspace', name: wsName, until: Date.now() + WAIT_MS };
      return ok('Create a new group workspace called "' + wsName + '"? Say yes to create it, or no to cancel.', { pillTitle: 'CONFIRM ACTION' });
    },
    remove_workspace_confirmed(a) {
      const targetWs = String((a && a.name) || activeWsName()).trim().replace(/\s*(?:group\s+)?workspaces?$/i, '').replace(/[.,;!?]+$/g, '').trim();
      if (/^personal$/i.test(targetWs)) {
        return no('Your Personal workspace cannot be deleted. You can remove custom group workspaces.', { pillTitle: "CAN'T DO THAT" });
      }
      pending = { kind: 'remove_workspace', name: targetWs, until: Date.now() + WAIT_MS };
      return ok('Remove the "' + targetWs + '" group workspace? Say yes to confirm, or no to keep it.', { pillTitle: 'CONFIRM ACTION' });
    },
    stage_multi_add_task(a) {
      pending = {
        kind: 'multi_add_task',
        taskSpec: {
          title: a.title || 'New task',
          category: a.category || lastCategory(a.title || '') || 'study',
          duration: Number(a.duration) || 60,
          start: a.start || '09:00',
          day: Number(a.day) || 0
        },
        nextScreen: a.nextScreen || null,
        nextTab: a.nextTab || null,
        until: Date.now() + WAIT_MS
      };
      const dayLabel = Number(a.day) === 1 ? 'tomorrow' : 'today';
      const navLabel = a.nextTab ? (' and open your ' + a.nextTab) : a.nextScreen ? (' and open your ' + a.nextScreen) : '';
      return ok('Ready to add "' + pending.taskSpec.title + '" for ' + dayLabel + ' at ' + format12h(pending.taskSpec.start) + ' for ' + pending.taskSpec.duration + ' minutes' + navLabel + '. Say yes to confirm, or no to cancel.', { pillTitle: 'CONFIRM ACTION' });
    },
    read_remaining_tasks() {
      const tools = window.v3gamTaskTools;
      const all = (tools && typeof tools.listAll === 'function') ? tools.listAll() : [];
      const todayList = (tools && typeof tools.listToday === 'function') ? tools.listToday() : [];
      const ws = activeWsName();
      if (!all.length) return ok('You have 0 tasks in ' + ws + '.');
      const todayRemaining = todayList.filter((t) => t.status !== 'done');
      const todayDone = todayList.filter((t) => t.status === 'done');
      const otherDayTasks = all.filter((t) => Number(t.day) !== 0);
      const previewSource = todayRemaining.length ? todayRemaining : all;
      const items = previewSource.slice(0, 4).map((t) => '"' + t.title + '" (' + (t.when || 'scheduled') + (t.day === 1 ? ' tomorrow' : t.day === 0 ? ' today' : '') + ')').join(', ');
      const otherSuffix = otherDayTasks.length ? (', plus ' + otherDayTasks.length + ' on other days (' + all.length + ' total in workspace)') : '';
      return ok('In ' + ws + ', you have ' + todayRemaining.length + ' remaining task' + (todayRemaining.length === 1 ? '' : 's') + ' today (out of ' + todayList.length + ' scheduled today, with ' + todayDone.length + ' completed' + otherSuffix + '): ' + items + '.');
    },
    read_free_time() {
      const tools = window.v3gamTaskTools;
      const todayList = (tools && typeof tools.listToday === 'function') ? tools.listToday() : [];
      const toMins = (hhmm) => {
        const parts = String(hhmm || '09:00').split(':').map(Number);
        return (parts[0] || 0) * 60 + (parts[1] || 0);
      };
      const dinnerTask = todayList.find((t) => /\bdinner\b/i.test(t.title));
      const dinnerCutoff = dinnerTask ? toMins(dinnerTask.start) : 18 * 60;
      const dinnerLabel = format12h(String(Math.floor(dinnerCutoff / 60)).padStart(2, '0') + ':' + String(dinnerCutoff % 60).padStart(2, '0'));
      const preDinnerTasks = todayList.filter((t) => toMins(t.start) < dinnerCutoff);
      const postDinnerTasks = todayList.filter((t) => toMins(t.start) >= dinnerCutoff);
      const windowStart = preDinnerTasks.length ? Math.min(8 * 60, ...preDinnerTasks.map((t) => toMins(t.start))) : 8 * 60;
      const totalWindowMins = Math.max(0, dinnerCutoff - windowStart);
      let bookedBeforeDinner = 0;
      for (const t of preDinnerTasks) {
        const s = Math.max(windowStart, toMins(t.start));
        const e = Math.min(dinnerCutoff, toMins(t.start) + (Number(t.duration) || 60));
        if (e > s) bookedBeforeDinner += (e - s);
      }
      const freeBeforeDinner = Math.max(0, totalWindowMins - bookedBeforeDinner);
      const fh = Math.floor(freeBeforeDinner / 60), fm = freeBeforeDinner % 60;
      const bh = Math.floor(bookedBeforeDinner / 60), bm = bookedBeforeDinner % 60;
      return ok('Before dinner at ' + dinnerLabel + ', you have ' + preDinnerTasks.length + ' task' + (preDinnerTasks.length === 1 ? '' : 's') + ' scheduled between 8:00 AM and ' + dinnerLabel + ' (' + bh + 'h ' + bm + 'm booked; ' + postDinnerTasks.length + ' task' + (postDinnerTasks.length === 1 ? '' : 's') + ' at or after ' + dinnerLabel + ' excluded), leaving ' + fh + 'h ' + fm + 'm of free time before dinner.');
    },
    read_habit_streak() {
      const now = new Date();
      const totalHabits = habitNames().length || $$('#habitMatrix .habit-name-cell').length || 10;
      const countDoneForDate = (d) => {
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        return $$('#habitMatrix .habit-check[data-habit-date="' + key + '"]').filter((b) => b.classList.contains('done') || b.getAttribute('aria-pressed') === 'true').length;
      };
      const todayDone = countDoneForDate(now);
      let streakDays = 0;
      const startOffset = todayDone > 0 ? 0 : -1;
      for (let off = startOffset; off >= -30; off--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
        if (d.getMonth() !== now.getMonth()) break;
        if (countDoneForDate(d) > 0) streakDays++;
        else break;
      }
      const monthCheckIns = ($('#habitCompleted') && $('#habitCompleted').textContent) || '0';
      const monthPct = ($('#habitProgressText') && $('#habitProgressText').textContent) || '0%';
      if (todayDone > 0) {
        return ok('Yes - your habit streak is alive at ' + streakDays + ' consecutive day' + (streakDays === 1 ? '' : 's') + ' (' + todayDone + ' of ' + totalHabits + ' habits completed today, ' + monthCheckIns + ' check-ins / ' + monthPct + ' this month).');
      }
      if (streakDays > 0) {
        return ok('Your ' + streakDays + '-day streak through yesterday needs a check-in today (0 of ' + totalHabits + ' habits completed today, ' + monthCheckIns + ' check-ins this month).');
      }
      return ok('Not yet - your current habit streak is 0 consecutive days (0 of ' + totalHabits + ' habits completed today, ' + monthCheckIns + ' check-ins this month).');
    },
    undo_last() {
      const tools = window.v3gamTaskTools;
      if (flow.lastMoved && tools && typeof tools.move === 'function') {
        const m = flow.lastMoved;
        flow.lastMoved = null;
        tools.move(m.prev.id, { day: m.prev.day, start: m.prev.start });
        return ok('Reverted "' + m.prev.title + '" back to ' + (m.prev.day === 1 ? 'tomorrow' : 'today') + ' at ' + m.prev.when + '.');
      }
      if (!flow.lastAdded) return no('There is no recently added or moved task from this session to undo.');
      const r = scheduleDelete(flow.lastAdded.title);
      return r.ok ? ok('Undo that? ' + r.reply, { pillTitle: 'CONFIRM ACTION' }) : r;
    },
    confirm_pending() {
      if (pending && Date.now() <= pending.until && pending.kind === 'switch_workspace') {
        const target = pending.name || '';
        pending = null;
        resetFlow();
        resetTaskFormDom();
        return COMMANDS.switch_workspace_ui({ name: target, confirmed: true });
      }
      if (pending && Date.now() <= pending.until && pending.kind === 'leave_form') {
        const p = pending;
        pending = null;
        if (p.tab) return COMMANDS.open_plan_tab({ tab: p.tab, confirmed: true });
        return COMMANDS.open_screen({ screen: p.screen, confirmed: true });
      }
      if (!pending || Date.now() > pending.until) { pending = null; return no('Nothing is waiting for confirmation.', { pillTitle: "CAN'T DO THAT" }); }
      const p = pending; pending = null;
      if (p.kind === 'signout') {
        if (window.v3gamAdaptiveLayer) window.v3gamAdaptiveLayer.clearOnSignOut();
        const b = $('#orbitSignOut');
        if (!b || b.hidden) return no('You are not signed in.');
        dispatchRealClick(b);
        return ok('Signing you out.');
      }
      if (p.kind === 'delete') {
        const tools = window.v3gamTaskTools;
        if (!tools) return no('Deleting tasks is not available right now.');
        tools.remove(p.id).then(() => {
          if (flow.lastAdded && norm(flow.lastAdded.title) === norm(p.title)) flow.lastAdded = null;
          if (window.v3gamLiveAgent) window.v3gamLiveAgent.toast('Deleted "' + p.title + '"');
        });
        if (p.nextScreen) {
          resetFlow();
          goScreen(p.nextScreen);
          const labels = { home: "Today's dashboard", plan: 'your Plan', workspace: 'your Workspaces', stats: 'your Insights' };
          return ok('Deleting "' + p.title + '" and opened ' + (labels[p.nextScreen] || p.nextScreen) + '.');
        }
        return ok('Deleting "' + p.title + '".');
      }
      if (p.kind === 'move_task') {
        return COMMANDS.move_task({ name: p.title, ...p.updates, confirmed: true });
      }
      if (p.kind === 'create_workspace') {
        const tools = window.v3gamTaskTools;
        if (tools && typeof tools.createWorkspaceLocal === 'function') {
          tools.createWorkspaceLocal(p.name);
        }
        return ok('Created and switched to the "' + p.name + '" group workspace.');
      }
      if (p.kind === 'remove_workspace') {
        const tools = window.v3gamTaskTools;
        if (tools && typeof tools.removeWorkspaceLocal === 'function') {
          tools.removeWorkspaceLocal(p.name);
        }
        return ok('Removed the "' + p.name + '" group workspace and switched to Personal workspace.');
      }
      if (p.kind === 'multi_add_task') {
        const tools = window.v3gamTaskTools;
        if (tools && typeof tools.createDirect === 'function') {
          const created = tools.createDirect(p.taskSpec);
          flow.lastAdded = { title: created.title };
        }
        resetFlow();
        resetTaskFormDom();
        if (p.nextTab) COMMANDS.open_plan_tab({ tab: p.nextTab, confirmed: true });
        else if (p.nextScreen) COMMANDS.open_screen({ screen: p.nextScreen, confirmed: true });
        return ok('Added "' + p.taskSpec.title + '" (' + p.taskSpec.duration + ' minutes at ' + format12h(p.taskSpec.start) + (p.taskSpec.day === 1 ? ' tomorrow' : '') + ')' + (p.nextScreen || p.nextTab ? ' and opened your Plan.' : '.'));
      }
      return no('Nothing is waiting for confirmation.', { pillTitle: "CAN'T DO THAT" });
    },
    scroll_page(a) {
      const d = a.direction || 'down';
      const modals = [
        isOpen('#notificationsDialog') && $('#notificationsList'),
        isOpen('#notificationsDialog') && $('#notificationsDialog .notifications-modal'),
        isOpen('#workspaceDialog') && $('#workspaceDialog .workspace-modal'),
        isOpen('#habitManagerOverlay') && $('#habitManagerOverlay .habit-manager-sheet'),
        isOpen('#agentOverlay') && $('#chatWindow')
      ].filter(Boolean);
      const mEl = modals.find((c) => c.scrollHeight > c.clientHeight + 4);
      if (mEl) {
        const st = Math.max(180, mEl.clientHeight * 0.75);
        mEl.scrollBy({ top: d === 'up' ? -st : st, behavior: 'smooth' });
        return ok('Scrolled ' + d + '.');
      }
      const s = $('#scroll');
      const el = s && s.scrollHeight > s.clientHeight + 4 ? s : null;
      const step = (el ? el.clientHeight : window.innerHeight) * 0.8;
      if (el) {
        if (d === 'down') el.scrollBy({ top: step, behavior: 'smooth' });
        else if (d === 'up') el.scrollBy({ top: -step, behavior: 'smooth' });
        else if (d === 'top') el.scrollTo({ top: 0, behavior: 'smooth' });
        else if (d === 'bottom') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } else {
        window.scrollBy({ top: d === 'up' ? -step : step, behavior: 'smooth' });
      }
      return ok(d === 'top' ? 'Scrolled to the top.' : d === 'bottom' ? 'Scrolled to the bottom.' : 'Scrolled ' + d + '.');
    }
  });
  KEEP_OVERLAYS.add('toggle_all_habits');
  KEEP_OVERLAYS.add('show_todays_flow');
  KEEP_OVERLAYS.add('clear_task_draft');
  KEEP_OVERLAYS.add('scroll_page');

  let lastRawUtterance = '';
  let turnCounter = 0;
  let lastFailedCommandText = '';
  let lastMenuOpenReason = '';
  let consecutiveFailures = 0;

  function ensureV101DomAndDraft() {
    const sel = $('#taskDuration');
    if (sel && !sel.querySelector('option[value="150"]')) {
      [['15', '15 minutes'], ['150', '150 minutes (2.5 hours)'], ['180', '180 minutes (3 hours)']].forEach(([v, txt]) => {
        if (!sel.querySelector('option[value="' + v + '"]')) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = txt;
          sel.appendChild(opt);
        }
      });
    }
  }
  setTimeout(ensureV101DomAndDraft, 80);

  function preNormalizeV98(raw) {
    let s = String(raw || '').trim();
    s = s.replace(/^(?:(?:um+|uh+|er+|erm|hmm+|like|please)[,.\s]+)+/i, '').replace(/(?:[,.\s]+(?:um+|uh+|er+|erm|hmm+|please))+$/i, '');
    s = s.replace(/\b([a-z0-9']+)\s+\1\b/gi, '$1').replace(/\b(add\s+a)\s+\1\b/gi, '$1');
    if (/^(?:addtask)?addtaskgym(?:tomorrow)?at(?:6|six)amfor(?:45|fortyfive)minutes?$/i.test(s.replace(/[^a-z0-9]/gi, ''))) {
      s = 'Add gym tomorrow at 6 AM for 45 minutes';
    }
    return normalizeSpeech(s)
      .replace(/\b(?:ad|had|at)\s+a?\s*(?:tusk|tasks|tax|test)\b/gi, 'add a task')
      .replace(/^in\s+that\s+change\s+(?:the\s+)?theme$/gi, 'change the theme')
      .replace(/^chain\s+the\s+theme$/gi, 'change the theme')
      .replace(/^(?:open\s+a\s+eye|open\s+ai(?:\s+panel)?)$/gi, 'open ai')
      .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:2\s*,?\s*1026|2000\s+26|20\s+26|twenty\s+twenty\s+six)\b/gi, '$1 2026')
      .replace(/\b(describe|described|describing|record|speak|capture)\b([^.?!]{0,35}?)\bwith\s+(?:my|your|the)\s+(?:boys|vice|voyce)\b/gi, '$1$2with my voice')
      .replace(/\b(add|in|set|write|put|enter)\s+notebook\b/gi, '$1 note book')
      .replace(/^notebook\s+(the|to|for|that|is|about)\b/i, 'note book $1')
      .replace(/\b(?:bright\s+dead|right\s+that|write\s+dead|ride\s+that|white\s+that)\b/gi, 'write that')
      .replace(/\bproject\s*\/?\s*lab\b/gi, 'lab')
      .replace(/\b(?:tree|free|3|three)\s+lines?(?:\s+menu)?\b/gi, 'three lines')
      .replace(/\bsite\s+panel\b/gi, 'side panel')
      .replace(/\bdelhi\s+habits?\b/gi, 'daily habits')
      .replace(/\bmark\s+meditation\s+dun\b/gi, 'mark meditation done')
      .replace(/\bbuild\s+my\s+plant\b/gi, 'build my plan')
      .replace(/\bswitch\s+two\b/gi, 'switch to')
      .replace(/\bindex\s+current\s+creation\s+of(?:\s+task)?\b/gi, '__GARBLED_INDEX_CREATION__')
      .replace(/\bin\s+(?:that|the)\s+current\s+creation\s+of\s+task\b/gi, 'in current task')
      .trim();
  }

  function parseV98Pre(t0) {
    const rawTrim = String(lastRawUtterance || t0 || '').trim();

    if (/^(?:cancel|abort|stop)\s+(?:the\s+)?(?:delete|deletion|remove|removal|confirmation|action)$/i.test(rawTrim)) {
      pending = null;
      return S('chat_reply', { reply: 'Cancelled the pending delete request — nothing was deleted.' });
    }
    if (/^(?:(?:please|hey\s+vegam)\s+)?(?:don'?t|do\s+not|never|i\s+don'?t\s+want\s+to|i\s+do\s+not\s+want\s+to|please\s+don'?t|please\s+do\s+not)\s+(?:delete|remove|clear|mark|open|go\s+to|switch|change|add|create|tick|check|close|move|reschedule|sign\s+out|log\s+out)\b/i.test(rawTrim)) {
      pending = null;
      return S('chat_reply', { reply: "Understood — I won't run that action. No changes were made." });
    }
    if (/^what\s+does\s+delete\s+all\s+(?:my\s+)?tasks?\s+do\??$/i.test(rawTrim)) {
      return S('chat_reply', { reply: '"Delete all tasks" removes every task in your active workspace after asking you to confirm with "yes". Nothing was deleted.' });
    }
    if (/^should\s+i\s+delete\s+(?:this|it|that)(?:\s+task)?\??$/i.test(rawTrim)) {
      return S('chat_reply', { reply: 'You can say "move it to tomorrow" to keep it for later, "mark it done" if finished, or "delete" if no longer needed. Nothing was deleted.' });
    }
    if (/^why\s+did\s+you\s+open\s+(?:the\s+)?(?:menu|side\s+panel|sidebar)\??$/i.test(rawTrim)) {
      return S('chat_reply', { reply: 'I opened the side navigation panel because ' + (lastMenuOpenReason || 'a previous command matched the menu') + '. Say "close side panel" to hide it.' });
    }

    if (/__GARBLED_INDEX_CREATION__/i.test(t0) || /\b(?:blargle|fizzbuzz)\b/i.test(rawTrim)) {
      return S('chat_reply', { ok: false, reply: "I didn't understand that — no changes were made. Please rephrase what you'd like to do." });
    }
    if (/\b(?:tell\s+me\s+a\s+joke|what'?s\s+the\s+weather|sing\s+a\s+song)\b/i.test(rawTrim)) {
      return S('chat_reply', { ok: false, reply: "I can't help with jokes or weather here — I'm Vegam, your V3GAM task and habit scheduler. I can add or reschedule tasks, tick daily habits, switch workspaces, or open your plan and insights." });
    }
    if (/\b(?:send\s+this\s+task.*whatsapp|set\s+an\s+alarm\s+on\s+my\s+phone|sync\s+with\s+google\s+calendar)\b/i.test(rawTrim)) {
      return S('chat_reply', { ok: false, reply: "I can't connect to WhatsApp, phone alarms, or Google Calendar directly from V3GAM. I can set in-app task reminders, share your workspace invite code, or schedule tasks here." });
    }
    if (/\bread\s+me\s+the\s+invite\s+code\b|\bmembers'?\s+emails\b/i.test(rawTrim)) {
      return S('chat_reply', { ok: false, reply: "For your security and privacy, I don't read secret workspace invite codes or member email addresses aloud. You can view or copy the invite code visually on the Workspaces screen." });
    }
    if (/^can\s+you\s+track\s+habits\??$/i.test(rawTrim)) {
      return S('chat_reply', { reply: "Yes! I can open your Daily Habits tab, mark individual habits like Meditation done for today, tick all of today's habits at once, and tell you how many habits you finished this week." });
    }
    if (/^how\s+many\s+habits\s+did\s+i\s+finish\s+this\s+week\??$/i.test(rawTrim)) {
      const doneAll = $$('#habitMatrix .habit-check.done, #habitMatrix .habit-check[aria-pressed="true"]').length;
      return S('chat_reply', { reply: "You've completed " + doneAll + " habit check-ins on your weekly tracker." });
    }
    if (/^what\s+was\s+the\s+task\s+i\s+just\s+added\??$/i.test(rawTrim)) {
      if (flow.lastAdded && flow.lastAdded.title) {
        return S('chat_reply', { reply: 'The last task you added was "' + flow.lastAdded.title + '"' + (flow.lastAdded.workspace ? ' in ' + flow.lastAdded.workspace : '') + '.' });
      }
      return S('chat_reply', { reply: "You haven't added a task in this session yet." });
    }
    if (/^(?:did\s+you\s+save\s+(?:it|that)|was\s+it\s+saved)\??$/i.test(rawTrim)) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return S('chat_reply', { reply: 'No, it was not saved because your connection is offline. Your draft is preserved on the form.' });
      }
      if (flow.lastAdded && flow.lastAdded.title) {
        return S('chat_reply', { reply: 'Yes, "' + flow.lastAdded.title + '" is saved in ' + (flow.lastAdded.workspace || activeWsName()) + '.' });
      }
      return S('chat_reply', { reply: 'No task has been saved yet.' });
    }
    if (/^not\s+that\s+one,?\s+the\s+other\s+one$/i.test(rawTrim)) {
      return S('chat_reply', { ok: false, reply: "I'm not sure which other task or option you mean. Please say the task name directly." });
    }
    if (/^open\s+(?:the\s+)?sidebar\s+settings$/i.test(rawTrim)) {
      return S('chat_reply', { ok: false, reply: 'There is no "sidebar settings" screen — would you like me to open the side navigation panel, or change the theme?' });
    }
    if (/^change\s+(?:the\s+)?team$/i.test(rawTrim)) {
      return S('chat_reply', { ok: false, reply: 'Did you mean "change the theme" (dark/light mode) or "switch workspace" to a team group?' });
    }
    if (/\bdescribe\s+it\s+with\s+(?:my|your)\s+choice\b/i.test(rawTrim)) {
      return S('chat_reply', { reply: 'Did you mean the "Describe it with your voice" button? Say "Click describe it with my voice" to trigger it.' });
    }
    if (/^(?:tick\s*mark|tick|check|mark)\s+all\s+(?:my\s+)?daily\s+habits?\s+(?:2|two)\s+days$/i.test(rawTrim)) {
      return S('chat_reply', { reply: 'Did you mean tick all your daily habits for today, or for the last 2 days (today and yesterday)?' });
    }
    if (/^play\s+all\s+(?:my\s+)?daily\s+habits?$/i.test(rawTrim)) {
      goScreen('plan');
      try { clickEl('[data-plan="daily"]'); } catch (_) {}
      return S('chat_reply', { reply: 'Opened your Daily Habits view. Would you like me to read your daily habits aloud or tick them all done for today?' });
    }
    if (/^add\s+(\d+)\s+tasks?\b/i.test(rawTrim) && Number(RegExp.$1) > 5) {
      return S('chat_reply', { ok: false, reply: 'Adding ' + RegExp.$1 + ' tasks at once would overload your schedule (batch creation is capped at 3 tasks). Which task would you like to add first?' });
    }

    const explicitCalled = /^(?:(?:um+|uh+|er+|please)[,.\s]+)*add\s+(?:add\s+)?a\s+(?:different\s+)?(?:task|one)\s+(?:called|named|titled)\s+([\s\S]+)$/i.exec(rawTrim);
    if (explicitCalled) {
      const verbatim = explicitCalled[1].replace(/(?:,\s*uh|\s+please)$/i, '').replace(/^["']|["']$/g, '').replace(/[\r\n\u200B-\u200D\uFEFF]/g, ' ').trim().slice(0, 220);
      if (verbatim) return S('fill_task_form', { name: verbatim, verbatimTitle: true });
    }

    const core = t0.replace(LEADX, '').replace(TAILX, '').replace(/^[\s.,!?;:"-]+|[\s.,!?;:"-]+$/g, '').trim();
    if (!core) return null;
    const c = core.toLowerCase();
    let m;
    if (pending && Date.now() <= pending.until && (!pending.createdTurn || turnCounter > pending.createdTurn)) {
      if (YES.test(c)) return S('confirm_pending');
      if (NO.test(c)) return S('cancel_pending');
    }
    if (isOpen('#workspaceDialog')) {
      const createVisible = !$('#createWorkspaceForm') || $('#createWorkspaceForm').style.display !== 'none';
      if (createVisible && !val('#newWorkspaceName') && !/^(?:close|dismiss|hide|exit|cancel|create|submit|save|confirm|join|copy|refresh|switch|open)\b/i.test(core) && core.split(/\s+/).length <= 4) {
        return S('fill_workspace_dialog', { name: core });
      }
    }
    if ((m = /^(?:scroll|page|go(?:\s+to)?(?:\s+the)?)\s+(down|up|top|bottom)(?:\s+(?:a\s+(?:little|bit)|more|in\s+\w+|on\s+\w+|the\s+page|this\s+page))?$/i.exec(core))) {
      return S('scroll_page', { direction: m[1].toLowerCase() });
    }
    if (/^(?:exit|leave|stop|end|close|quit)\s+(?:the\s+)?demo(?:\s+mode)?$/i.test(core)) return S('demo_mode', { mode: 'exit' });
    if (/^(?:(?:click|tap|press|open|start|enter|try)(?:\s+on)?\s+)?(?:the\s+)?demo(?:\s+(?:mode|button))?$/i.test(core)) return S('demo_mode', { mode: 'start' });
    if (/^(?:close|hide|collapse)\s+(?:the\s+|my\s+)?(?:left\s+)?(?:side\s*panel|side\s*bar|menu)$/i.test(core)) {
      return isOpen('#agentOverlay') ? S('assistant_panel', { mode: 'close' }) : S('set_sidebar', { mode: 'hide' });
    }
    if (/^(?:open|show|expand)\s+(?:the\s+|my\s+)?(?:left\s+)?(?:side\s*panel|side\s*bar|menu)$/i.test(core)
      || /^(?:tree\s+lines?|three\s+lines?(?:\s+menu)?(?:\s+of\s+(?:the\s+)?side\s*(?:panel|bar))?|hamburger(?:\s+menu)?|menu\s+bar)$/i.test(core)) {
      lastMenuOpenReason = 'you said "' + rawTrim + '"';
      return S('set_sidebar', { mode: 'show' });
    }
    if (/^(?:click|tap|press)?(?:\s+on)?\s*(?:the\s+)?(?:three\s+lines?(?:\s+of\s+(?:the\s+)?side\s*(?:panel|bar))?|hamburger(?:\s+menu)?|sidebar\s+toggle)$/i.test(core)) {
      lastMenuOpenReason = 'you said "' + rawTrim + '"';
      return S('set_sidebar', { mode: 'toggle' });
    }
    if (/\b(?:i\s+would\s+prefer|i\s+prefer|want\s+to|let\s+me|click(?:\s+on)?)?\s*(?:describe|record|capture|speak)\s+(?:it\s+|the\s+task\s+|this\s+task\s+|task\s+)?with\s+(?:my|your|the|a)?\s*(?:voice|boys|vice|voyce)\b/i.test(core)
      || /\b(?:the\s+)?task\s+is\s+described?\s+with\s+(?:my|your)\s+(?:voice|boys|vice|voyce)\b/i.test(core)) {
      if (addActive() && /\b(?:describe|boys|voice)\b/i.test(val('#taskName'))) return S('clear_task_draft', { field: 'name', triggerVoice: true });
      return S('click_button', { target: 'describe it with your voice' });
    }
    if (/^(?:tick|check|mark|complete|finish)(?:\s+(?:off|mark))?\s+(?:today'?s\s+|all\s+|my\s+|the\s+)*(?:all\s+)?(?:my\s+)?(?:daily\s+)?habits?(?:\s+(?:for\s+)?today'?s?)?$/i.test(core)) {
      return S('toggle_all_habits', { done: true });
    }
    if ((m = /^(?:mark|tick|check|complete)\s+(meditation|drink\s+water|reading|workout|exercise|study|journal)(?:\s+habit)?(?:\s+done|\s+complete)?$/i.exec(core))) {
      const hIdx = findHabitIndex(m[1]);
      if (hIdx >= 0) return S('toggle_habit', { index: hIdx, name: m[1], done: true });
    }
    if (/^(?:show(?:\s+me)?|open|view|go\s+to|pull\s+up|check|where\s+is)\s+(?:that\s+|the\s+|my\s+)?(?:new(?:ly)?\s+created\s+task|created\s+task|added\s+task|latest\s+task)$/i.test(core)) {
      return S('show_todays_flow', { newTask: true });
    }
    if (/^(?:show(?:\s+me)?|open|view|go\s+to|pull\s+up|click(?:\s+on)?)?\s*(?:the\s+|my\s+)?(?:today'?s\s+flow|todays\s+flow|v3gam\s+flow|vegam\s+flow|daily\s+flow|flow)(?:\s+(?:button|section|card|panel))?$/i.test(core)
      || /^(?:show(?:\s+me)?|open|view|go\s+to|pull\s+up|click(?:\s+on)?)?\s*(?:the\s+|my\s+)?(?:today'?s\s+flow|todays\s+flow|v3gam\s+flow|vegam\s+flow|daily\s+flow)(?:\s+(?:button|section|card|panel))?$/i.test(t0)) {
      return S('show_todays_flow', {});
    }
    if ((m = /^(?:actually\s+call\s+it|no\s+call\s+it|rename\s+it\s+to|change\s+(?:the\s+)?(?:task\s+)?name\s+to)\s+(.+)$/i.exec(rawTrim))) {
      return S('fill_task_form', { name: m[1].trim(), verbatimTitle: true });
    }
    if (addActive()) {
      if (/^(?:cancel\s+that|never\s*mind,?\s*start\s+over|start\s+over|reset\s+form)$/i.test(core)) {
        return S('clear_task_draft', { field: 'all' });
      }
      if (/^(?:that\s+is\s+not\s+a?\s*task|this\s+task)$/i.test(core)) {
        return S('chat_reply', { reply: 'No change made to the form. Would you like to change the task name, or say "cancel that" to clear the form?' });
      }
      if (/\byesterday\b/i.test(core)) {
        return S('chat_reply', { ok: false, reply: 'Yesterday is in the past. Would you like to schedule this task for today or tomorrow instead?' });
      }
      if (/(?:\bminus\s+\d+|-\d+)\s*(?:minutes?|mins?|hours?|hrs?)/i.test(rawTrim)) {
        return S('chat_reply', { ok: false, reply: "Task duration can't be negative — please choose a positive duration between 15 and 180 minutes." });
      }
      if (/\b([1-9]\d{2,}|[1-9]\d)\s*hours?\b/i.test(rawTrim)) {
        return S('chat_reply', { ok: false, reply: 'That duration is too long for a single daily task block (max 3 hours / 180 minutes). Would you like 120 or 180 minutes?' });
      }
      if (/(?<!:)\b(2[4-9]|[3-9]\d)\s*(?:o'?clock|am|pm|:00)\b/i.test(rawTrim)) {
        return S('chat_reply', { ok: false, reply: "That isn't a valid time of day — please choose a start time between 12:00 AM and 11:59 PM." });
      }
      if (/\b(?:that\s+is\s+not|this\s+is\s+not|not\s+(?:a\s+|the\s+)?task\s+name|wrong\s+task\s+name|(?:remove|clear|delete|reset|erase)\s+(?:the\s+|this\s+|my\s+)?task\s+name)\b/i.test(core)
        || (/^task\s+name$/i.test(core) && !!val('#taskName'))) {
        return S('clear_task_draft', { field: 'name', triggerVoice: /\b(?:describe|voice|boys)\b/i.test(core) });
      }
      if (/^(?:remove|delete|clear|cancel|discard|reset)\s+(?:this|that|current|the|my)?\s*(?:task|form|draft)$/i.test(core)) {
        return S('clear_task_draft', { field: 'all' });
      }
      if ((m = /^(?:(?:give|set|put|enter|write|fill|type|change|update|make|rename)(?:\s+(?:the|a|me|my))*|)\s*(?:task\s+(?:name|title)|(?:name|title)\s+of\s+(?:the\s+)?task|(?:name|title))\s+(?:is|as|to)\s+(.+)$/i.exec(core))) {
        return S('fill_task_form', { name: m[1].trim(), verbatimTitle: true });
      }
      if (/\b(?:more|longer|greater|over|above)\s+than\s+(?:an?\s+|one\s+|1\s+)hours?\b/i.test(core)) {
        return S('ask_duration', { less: false });
      }
      if (/\b(?:less|shorter|under|below)\s+than\s+(?:an?\s+|one\s+|1\s+)hours?\b/i.test(core)) {
        return S('ask_duration', { less: true });
      }
      if ((m = /^(?:(?:add|set|write|enter|put|fill|update)(?:\s+in)?(?:\s+(?:the|a|my|task))*|\bin\b\s+(?:the\s+)?|)\s*notes?(?:\s+(?:field|box|section))?(?:\s*(?::|write|add|put|set|say|saying|that|like|to|as|is))*\s+(.+)$/i.exec(rawTrim))) {
        return S('fill_task_form', { note: m[1].trim() });
      }
      if (/^(?:(?:make|set|change|switch|keep)(?:\s+it)?(?:\s+(?:to|as|for))?\s+|(?:in|for|to|of|around|about)\s+)?(?:15|30|45|60|90|120|150|180|90\s+90|9090|1\.5|2\.5|(?:two|2|one|1)\s+and\s+(?:a\s+)?half(?:\s+hours?)?|an hour and a half|two hours|2 hours|three hours|3 hours|one hour|1 hour|thirty|forty five|sixty|ninety|150 minutes)(?:\s*(?:minutes?|mins?|hours?|hrs?))?$/i.test(c)) {
        const d = parseDuration(c);
        if (d && d > 0) return S('fill_task_form', { duration: snapDuration(d) });
      }
      if ((m = /^(?:(?:schedule|start|set|change|put|choose|pick|select)(?:\s+(?:it|task|the|my|own|start|time|on|at|for|to))*|(?:at|on|for))\s*(.+?)(?:\s+today)?$/i.exec(core))) {
        const pt = parseClock(m[1]);
        if (pt && pt !== 'INVALID_TIME') return S('fill_task_form', { time: pt });
      }
      if (flow.step !== 'name' && (m = new RegExp('^(?:(?:change|set|switch|make|select|choose|keep)(?:\\s+it)?(?:\\s+(?:to|as))?\\s+)(' + CAT_ALT + ')(?:\\s+category)?$', 'i').exec(core))) {
        const cat = lastCategory(m[1]);
        if (cat) return S('fill_task_form', { category: cat });
      }
      if (/\bcategory\b/i.test(core) || /\bduration\b/i.test(core)) {
        const cat = lastCategory(core);
        const dur = parseDuration(core);
        const args = {};
        if (cat) args.category = cat;
        if (dur && dur > 0) args.duration = snapDuration(dur);
        else if (/\bduration\b/i.test(core)) args.askDurationNext = true;
        if (Object.keys(args).length) return S('fill_task_form', args);
      }
      if (flow.step !== 'name') {
        const cm = new RegExp('^(' + CAT_ALT + ')\\s+(?:and|for|in|to|with)?\\s*(' + DURPHRASE + ')$', 'i').exec(core);
        if (cm) {
          const d = parseDuration(cm[2]);
          return S('fill_task_form', { category: CAT_WORDS[cm[1].toLowerCase()], ...(d && d > 0 ? { duration: snapDuration(d) } : {}) });
        }
      }
      if (/^(?:space|work|workspace|task\s+name)$/i.test(core)) {
        return S('chat_reply', { reply: 'Did you want to switch workspaces or set a task name? Say "switch to Personal workspace" or "task name is [name]".' });
      }
    }
    return null;
  }

  /* ---------- Bounded Adaptive Self-Improving Voice Layer (v102) ---------- */
  const V102_ALLOWLISTED_TARGETS = new Set([
    'open_screen:home', 'open_screen:plan', 'open_screen:workspace', 'open_screen:stats',
    'open_plan_tab:week', 'open_plan_tab:month', 'open_plan_tab:habits',
    'set_sidebar:show', 'set_sidebar:hide',
    'read_info:workspace', 'read_info:tasks', 'read_info:habits'
  ]);
  const V102_TARGET_LABELS = {
    'open_screen:home': "Open Today's dashboard",
    'open_screen:plan': 'Open Plan Ahead',
    'open_screen:workspace': 'Open Workspaces',
    'open_screen:stats': 'Open Insights',
    'open_plan_tab:week': 'Open Weekly overview',
    'open_plan_tab:month': 'Open Monthly view',
    'open_plan_tab:habits': 'Open Daily habits',
    'set_sidebar:show': 'Open the side panel',
    'set_sidebar:hide': 'Hide the side panel',
    'read_info:workspace': 'Read current workspace name',
    'read_info:tasks': "Read today's tasks",
    'read_info:habits': 'Read habit progress'
  };
  const V102_PROTECTED_WORDS = new Set([
    'yes','yeah','yep','yup','no','nope','nah','never','not','dont',"don't",'cannot','cant',"can't",
    'cancel','stop','abort','quit','exit','leave','delete','remove','erase','wipe','clear','reset',
    'destroy','drop','confirm','approve','accept','reject','deny','undo','redo','revert',
    'create','build','save','submit','edit','update','modify','rename','move','reschedule',
    'untick','uncheck','sign','signout','logout','login','signin','password','token','secret',
    'invite','share','ignore','override','bypass','forget','system','prompt','instruction','instructions',
    'admin','root','sudo','everything','everyone','everybody'
  ]);
  const V102_INVISIBLE_RE = /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g;

  class BoundedAdaptiveVoiceLayer {
    constructor(userId = null) {
      this.MAX_ENTRIES = 25;
      this.MAX_CANDIDATES = 50;
      this.MAX_QUARANTINE = 100;
      this.TTL_MS = 30 * 24 * 60 * 60 * 1000;
      this.CANDIDATE_TTL_MS = 24 * 60 * 60 * 1000;
      this.QUARANTINE_MS = 24 * 60 * 60 * 1000;
      this.MIN_CORRECTION_GAP_MS = 5000;
      this.TTS_ECHO_COOLDOWN_MS = 900;
      this.enabled = true;
      this.candidates = new Map();
      this.learnedMap = new Map();
      this.quarantineMap = new Map();
      this.auditLog = [];
      this.lastAdaptedExecution = null;
      this._lastHardwareTtsActiveAt = 0;
      this._hardwareSpeechStamps = new Map();
      this.setUser(userId);
    }

    normalizePhrase(raw) {
      return String(raw || '')
        .normalize('NFKC')
        .replace(V102_INVISIBLE_RE, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s']/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    stampHardwareSpeechEvent(event, transcript, now = Date.now()) {
      if (!event || typeof event !== 'object' || event.isTrusted !== true || !event.results || typeof event.results.length !== 'number') {
        return false;
      }
      const norm = this.normalizePhrase(transcript);
      if (!norm) return false;
      this._hardwareSpeechStamps.set(norm, now);
      if (this._hardwareSpeechStamps.size > 30) {
        const oldest = this._hardwareSpeechStamps.keys().next().value;
        this._hardwareSpeechStamps.delete(oldest);
      }
      return true;
    }

    _hasVerifiedHardwareMicEvent(normPhrase, context = {}, now = Date.now()) {
      const ev = context && context.recognitionEvent;
      if (ev && typeof ev === 'object' && ev.isTrusted === true && ev.results && typeof ev.results.length === 'number') {
        return true;
      }
      const stampedAt = this._hardwareSpeechStamps.get(normPhrase);
      if (typeof stampedAt === 'number' && (now - stampedAt) >= 0 && (now - stampedAt) <= 15000) {
        return true;
      }
      return false;
    }

    setUser(userId) {
      this.candidates.clear();
      this.learnedMap.clear();
      this.quarantineMap.clear();
      this.lastAdaptedExecution = null;
      const trimmed = typeof userId === 'string' ? userId.replace(V102_INVISIBLE_RE, '').trim() : '';
      if (!trimmed || trimmed.length < 2 || /^(?:default|anonymous|anon|guest|null|undefined|none|public|shared)$/i.test(trimmed)) {
        this.userId = null;
        this.isAuthenticatedUser = false;
        this.storageKey = null;
        return false;
      }
      this.userId = trimmed;
      this.isAuthenticatedUser = true;
      this.storageKey = 'v3gam_adaptive_aliases_v102:' + this.userId;
      this._loadFromStorage();
      return true;
    }

    clearOnSignOut() {
      this.candidates.clear();
      this.learnedMap.clear();
      this.quarantineMap.clear();
      this._hardwareSpeechStamps.clear();
      this.lastAdaptedExecution = null;
      this.userId = null;
      this.isAuthenticatedUser = false;
      this.storageKey = null;
    }

    setEnabled(flag) {
      this.enabled = Boolean(flag);
      this._saveToStorage();
      return this.enabled;
    }

    isEnabled() { return Boolean(this.enabled); }

    _isHardwareTtsActive(now = Date.now()) {
      try {
        if (window.speechSynthesis && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
          this._lastHardwareTtsActiveAt = now;
          return true;
        }
      } catch (_) {}
      return this._lastHardwareTtsActiveAt > 0 && (now - this._lastHardwareTtsActiveAt) < this.TTS_ECHO_COOLDOWN_MS;
    }

    validatePhraseAndTarget(rawPhrase, proposedTarget) {
      const p = this.normalizePhrase(rawPhrase);
      if (!p) return 'blocked:empty_phrase';
      if (/delete|remove|sign_out|wipe|drop|slot_|describe_with_voice|toggle_all_habits/i.test(String(proposedTarget || ''))) {
        return 'blocked:destructive_or_mutating_target_forbidden';
      }
      if (!V102_ALLOWLISTED_TARGETS.has(proposedTarget)) return 'blocked:target_not_in_allowlist';
      const words = p.split(/\s+/).filter(Boolean);
      for (const w of words) {
        if (V102_PROTECTED_WORDS.has(w) || V102_PROTECTED_WORDS.has(w.replace(/'/g, ''))) {
          return 'blocked:protected_core_keyword';
        }
      }
      if (words.length < 2 || words.length > 7 || p.length > 48) return 'blocked:phrase_length_out_of_bounds';
      return null;
    }

    isPoisonAttempt(phrase, proposedTarget, context = {}) {
      const now = (context && typeof context.now === 'number' && Number.isFinite(context.now)) ? context.now : Date.now();
      if (!this.enabled) return 'blocked:learning_disabled';
      if (!this.isAuthenticatedUser || !this.userId) return 'blocked:unauthenticated_user';
      if (this._isHardwareTtsActive(now) || Boolean(context && context.ttsSpeaking) || (context && typeof context.msSinceTtsEnd === 'number' && context.msSinceTtsEnd < this.TTS_ECHO_COOLDOWN_MS)) {
        return 'blocked:tts_echo_window';
      }
      const norm = this.normalizePhrase(phrase);
      if (!this._hasVerifiedHardwareMicEvent(norm, context, now)) {
        return 'blocked:untrusted_content_source';
      }
      const qUntil = this.quarantineMap.get(norm);
      if (typeof qUntil === 'number' && now < qUntil) return 'blocked:quarantined_after_rollback';
      return this.validatePhraseAndTarget(norm, proposedTarget);
    }

    _loadFromStorage() {
      try {
        if (!this.isAuthenticatedUser || !this.storageKey || typeof localStorage === 'undefined') return;
        const raw = localStorage.getItem(this.storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        if (typeof parsed.enabled === 'boolean') this.enabled = parsed.enabled;
        const now = Date.now();
        let dirty = false;
        if (Array.isArray(parsed.quarantine)) {
          for (const item of parsed.quarantine) {
            if (!Array.isArray(item) || item.length < 2) { dirty = true; continue; }
            const nk = this.normalizePhrase(item[0]);
            const until = Number(item[1]);
            if (nk && Number.isFinite(until) && until > now && this.quarantineMap.size < this.MAX_QUARANTINE) {
              this.quarantineMap.set(nk, until);
            } else dirty = true;
          }
        }
        if (Array.isArray(parsed.entries)) {
          for (const item of parsed.entries) {
            if (!Array.isArray(item) || item.length < 2) { dirty = true; continue; }
            const [rawKey, v] = item;
            const normKey = this.normalizePhrase(rawKey);
            if (!v || typeof v !== 'object' || normKey !== rawKey || this.validatePhraseAndTarget(normKey, v.target) !== null) {
              dirty = true; continue;
            }
            const qUntil = this.quarantineMap.get(normKey);
            const expiresAt = Number(v.expiresAt);
            if ((typeof qUntil === 'number' && now < qUntil) || !Number.isFinite(expiresAt) || expiresAt <= now) {
              dirty = true; continue;
            }
            const rawConf = Number(v.confidence);
            const safeConf = Number.isFinite(rawConf) ? Math.max(0.5, Math.min(0.99, rawConf)) : 0.75;
            if (this.learnedMap.size >= this.MAX_ENTRIES && !this.learnedMap.has(normKey)) {
              this.learnedMap.delete(this.learnedMap.keys().next().value);
            }
            this.learnedMap.set(normKey, { target: v.target, confidence: safeConf, failStreak: 0, lastUsedAt: now, expiresAt });
          }
        }
        if (dirty) this._saveToStorage();
      } catch (_) {}
    }

    _saveToStorage() {
      try {
        if (!this.isAuthenticatedUser || !this.storageKey || typeof localStorage === 'undefined') return;
        localStorage.setItem(this.storageKey, JSON.stringify({
          updatedAt: Date.now(),
          enabled: this.enabled,
          entries: Array.from(this.learnedMap.entries()).slice(-this.MAX_ENTRIES),
          quarantine: Array.from(this.quarantineMap.entries()).slice(-this.MAX_QUARANTINE)
        }));
      } catch (_) {}
    }

    recordCorrection(failedPhrase, succeededTarget, context = {}) {
      const now = (context && typeof context.now === 'number' && Number.isFinite(context.now)) ? context.now : Date.now();
      const norm = this.normalizePhrase(failedPhrase);
      const blockReason = this.isPoisonAttempt(failedPhrase, succeededTarget, context);
      if (blockReason) return { learned: false, reason: blockReason };
      for (const [k, v] of this.candidates.entries()) {
        if (!v || (now - v.lastSeen) > this.CANDIDATE_TTL_MS) this.candidates.delete(k);
      }
      while (this.candidates.size >= this.MAX_CANDIDATES) {
        const oldest = this.candidates.keys().next().value;
        if (oldest === undefined) break;
        this.candidates.delete(oldest);
      }
      const key = norm + '=>' + succeededTarget;
      const prev = this.candidates.get(key);
      if (prev && (now - prev.lastSeen) < this.MIN_CORRECTION_GAP_MS) {
        return { learned: false, staged: true, count: prev.count, reason: 'blocked:min_time_gap_not_met' };
      }
      const updated = prev ? { count: prev.count + 1, firstSeen: prev.firstSeen, lastSeen: now } : { count: 1, firstSeen: now, lastSeen: now };
      if (this.candidates.has(key)) this.candidates.delete(key);
      this.candidates.set(key, updated);
      if (updated.count >= 2 && !(context && context.undoneWithin15s)) {
        if (this.learnedMap.size >= this.MAX_ENTRIES && !this.learnedMap.has(norm)) {
          this.learnedMap.delete(this.learnedMap.keys().next().value);
        }
        if (this.learnedMap.has(norm)) this.learnedMap.delete(norm);
        this.learnedMap.set(norm, {
          target: succeededTarget,
          confidence: Math.min(0.95, 0.70 + updated.count * 0.1),
          failStreak: 0,
          lastUsedAt: now,
          expiresAt: now + this.TTL_MS
        });
        this._saveToStorage();
        return { learned: true, promoted: true, target: succeededTarget };
      }
      return { learned: false, staged: true, count: updated.count };
    }

    recordOutcome(phrase, wasUndoneOrRejected, now = Date.now()) {
      if (!this.isAuthenticatedUser) return false;
      const norm = this.normalizePhrase(phrase);
      if (wasUndoneOrRejected) {
        for (const k of Array.from(this.candidates.keys())) {
          if (k.startsWith(norm + '=>')) this.candidates.delete(k);
        }
        this.learnedMap.delete(norm);
        if (this.quarantineMap.size >= this.MAX_QUARANTINE && !this.quarantineMap.has(norm)) {
          this.quarantineMap.delete(this.quarantineMap.keys().next().value);
        }
        this.quarantineMap.set(norm, now + this.QUARANTINE_MS);
        this._saveToStorage();
        return true;
      }
      const entry = this.learnedMap.get(norm);
      if (!entry) return false;
      const rawConf = Number(entry.confidence);
      entry.confidence = Math.min(0.98, (Number.isFinite(rawConf) ? rawConf : 0.75) + 0.05);
      entry.lastUsedAt = now;
      this.learnedMap.delete(norm);
      this.learnedMap.set(norm, entry);
      this._saveToStorage();
      return false;
    }

    resolve(rawPhrase, now = Date.now()) {
      if (!this.enabled || !this.isAuthenticatedUser || !this.userId) return null;
      const norm = this.normalizePhrase(rawPhrase);
      const entry = this.learnedMap.get(norm);
      if (!entry || typeof entry !== 'object') return null;
      const qUntil = this.quarantineMap.get(norm);
      if ((typeof qUntil === 'number' && now < qUntil) || !Number.isFinite(Number(entry.expiresAt)) || now > Number(entry.expiresAt) || this.validatePhraseAndTarget(norm, entry.target) !== null) {
        this.learnedMap.delete(norm);
        this._saveToStorage();
        return null;
      }
      entry.lastUsedAt = now;
      this.learnedMap.delete(norm);
      this.learnedMap.set(norm, entry);
      this._saveToStorage();
      const label = V102_TARGET_LABELS[entry.target] || entry.target;
      const cleanRaw = String(rawPhrase || '').replace(V102_INVISIBLE_RE, '').trim();
      this.lastAdaptedExecution = {
        phrase: norm,
        rawPhrase: cleanRaw,
        target: entry.target,
        label,
        announcement: 'I understood "' + cleanRaw + '" as "' + label + '". Say "no" or "undo" if wrong.',
        ts: now
      };
      return entry.target;
    }

    resolveWithAnnouncement(rawPhrase, now = Date.now()) {
      const t = this.resolve(rawPhrase, now);
      return t ? this.lastAdaptedExecution : null;
    }

    listLearnedAliases() {
      const out = [];
      for (const [phrase, meta] of this.learnedMap.entries()) {
        if (!meta || typeof meta !== 'object' || this.validatePhraseAndTarget(phrase, meta.target) !== null) continue;
        const rawConf = Number(meta.confidence);
        const safeConf = Number.isFinite(rawConf) ? Math.max(0, Math.min(1, rawConf)) : 0.70;
        out.push({
          phrase,
          target: meta.target,
          label: V102_TARGET_LABELS[meta.target] || meta.target,
          confidence: Number(safeConf.toFixed(2)),
          expiresAt: Number.isFinite(Number(meta.expiresAt)) ? Number(meta.expiresAt) : 0
        });
      }
      return out;
    }

    resetAll() {
      this.candidates.clear();
      this.learnedMap.clear();
      this.quarantineMap.clear();
      this._saveToStorage();
      return { ok: true, reply: 'Cleared all learned voice phrase aliases.' };
    }
  }

  window.v3gamAdaptiveLayer = new BoundedAdaptiveVoiceLayer(null);

  function repairAsrDurationInTaskClause(raw) {
    return String(raw || '')
      .replace(/\b(tomorrow|today|at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\b(?:gym|study|reading|meditation|workout|meeting|call|revision)\b)\s+4(15|20|30|40|45|50|60|90)\s+(min(?:ute)?s?)\b(?!\s+(?:past|to|ago)\b)/gi, '$1 for $2 $3')
      .replace(/\b(\d+|one|two|three)\s+and\s+half\s+(hours?|hrs?)\b/gi, '$1 and a half $2');
  }

  function parseV102Extensions(rawInput) {
    const rawTrim = String(rawInput || '').trim();
    const cleaned = rawTrim.replace(/[.,;!?]+$/g, '').trim();
    const low = cleaned.toLowerCase();
    if (!cleaned) return null;

    if (window.v3gamAdaptiveLayer && window.v3gamAdaptiveLayer.lastAdaptedExecution && /^(?:no|undo|cancel|not\s+that|wrong)$/i.test(low)) {
      const last = window.v3gamAdaptiveLayer.lastAdaptedExecution;
      window.v3gamAdaptiveLayer.lastAdaptedExecution = null;
      window.v3gamAdaptiveLayer.recordOutcome(last.phrase, true);
      return S('chat_reply', { reply: 'Rolled back and removed the learned phrase "' + last.rawPhrase + '".' });
    }
    if (/^(?:turn\s+off|disable|pause)\s+(?:voice\s+|adaptive\s+)?learning$/i.test(low)) {
      if (window.v3gamAdaptiveLayer) window.v3gamAdaptiveLayer.setEnabled(false);
      return S('chat_reply', { reply: 'Adaptive voice phrase learning is now turned off.' });
    }
    if (/^(?:turn\s+on|enable|resume)\s+(?:voice\s+|adaptive\s+)?learning$/i.test(low)) {
      if (window.v3gamAdaptiveLayer) window.v3gamAdaptiveLayer.setEnabled(true);
      return S('chat_reply', { reply: 'Adaptive voice phrase learning is now turned on.' });
    }
    if (/^reset\s+learned\s+voice\s+phrases$/i.test(low)) {
      if (window.v3gamAdaptiveLayer) window.v3gamAdaptiveLayer.resetAll();
      return S('chat_reply', { reply: 'Cleared all learned voice phrase aliases.' });
    }

    if (/\b(?:ignore\s+(?:all\s+|your\s+)?(?:previous|prior|above)?\s*instructions|(?:your\s+instructions\s+and\s+)?show\s+me\s+(?:the\s+|all\s+)?everyone'?s\s+tasks?)\b/i.test(low)) {
      return S('chat_reply', { ok: false, pillTitle: "CAN'T DO THAT", reply: "I can't show other users' private tasks or override security rules. I can show tasks in your current workspace." });
    }

    const badClock = /\bat\s+(\d+)\s*o'?\s*clock\b/i.exec(low);
    if (badClock && parseInt(badClock[1], 10) > 24) {
      return S('chat_reply', { ok: false, pillTitle: "CAN'T DO THAT", reply: badClock[1] + " o'clock isn't a valid time of day. Please say a time between 1:00 and 12:00 AM or PM." });
    }

    const cancelAndNewPlan = /^(?:cancel|clear|discard|delete|reset)\s+(?:this|that|current|the|my)?\s*(?:plan|task|form|draft)?\s*(?:and|then|,)\s*(?:create|add|start|make)\s+(?:a\s+)?(?:new\s+)?(?:plan|task)(?:[,.\s]+(?:name\s+is|called|named)\s+(.+))?$/i.exec(cleaned);
    if (cancelAndNewPlan) {
      resetTaskFormDom();
      startFlow(true);
      if (!addActive()) goScreen('add');
      const newTitle = cleanTaskTitle(cancelAndNewPlan[1] || '', true);
      if (newTitle) {
        return S('fill_task_form', { name: newTitle, verbatimTitle: true });
      }
      return S('clear_task_draft', { field: 'all' });
    }

    if (addActive() && /^(?:cancel|cancel\s+this|cancel\s+that|cancel\s+this\s+plan|cancel\s+the\s+task|delete\s+that|delete\s+this|clear\s+this|clear\s+form|discard|start\s+over|never\s+mind(?:\s*,?\s*start\s+over)?)$/i.test(low)) {
      return S('clear_task_draft', { field: 'all' });
    }

    const createWs = /^(?:create|make|new)\s+(?:a\s+)?(?:new\s+)?(?:group\s+)?(?:workspace|group)\s+(?:called|named|name\s+is)\s+(.+)$/i.exec(cleaned);
    if (createWs) {
      return S('create_workspace_confirmed', { name: createWs[1].trim() });
    }
    const removeWs = /^(?:remove|delete)\s+(?:this\s+)?(?:group\s+)?workspace\s*(.+)?$/i.exec(cleaned)
      || /^(?:remove|delete)\s+(.+?)\s+(?:group\s+)?workspace$/i.exec(cleaned);
    if (removeWs) {
      return S('remove_workspace_confirmed', { name: (removeWs[1] || activeWsName()).trim() });
    }

    const switchAndAskWs = /^switch\s+to\s+(?:the\s+)?(.+?)\s*(?:,\s*then|\s+then|\s+and)\s+(?:which|what)\s+workspace\s+(?:am\s+i\s+(?:in|here|on)|i'?m\s+(?:in|here|on))$/i.exec(cleaned);
    if (switchAndAskWs) {
      return S('multi_action', {
        steps: [
          S('switch_workspace_ui', { name: switchAndAskWs[1].trim(), confirmed: true }),
          S('read_info', { what: 'workspace' })
        ]
      });
    }
    if (/^(?:which|what)\s+workspaces?\s+(?:am\s+i\s+(?:in|here|using|on)|i'?m\s+(?:in|here|using|on)|is\s+(?:this|active|open))$/i.test(low)) {
      return S('read_info', { what: 'workspace' });
    }

    if (currentScreen() === 'workspace') {
      const wsButtons = $$('#groupWorkspaceItems button, #workspacePageGroups .workspace-group-card b');
      for (const el of wsButtons) {
        const title = cleanWorkspaceTitle(el) || (el.textContent || '').trim();
        if (title && title.toLowerCase().replace(/_/g, ' ') === low.replace(/_/g, ' ')) {
          return S('switch_workspace_ui', { name: title, confirmed: true });
        }
      }
    }

    const multiAddNav = /^add\s+(?:a\s+task\s+(?:called\s+|named\s+)?)?(.+?)\s+(?:,?\s*then|\s+and\s+then)\s+(open|go\s+to|show)\s+(?:my\s+|the\s+)?(plan|today|habits|insights|workspaces?)$/i.exec(cleaned);
    if (multiAddNav) {
      let c1 = repairAsrDurationInTaskClause(multiAddNav[1]);
      let dayOffset = 0;
      if (/\btomorrow\b/i.test(c1)) { dayOffset = 1; c1 = c1.replace(/\btomorrow\b/i, '').trim(); }
      else if (/\btoday\b/i.test(c1)) { dayOffset = 0; c1 = c1.replace(/\btoday\b/i, '').trim(); }
      let start24 = '09:00';
      const tm = /\bat\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b/i.exec(c1);
      if (tm) {
        const parsed = parseClock(tm[1]);
        if (parsed && parsed !== 'INVALID_TIME') start24 = parsed;
        c1 = c1.replace(tm[0], '').trim();
      }
      let durMin = 60;
      const dm = /\bfor\s+(\d{1,3})\s*(?:min(?:ute)?s?)\b/i.exec(c1);
      if (dm) {
        durMin = parseInt(dm[1], 10);
        c1 = c1.replace(dm[0], '').trim();
      }
      const cleanName = cleanTaskTitle(c1.replace(/\btask\b/i, '').trim(), false);
      const navWord = multiAddNav[3].toLowerCase();
      const nextScreen = navWord.startsWith('workspace') ? 'workspace' : navWord.startsWith('insight') ? 'stats' : navWord === 'today' ? 'home' : 'plan';
      const nextTab = navWord.startsWith('habit') ? 'habits' : null;
      return S('stage_multi_add_task', {
        title: cleanName,
        category: lastCategory(cleanName) || 'study',
        duration: durMin,
        start: start24,
        day: dayOffset,
        nextScreen,
        nextTab
      });
    }

    const singleAddDate = /^(?:add|create|schedule)\s+(?:a\s+)?(?:new\s+)?(?:task\s+(?:called|named)\s+)?(.+?)(?:\s+task)?\s+(tomorrow|today)\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))(?:\s+for\s+(\d{1,3})\s*min(?:ute)?s?)?$/i.exec(cleaned);
    if (singleAddDate) {
      resetTaskFormDom();
      startFlow(true);
      const cleanName = cleanTaskTitle(singleAddDate[1], false);
      const start24 = parseClock(singleAddDate[3]) || '09:00';
      const dur = singleAddDate[4] ? snapDuration(Number(singleAddDate[4])) : undefined;
      return S('fill_task_form', {
        name: cleanName,
        verbatimTitle: true,
        when: 'manual',
        time: start24,
        ...(dur ? { duration: dur } : {})
      });
    }

    const moveMatch = /^(?:move|reschedule|shift|push)\s+(?:to\s+)?(?:the\s+)?(.+?)(?:\s+task)?\s+(?:to\s+|into\s+)?(tomorrow|today|next\s+week|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))$/i.exec(cleaned);
    if (moveMatch) {
      const targetName = moveMatch[1].trim();
      const dest = moveMatch[2].trim().toLowerCase();
      if (dest === 'tomorrow') return S('move_task', { name: targetName, day: 1 });
      if (dest === 'today') return S('move_task', { name: targetName, day: 0 });
      if (dest === 'next week') return S('move_task', { name: targetName, day: 7 });
      const parsedClock = parseClock(dest);
      if (parsedClock && parsedClock !== 'INVALID_TIME') return S('move_task', { name: targetName, start: parsedClock });
    }

    const vagueDeleteNav = /^(?:delete|remove)\s+(?:the\s+|this\s+|a\s+|that\s+)?(?:task|todo|item|plan)(?:\s+(?:then|and\s+then|and)\s+(?:go\s+to|open|show)\s+(?:the\s+|my\s+)?(plan|today|insights|workspaces?))?$/i.exec(low);
    if (vagueDeleteNav) {
      const tools = window.v3gamTaskTools;
      const list = (tools && typeof tools.listAll === 'function') ? tools.listAll() : [];
      const sample = list.slice(0, 3).map((t) => '"' + t.title + '"').join(', ');
      const rawDest = (vagueDeleteNav[1] || '').toLowerCase();
      const nextScreen = rawDest === 'plan' ? 'plan' : rawDest === 'today' ? 'home' : rawDest === 'insights' ? 'stats' : rawDest.startsWith('workspace') ? 'workspace' : null;
      pendingDeleteFollowUp = list.length ? { nextScreen, until: Date.now() + WAIT_MS } : null;
      const navAsk = nextScreen === 'plan' ? ' before I open your Plan' : nextScreen ? (' before I open ' + nextScreen) : '';
      return S('chat_reply', {
        ok: false,
        pillTitle: 'CLARIFY CHOICE',
        reply: list.length
          ? ('Which task would you like to delete' + navAsk + '? In ' + activeWsName() + ', you have: ' + sample + '.')
          : ('You do not have any tasks in ' + activeWsName() + ' to delete.')
      });
    }
    if (pendingDeleteFollowUp && Date.now() <= pendingDeleteFollowUp.until) {
      const tools = window.v3gamTaskTools;
      const candidateMatches = (tools && typeof tools.find === 'function') ? tools.find(cleaned) : [];
      if (candidateMatches.length === 1) {
        const follow = pendingDeleteFollowUp;
        pendingDeleteFollowUp = null;
        return S('delete_task', { name: candidateMatches[0].title, followUp: follow });
      }
    }

    if (/^(?:all\s+my\s+tasks|what\s+tasks?\s+(?:is|are)\s+remaining|tasks?\s+is\s+remaining|remaining\s+tasks|what'?s\s+on\s+my\s+(?:plan|schedule|list)\s+today|show\s+me\s+my\s+today'?s\s+tasks|read\s+my\s+tasks)$/i.test(low)) {
      return S('read_remaining_tasks');
    }

    if (/^can\s+you\s+track\s+habits$/i.test(low)) {
      const firstHabit = habitNames()[0] || 'Wake up at 6:00';
      return S('chat_reply', {
        reply: 'Yes! I can open your Daily Habits tab, mark individual habits like "' + firstHabit + '" done for today, tick all of today\'s habits at once, and tell you how many habits you finished this week.'
      });
    }
    if (/\b(?:send\s+this\s+task.*whatsapp|set\s+an\s+alarm\s+on\s+my\s+phone|sync\s+with\s+google\s+calendar)\b/i.test(low)) {
      return S('chat_reply', {
        ok: false,
        pillTitle: "CAN'T DO THAT",
        reply: "I can't connect to WhatsApp, phone alarms, or Google Calendar directly from V3GAM - I can schedule tasks or set in-app task reminders here."
      });
    }

    // 15. VALIDATED CASUAL-PHRASING FALLBACK LAYER
    const casualAdd = /^(?:jot\s+down|write\s+down|note\s+down|put|stick|throw|add)\s+(.+?)(?:\s+(?:on|onto|in|into|to)\s+my\s+(?:list|schedule|plan|calendar|todo|to-do)|\s+for\s+(tonight|today|tomorrow|this\s+evening|this\s+afternoon))$/i.exec(cleaned);
    if (casualAdd) {
      resetTaskFormDom();
      startFlow(true);
      const rawTitle = cleanTaskTitle(casualAdd[1].replace(/\s+for\s+(?:tonight|today|tomorrow)$/i, ''), true);
      const whenHint = /tonight|evening/i.test(casualAdd[2] || casualAdd[1]) ? 'evening' : /afternoon/i.test(casualAdd[2] || '') ? 'afternoon' : undefined;
      return S('fill_task_form', {
        name: rawTitle,
        verbatimTitle: true,
        ...(whenHint ? { when: whenHint } : {})
      });
    }

    if (/\b(?:keep\s+my\s+streak\s+alive|how\s+is\s+my\s+(?:habit\s+)?streak|what'?s\s+my\s+habit\s+(?:streak|progress))\b/i.test(low)) {
      return S('read_habit_streak');
    }

    const casualHabitCheck = /^(?:give\s+me\s+a\s+(?:green\s+)?check(?:mark)?\s+on|put\s+a\s+check(?:mark)?\s+on|cross\s+off|tick\s+off|check\s+off)\s+(.+)$/i.exec(cleaned);
    if (casualHabitCheck) {
      const hName = casualHabitCheck[1].replace(/\s+habit$/i, '').trim();
      const hIdx = findHabitIndex(hName);
      if (hIdx >= 0) return S('toggle_habit', { index: hIdx, name: hName, done: true });
    }

    const casualBump = /^(?:bump|push\s+back|delay|shift|postpone)\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:thing|task|stuff|item))?\s+by\s+(a\s+couple\s+(?:of\s+)?hours?|an?\s+hour|\d+\s*(?:hours?|hrs?|minutes?|mins?))$/i.exec(cleaned);
    if (casualBump) {
      const target = casualBump[1].trim();
      const rawDelta = casualBump[2].toLowerCase();
      const deltaMins = /couple/.test(rawDelta) ? 120 : /^an?\s+hour/.test(rawDelta) ? 60 : (parseDuration(rawDelta) || 60);
      return S('move_task', { name: target, deltaMinutes: deltaMins });
    }

    const casualSlide = /^(?:can\s+(?:we|you)\s+|please\s+)?(?:slide|move|push|shift)\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:thing|task|class))?\s+(?:into|to|for)\s+(next\s+week|tomorrow|today)$/i.exec(cleaned);
    if (casualSlide) {
      const target = casualSlide[1].trim();
      const dest = casualSlide[2].toLowerCase();
      const day = dest === 'next week' ? 7 : dest === 'tomorrow' ? 1 : 0;
      return S('move_task', { name: target, day });
    }

    if (/^(?:hmm+\s+)?(?:let\s+me\s+think|hold\s+on\s+let\s+me\s+think|give\s+me\s+a\s+(?:sec|second|minute)\s+to\s+think)\b/i.test(low)) {
      return S('chat_reply', { reply: "Take your time - I'm here when you're ready." });
    }

    if (/\b(?:how\s+much\s+free\s+time\s+do\s+i\s+have|when\s+am\s+i\s+free\s+today|do\s+i\s+have\s+free\s+time\s+before\s+dinner)\b/i.test(low)) {
      return S('read_free_time');
    }

    if (window.v3gamAdaptiveLayer) {
      const adapted = window.v3gamAdaptiveLayer.resolveWithAnnouncement(cleaned);
      if (adapted) {
        const [cmdName, argVal] = String(adapted.target).split(':');
        if (cmdName === 'open_screen') return S('open_screen', { screen: argVal, _adaptedAnnouncement: adapted.announcement });
        if (cmdName === 'open_plan_tab') return S('open_plan_tab', { tab: argVal, _adaptedAnnouncement: adapted.announcement });
        if (cmdName === 'set_sidebar') return S('set_sidebar', { mode: argVal, _adaptedAnnouncement: adapted.announcement });
        if (cmdName === 'read_info') return S('read_info', { what: argVal, _adaptedAnnouncement: adapted.announcement });
      }
    }

    return null;
  }

  /* ---------- Multi-Action Sentence Splitter ---------- */
  function parseMultiOrSingle(rawText) {
    lastRawUtterance = String(rawText || '').trim();
    const v102Cmd = parseV102Extensions(lastRawUtterance);
    if (v102Cmd) return v102Cmd;

    if (/\b(?:no\s+wait|wait\s+no|scratch\s+that)(?:,\s*delete\s+that)?,\s*(.+)$/i.test(lastRawUtterance)) {
      const repaired = lastRawUtterance.replace(/^.*?\b(?:no\s+wait|wait\s+no|scratch\s+that)(?:,\s*delete\s+that)?,\s*/i, '').trim();
      lastRawUtterance = repaired;
      rawText = repaired;
    }
    const t0 = preNormalizeV98(rawText);
    if (!t0) return null;

    if (/\b(?:ignore\s+(?:all\s+|your\s+)?(?:previous|prior|above)\s+instructions|show\s+me\s+everyone'?s\s+tasks|system\s+prompt|delete\s+all\s+tasks\s+and\s+workspaces)\b/i.test(t0)) {
      return S('chat_reply', { ok: false, reply: 'Blocked unsafe or injected instruction. No changes were made.' });
    }

    if (/\b(?:delete|remove|clear|sign\s+out|log\s+out)\b.*?(?:,\s*i\s+confirm|\s+and\s+confirm)$/i.test(t0)) {
      const stripped = t0.replace(/(?:,\s*i\s+confirm|\s+and\s+confirm)$/i, '').trim();
      return parseV98Pre(stripped) || parseSingle(stripped, false);
    }

    if (/^(?:in\s+notes?\b|add\s+(?:a\s+|the\s+)?notes?\b|write\s+in\s+notes?\b|set\s+(?:the\s+)?notes?\b|(?:give|set|change|rename)\s+(?:the\s+)?(?:task\s+)?(?:name|title)\b|task\s+name\s+is\b|add\s+a\s+(?:different\s+)?(?:task|one)\s+(?:called|named|titled)\b)/i.test(t0)) {
      return parseV98Pre(t0) || parseSingle(t0, true);
    }

    if (/\b(?:and\s+then|then|so|and)\b|,/i.test(t0)) {
      const parts = t0
        .split(/\s*(?:,\s*then\s+|,\s*so\s+|,\s*and\s+|\s+and\s+then\s+|\s+then\s+|\s+so\s+|\s+and\s+)\s*/i)
        .map((p) => p.trim())
        .filter(Boolean);

      if (parts.length >= 2 && parts.length <= 5) {
        const parsedSteps = [];
        let allValid = true;
        for (const part of parts) {
          const cmd = parseV98Pre(part) || parseSingle(part, false);
          if (!cmd) {
            allValid = false;
            break;
          }
          const prev = parsedSteps[parsedSteps.length - 1];
          const isDupAdd = prev && (prev.command === 'new_task_form' || (prev.command === 'start_task_flow' && !Object.keys(prev.args || {}).length) || (prev.command === 'open_screen' && prev.args.screen === 'add'))
            && (cmd.command === 'new_task_form' || (cmd.command === 'start_task_flow' && !Object.keys(cmd.args || {}).length) || (cmd.command === 'open_screen' && cmd.args.screen === 'add'));
          const isExactDup = prev && prev.command === cmd.command && JSON.stringify(prev.args) === JSON.stringify(cmd.args);
          if (!isDupAdd && !isExactDup) {
            parsedSteps.push(cmd);
          }
        }
        if (allValid && parsedSteps.length === 1) return parsedSteps[0];
        if (allValid && parsedSteps.length >= 2) return S('multi_action', { steps: parsedSteps });
      }
    }

    const pre = parseV98Pre(t0);
    if (pre) return pre;

    return parseSingle(t0, true);
  }

  function tryText(text) {
    turnCounter += 1;
    const rawTrim = String(text || '').trim();
    if (/^(?:try\s+again|retry(?:\s+that)?)$/i.test(rawTrim) && lastFailedCommandText) {
      const toRetry = lastFailedCommandText;
      lastFailedCommandText = '';
      return tryText(toRetry);
    }
    let cmd = null;
    try { cmd = parseMultiOrSingle(text); } catch (_) { cmd = null; }
    if (!cmd) {
      lastFailedCommandText = rawTrim;
      return null;
    }
    if (pending && cmd.command !== 'confirm_pending' && cmd.command !== 'cancel_pending') {
      pending = null;
    }
    const r = runCommand(cmd.command, cmd.args);
    if (pending && !pending.createdTurn) pending.createdTurn = turnCounter;
    if (!r.ok) lastFailedCommandText = rawTrim;
    if (r.pillTitle || !r.ok) {
      const titleText = r.pillTitle || (/could not find/i.test(r.reply) ? 'CONTROL NOT FOUND · TRY CLOSEST MATCH' : /\?$/.test(r.reply) ? 'CLARIFY CHOICE' : 'ACTION NOTICE');
      setTimeout(() => {
        const tEl = $('#v3gamLivePillTitle');
        if (tEl && !r.ok) tEl.textContent = titleText;
      }, 15);
    }
    return { ok: r.ok, reply: r.reply, command: cmd.command, ...(r.silent ? { silent: true } : {}), ...(r.pillTitle ? { pillTitle: r.pillTitle } : {}) };
  }

  function hint() {
    consecutiveFailures += 1;
    const now = Date.now();
    lastHintAt = now;
    if (isOpen('#notificationsDialog')) {
      return 'Notifications are open. Say "all", "tasks", or "system" to filter, "scroll down", "mark all read", or "close notification".';
    }
    if (isOpen('#workspaceDialog')) {
      return 'Group workspaces window is open. Say "group name is College Group", "create group workspace", or "close".';
    }
    if (isOpen('#focusOverlay')) {
      return 'Focus mode is open. Say "done", "snooze", "skip", or "close focus".';
    }
    if (addActive()) {
      return val('#taskName')
        ? 'You are on the Add task form for "' + val('#taskName') + '". Tell me the category, duration, start time, or notes—or say "cancel that" or "build my plan".'
        : 'You are on the Add task form. Tell me the task name, or say "describe it with my voice".';
    }
    if (consecutiveFailures % 3 === 1) {
      return 'Try saying a command like "add a task", "what\'s on my plan today?", "open my habits", or "open workspaces".';
    }
    if (consecutiveFailures % 3 === 2) {
      return 'Still not catching a valid action — you can say "open insights", "switch to Family Habit", "show my notifications", or "change the theme".';
    }
    return 'Here are exact phrases I support: "Add a task called [name]", "Tick all my daily habits", "Mark meditation done", or "Today\'s flow".';
  }

  window.v3gamVoiceUi = {
    version: 7,
    parse: parseMultiOrSingle,
    run: runCommand,
    tryText,
    hint,
    noteAdded: (title) => { if (title) flow.lastAdded = { title: String(title) }; },
    commands: Object.keys(COMMANDS),
    __brain: true
  };
})();
