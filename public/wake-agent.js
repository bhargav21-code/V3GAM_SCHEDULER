(() => {
  'use strict';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let active = false;
  let rec = null;
  let restartTimer = null;
  let interimCommitTimer = null;
  let pendingInterim = '';
  let processing = false;
  let speaking = false;
  let lastSpokenReply = '';
  let lastSpokenAt = 0;
  let lastTranscript = '';
  let lastTranscriptAt = 0;

  function injectStyles() {
    if (document.getElementById('v3gamLiveAgentStyles')) return;
    const style = document.createElement('style');
    style.id = 'v3gamLiveAgentStyles';
    style.textContent = `
      /* Floating V3GAM Live Agent Orb — positioned above modals so feedback is always visible */
      #v3gamLiveOrbDock {
        position: fixed;
        right: 18px;
        bottom: 84px;
        z-index: 10050;
        display: none;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
        font-family: 'DM Sans', sans-serif;
        pointer-events: none;
      }
      #v3gamLiveOrbDock.visible {
        display: flex;
      }
      #v3gamLiveTranscriptPill {
        max-width: 280px;
        padding: 8px 12px;
        border-radius: 13px;
        background: rgba(16, 20, 32, 0.95);
        border: 1px solid rgba(137, 120, 255, 0.48);
        color: #f4f5ff;
        font-size: 11px;
        line-height: 1.42;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45), 0 0 18px rgba(137, 120, 255, 0.24);
        backdrop-filter: blur(12px);
        opacity: 0;
        transform: translateY(6px);
        transition: opacity 0.22s ease, transform 0.22s ease, border-color 0.22s ease;
        pointer-events: auto;
      }
      #v3gamLiveTranscriptPill.show {
        opacity: 1;
        transform: translateY(0);
      }
      #v3gamLiveTranscriptPill.is-warn {
        border-color: rgba(245, 204, 114, 0.72);
      }
      #v3gamLiveTranscriptPill.is-warn b {
        color: #f5cc72;
      }
      #v3gamLiveTranscriptPill b {
        display: block;
        font-size: 9px;
        letter-spacing: 1.1px;
        text-transform: uppercase;
        color: #7cdbb6;
        margin-bottom: 3px;
      }
      #v3gamLiveOrbBtn {
        pointer-events: auto;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        min-height: 46px;
        padding: 6px 15px 6px 8px;
        border-radius: 999px;
        border: 1px solid rgba(137, 120, 255, 0.42);
        background: linear-gradient(135deg, rgba(24, 28, 44, 0.96), rgba(15, 18, 30, 0.96));
        color: #f4f5ff;
        font: 700 12px 'Manrope', 'DM Sans', sans-serif;
        letter-spacing: 0.2px;
        box-shadow: 0 14px 34px rgba(10, 12, 24, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.08) inset;
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.25s ease, border-color 0.25s ease, background 0.25s ease;
      }
      #v3gamLiveOrbBtn:hover {
        transform: translateY(-2px) scale(1.02);
        border-color: rgba(124, 219, 182, 0.7);
        box-shadow: 0 18px 40px rgba(10, 12, 24, 0.55), 0 0 24px rgba(137, 120, 255, 0.38);
      }
      .v3gam-orb-sphere {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: radial-gradient(circle at 30% 30%, #b7abff 0%, #8978ff 45%, #7cdbb6 100%);
        display: grid;
        place-items: center;
        color: #0e1320;
        font-size: 15px;
        font-weight: 900;
        box-shadow: 0 0 16px rgba(137, 120, 255, 0.6);
        position: relative;
        flex: none;
      }
      #v3gamLiveOrbBtn.is-active {
        border-color: #7cdbb6;
        background: linear-gradient(135deg, #1d2b2a, #171f36);
        box-shadow: 0 0 0 4px rgba(124, 219, 182, 0.22), 0 0 34px rgba(137, 120, 255, 0.55), 0 16px 38px rgba(0, 0, 0, 0.5);
      }
      #v3gamLiveOrbBtn.is-active .v3gam-orb-sphere {
        animation: v3gamOrbSpinPulse 1.8s infinite ease-in-out;
        box-shadow: 0 0 24px #7cdbb6, 0 0 42px #8978ff;
      }
      .v3gam-orb-copy {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        line-height: 1.2;
        text-align: left;
      }
      .v3gam-orb-copy strong {
        font-size: 11.5px;
        color: #fff;
      }
      .v3gam-orb-copy small {
        font-size: 9.5px;
        color: #a8b3cf;
        font-weight: 600;
      }
      #v3gamLiveOrbBtn.is-active .v3gam-orb-copy small {
        color: #7cdbb6;
      }
      @keyframes v3gamOrbSpinPulse {
        0%, 100% { transform: scale(1); filter: hue-rotate(0deg); }
        50% { transform: scale(1.12); filter: hue-rotate(25deg); }
      }
      #v3gamCenterWaveBackdrop {
        position: fixed;
        inset: 0;
        z-index: 1200;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.4s ease;
        background: radial-gradient(circle at 50% 50%, rgba(137, 120, 255, 0.14) 0%, rgba(124, 219, 182, 0.08) 42%, rgba(137, 120, 255, 0.18) 100%);
      }
      body.v3gam-live-agent-on #v3gamCenterWaveBackdrop {
        opacity: 1;
        animation: v3gamCenterToEndWave 3.2s infinite ease-out;
      }
      @keyframes v3gamCenterToEndWave {
        0%, 100% {
          box-shadow: inset 0 0 25px rgba(137, 120, 255, 0.35), inset 0 0 60px rgba(124, 219, 182, 0.18);
          transform: scale(0.985);
        }
        50% {
          box-shadow: inset 0 0 65px rgba(137, 120, 255, 0.55), inset 0 0 140px rgba(124, 219, 182, 0.32);
          transform: scale(1);
        }
      }
      body.v3gam-live-agent-on .workspace-bar,
      body.v3gam-live-agent-on .nav,
      body.v3gam-live-agent-on .metric-card,
      body.v3gam-live-agent-on .soft-card,
      body.v3gam-live-agent-on .sumcard,
      body.v3gam-live-agent-on .task,
      body.v3gam-live-agent-on .monthcard,
      body.v3gam-live-agent-on .chartcard,
      body.v3gam-live-agent-on .formcard,
      body.v3gam-live-agent-on .workspace-page-card,
      body.v3gam-live-agent-on .workspace-group-card,
      body.v3gam-live-agent-on #agentBtn.mic {
        border-color: rgba(137, 120, 255, 0.55) !important;
        box-shadow: 0 0 22px rgba(137, 120, 255, 0.24), 0 0 38px rgba(124, 219, 182, 0.14), inset 0 0 14px rgba(137, 120, 255, 0.10) !important;
        transition: box-shadow 0.45s ease, border-color 0.45s ease !important;
      }
    `;
    document.head.appendChild(style);
  }

  function sanitizeSpokenText(raw) {
    return String(raw || '')
      .replace(/(?:同时调用工具函数|调用工具|工具调用)[:：\s]*/g, ' ')
      .replace(/\{[^{}]*"(?:action|command|element|tool|target)"[^{}]*\}/g, ' ')
      .replace(/[\u4e00-\u9fff]+/g, ' ')
      .replace(/\b(?:left|right|up|down)?\s*arrow(?:\s+curving\s+(?:left|right|up|down))?\b/gi, ' ')
      .replace(/\b(?:Owner|Member)\s*\d+\s*members?\s*Invite\s*[0-9A-Fa-f]{8,}\b/gi, ' ')
      .replace(/\bInvite\s*:?\s*[0-9A-Fa-f]{12,}\b/gi, ' ')
      .replace(/\bv\s?3\s?gam\b/gi, 'Vegam')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function createFloatingUi() {
    if (document.getElementById('v3gamLiveOrbDock')) return;
    injectStyles();

    const wave = document.createElement('div');
    wave.id = 'v3gamCenterWaveBackdrop';
    wave.setAttribute('aria-hidden', 'true');
    document.body.appendChild(wave);

    const dock = document.createElement('div');
    dock.id = 'v3gamLiveOrbDock';
    dock.innerHTML = `
      <div id="v3gamLiveTranscriptPill" role="status" aria-live="polite">
        <b id="v3gamLivePillTitle">V3GAM LIVE AGENT</b>
        <span id="v3gamLivePillText">Listening continuously… speak any task or command.</span>
      </div>
      <button type="button" id="v3gamLiveOrbBtn" aria-pressed="false" title="Toggle Always-On V3GAM Voice Agent">
        <span class="v3gam-orb-sphere" aria-hidden="true">✦</span>
        <span class="v3gam-orb-copy">
          <strong id="v3gamLiveOrbTitle">V3GAM Voice Agent</strong>
          <small id="v3gamLiveOrbSub">Tap to enable live voice</small>
        </span>
      </button>
    `;
    document.body.appendChild(dock);

    const btn = document.getElementById('v3gamLiveOrbBtn');
    btn.addEventListener('click', () => {
      if (active) {
        stopLiveAgent('Live agent turned off manually');
      } else {
        startLiveAgent();
      }
    });

    // Make sure clicking "Notifications" inside the Settings dropdown opens the Notifications modal
    document.addEventListener('click', (e) => {
      const barNotify = e.target && e.target.closest && e.target.closest('#barNotify');
      if (barNotify) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const sm = document.getElementById('settingsMenu');
        if (sm) sm.hidden = true;
        const st = document.getElementById('settingsToggle');
        if (st) st.setAttribute('aria-expanded', 'false');
        const openBtn = document.getElementById('openNotifications');
        if (openBtn) openBtn.click();
      }
    }, true);
  }

  function showPill(title, text, autoHideMs = 0, isWarn = false) {
    const pill = document.getElementById('v3gamLiveTranscriptPill');
    const tEl = document.getElementById('v3gamLivePillTitle');
    const bEl = document.getElementById('v3gamLivePillText');
    if (!pill || !tEl || !bEl) return;
    tEl.textContent = title;
    bEl.textContent = sanitizeSpokenText(text) || text;
    pill.classList.toggle('is-warn', !!isWarn);
    pill.classList.add('show');
    if (autoHideMs > 0) {
      setTimeout(() => {
        if (!active) pill.classList.remove('show');
      }, autoHideMs);
    }
  }

  function updateOrbVisualState(subText) {
    const btn = document.getElementById('v3gamLiveOrbBtn');
    const title = document.getElementById('v3gamLiveOrbTitle');
    const sub = document.getElementById('v3gamLiveOrbSub');
    document.body.classList.toggle('v3gam-live-agent-on', active);
    if (!btn || !title || !sub) return;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
    title.textContent = active ? 'V3GAM Live · ON' : 'V3GAM Voice Agent';
    sub.textContent = subText || (active ? 'Always listening · Tap to turn off' : 'Tap to enable live voice');
  }

  function cleanWakePrefix(raw) {
    const original = String(raw || '').trim();
    let stripped = original
      .replace(/^(?:hey|hi|hello|okay|ok|wake up)?\s*(?:v3gam|vegam|vee gam|vagam|wegam|wegom|vegan|begam|begum|bigam|vigam|orbit)[,:.\s-]*/i, '')
      .replace(/[,.\s]+(?:v3gam|vegam|vee gam|vagam|wegam|wegom|vegan|begam|begum|bigam|vigam|orbit|buddy|bro)[.!?]*$/i, '')
      .trim();
    if (!stripped && /^(?:hey|hi|hello|hlo|yo|namaste)\b/i.test(original)) {
      return 'hi';
    }
    return stripped || original;
  }

  // Only filter true hardware speaker bleed within 1.4s of TTS ending when it matches a long assistant prompt
  function isEchoOfAssistantSpeech(transcript) {
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const t = norm(transcript);
    if (!t) return true;
    if (/^(hey buddy i m right here|hii buddy v3gam live is on|hi buddy vegam live is on)/i.test(t)) {
      return true;
    }
    // Never treat a short command or an invited confirmation phrase as an echo
    if (/^(?:yes|no|confirm|build my plan|press build my plan|try again|cancel that|undo that)$/i.test(t)) return false;
    if (/^(?:say confirm to save|say yes to confirm or no to cancel|what would you like to name this task|task delete all tasks scheduled at)/i.test(t)) return true;
    const tWords = t.split(' ').filter(Boolean);
    if (tWords.length <= 3) return false;
    if (!lastSpokenReply || Date.now() - lastSpokenAt > 4500) return false;
    const spoken = norm(lastSpokenReply);
    if (!spoken) return false;
    if (spoken === t) return true;
    if (tWords.length >= 4 && t.length >= 22 && spoken.includes(t)) return true;
    const sigWords = tWords.filter(w => w.length > 2);
    if (sigWords.length >= 5) {
      const matched = sigWords.filter(w => spoken.includes(w)).length;
      if (matched / sigWords.length >= 0.85) return true;
    }
    return false;
  }

  const TAB_ID = 'v3gam_tab_' + Math.random().toString(36).slice(2, 10);
  let leaderChannel = null;
  let cmdTimestamps = [];
  let restartTimestamps = [];
  let pendingPrefixCarry = '';
  let pendingPrefixAt = 0;
  try {
    if ('BroadcastChannel' in window) {
      leaderChannel = new BroadcastChannel('v3gam_voice_leader');
      leaderChannel.onmessage = (ev) => {
        if (ev && ev.data && ev.data.type === 'CLAIM_LEADER' && ev.data.tabId !== TAB_ID && active) {
          stopLiveAgent('Paused because voice agent was activated in another tab.');
        }
      };
    }
  } catch (_) {}
  if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      if (active) {
        showPill('AUDIO DEVICE CHANGED', 'Audio device changed — switched to active microphone. Please repeat your last command if needed.', 4000, true);
        scheduleRestart(300);
      }
    });
  }

  const FAST_COMMANDS = new Set([
    'stop_speaking', 'set_theme', 'set_sidebar', 'open_screen', 'open_plan_tab',
    'settings_menu', 'notifications', 'mark_notifications_read', 'assistant_panel',
    'calendar_week', 'workspace_menu', 'workspace_dialog', 'focus_mode',
    'close_current', 'scroll_page', 'voice_settings', 'demo_mode', 'read_info',
    'list_capabilities', 'build_task_plan', 'confirm_task', 'confirm_pending',
    'cancel_pending', 'go_back', 'toggle_all_habits', 'toggle_habit',
    'show_todays_flow', 'clear_task_draft', 'ask_catdur_change',
    'flow_keep', 'flow_reject'
  ]);

  function isConfidentLocal(text) {
    try {
      const u = window.v3gamVoiceUi;
      const r = u && u.parse ? u.parse(text) : null;
      return !!r && FAST_COMMANDS.has(r.command);
    } catch (_) { return false; }
  }

  function isIncompleteHalfSentence(text) {
    const t = String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return true;
    // Allow single-word valid answers like "90", "60", "yes", "no", "lab", "meal", "stop", "back", "change", "keep", "plan", "today"
    if (isConfidentLocal(t)) return false;
    try {
      const u = window.v3gamVoiceUi;
      if (u && u.parse && u.parse(t)) return false;
    } catch (_) {}
    if (/^(the|a|an|to|on|in|for|at|by|with|from|of|and|or|but|so|then|please|can|could|would|will|i|we|you|it|this|that|my|click|click on|click the|click on the|open|open the|go|go to|switch|switch to|set|set the|change the|add a|create a|fill|select|choose|make|turn|turn on|turn off|add a task called|add a task named|change the duration to)$/i.test(t)) {
      return true;
    }
    if (/^(?:click|tap|press|open|go to|switch to|navigate to|set|change|select|choose|fill|enter|type)\s+(?:on\s+|to\s+|in\s+)?(?:the|a|an|my|this|that)$/i.test(t)) {
      return true;
    }
    return false;
  }

  async function executeVoiceTranscript(transcript) {
    clearTimeout(interimCommitTimer);
    pendingInterim = '';
    consumeResults();

    let rawTrimmed = String(transcript || '').trim();
    if (pendingPrefixCarry && (Date.now() - pendingPrefixAt < 6500)) {
      rawTrimmed = (pendingPrefixCarry + ' ' + rawTrimmed).trim();
      pendingPrefixCarry = '';
    }
    if (/^(?:stop|quiet|shut up|silence|pause|cancel speech|stop speaking|stop talking)$/i.test(rawTrimmed)) {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      speaking = false;
      const st = (document.querySelector('#screen-add.active') && document.querySelector('#taskName') && document.querySelector('#taskName').value)
        ? ('Stopped. You are on the Add Task screen with unsaved draft "' + document.querySelector('#taskName').value + '".')
        : 'Stopped speaking. Listening for your next command.';
      showPill('V3GAM LIVE · READY', st);
      scheduleRestart(120);
      return;
    }

    if (speaking) {
      if (!isEchoOfAssistantSpeech(rawTrimmed)) {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        speaking = false;
      } else {
        return;
      }
    }

    const cleaned = cleanWakePrefix(rawTrimmed);
    if (!cleaned) {
      showPill('V3GAM LIVE · LISTENING', 'Hey buddy! What’s the plan today?');
      if (window.v3gamLiveAgent) window.v3gamLiveAgent.speak("Hey buddy, what's the plan today?");
      return;
    }

    if (isEchoOfAssistantSpeech(cleaned)) {
      showPill('V3GAM LIVE · LISTENING', 'Listening continuously… speak any command.');
      return;
    }

    const now = Date.now();
    cmdTimestamps = cmdTimestamps.filter(ts => now - ts < 10000);
    if (cmdTimestamps.length >= 20) {
      showPill('RATE LIMIT · SLOW DOWN', 'Too many voice commands in a short burst. Please wait a few seconds.', 3500, true);
      return;
    }
    cmdTimestamps.push(now);

    if (cleaned.toLowerCase() === lastTranscript.toLowerCase() && now - lastTranscriptAt < 1800 && !/^undo\b/i.test(cleaned)) {
      return;
    }
    lastTranscript = cleaned;
    lastTranscriptAt = now;

    if (/^(stop listening|turn off voice|turn off voice agent|go to sleep vegam|sleep vegam|disable voice agent|stop voice agent)$/i.test(cleaned)) {
      stopLiveAgent('Voice agent turned off. Tap the V3GAM Voice button anytime to turn it back on.');
      if (window.v3gamLiveAgent) window.v3gamLiveAgent.speak('Voice agent turned off.');
      return;
    }

    if (isIncompleteHalfSentence(cleaned)) {
      const msg = `I heard "${cleaned}", which sounds unfinished. Keep going, I am still listening.`;
      showPill('SAY AGAIN · INCOMPLETE', msg, 0, true);
      if (rec) { rec._base = rec._prevBase || 0; }
      pendingPrefixCarry = cleaned;
      pendingPrefixAt = Date.now();
      pendingInterim = '';
      return;
    }

    processing = true;
    updateOrbVisualState('Performing on live screen…');
    showPill('HEARD YOU', '“' + cleaned + '” — executing now…');

    try {
      if (window.v3gamLiveAgent && typeof window.v3gamLiveAgent.runLiveCommand === 'function') {
        const result = await window.v3gamLiveAgent.runLiveCommand(cleaned);
        if (result && result.silent) {
          showPill('V3GAM LIVE · READY', 'Stopped speaking. Listening for your next command.');
        } else if (result && result.ok === false) {
          const replyText = sanitizeSpokenText(result.reply) || ('Could not execute “' + cleaned + '”. Please say again.');
          const errHeader = result.pillTitle
            || (/could not find|couldn't find/i.test(replyText) ? 'CONTROL NOT FOUND - TRY CLOSER MATCH'
              : /\b(?:i can't|cannot|not supported|don't have permission|isn't a valid time|too long for a single|blocked unsafe|can't be negative)\b/i.test(replyText) ? "CAN'T DO THAT"
                : /\?$/.test(replyText) ? 'CLARIFY CHOICE'
                  : 'DID NOT CATCH THAT - SAY AGAIN');
          showPill(errHeader, replyText, 0, true);
        } else {
          const summary = (result && result.reply) ? sanitizeSpokenText(result.reply) : ('Done: “' + cleaned + '”');
          showPill((result && result.pillTitle) || 'V3GAM LIVE · DONE', summary);
        }
      }
    } catch (e) {
      showPill('V3GAM LIVE · RETRY', 'I couldn’t complete “' + cleaned + '”. Please say that again.', 0, true);
    } finally {
      processing = false;
      updateOrbVisualState('Always listening · Tap to turn off');
      scheduleRestart(150);
    }
  }

  function scheduleRestart(delayMs = 300) {
    clearTimeout(restartTimer);
    if (!active) return;
    restartTimer = setTimeout(() => {
      if (active && !processing && !ttsBusy() && !document.hidden) {
        beginRecognitionLoop();
      } else if (active && ttsBusy()) {
        scheduleRestart(300);
      }
    }, delayMs);
  }

  function ttsBusy() {
    if (speaking && Date.now() - lastSpokenAt > 9000) {
      speaking = false;
    }
    return speaking || !!(window.speechSynthesis && window.speechSynthesis.speaking);
  }

  function consumeResults() {
    if (rec) { rec._prevBase = rec._base || 0; rec._base = rec._len || 0; }
  }

  function handleSpeechResult(instance, event) {
    instance._len = event.results.length;
    if (!active || processing) { instance._base = event.results.length; return; }
    let full = '';
    let allFinal = true;
    let minConf = 1;
    for (let i = instance._base || 0; i < event.results.length; i++) {
      const res = event.results[i];
      const t = String((res[0] && res[0].transcript) || '').trim();
      if (!t) continue;
      if (res.isFinal && typeof res[0].confidence === 'number' && res[0].confidence > 0) {
        minConf = Math.min(minConf, res[0].confidence);
      }
      full += (full ? ' ' : '') + t;
      if (!res.isFinal) allFinal = false;
    }
    if (!full) return;
    if (ttsBusy()) {
      if (!isEchoOfAssistantSpeech(full)) {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        speaking = false;
      } else {
        instance._base = event.results.length;
        return;
      }
    }
    if (allFinal && minConf < 0.35 && full.split(/\s+/).length <= 3 && !isConfidentLocal(full)) {
      instance._base = event.results.length;
      showPill('LOW AUDIO · SPEAK LOUDER', "I couldn't hear that clearly — please speak a little louder or closer to your microphone.", 3500, true);
      return;
    }
    pendingInterim = full;
    if (instance === rec && event && window.v3gamAdaptiveLayer && typeof window.v3gamAdaptiveLayer.stampFromRecognitionHandler === "function") {
      window.v3gamAdaptiveLayer.stampFromRecognitionHandler(event, cleanWakePrefix(full), instance);
    }
    showPill('LISTENING LIVE…', '“' + full + '”');
    clearTimeout(interimCommitTimer);
    let delay;
    if (isConfidentLocal(full)) delay = allFinal ? 140 : 400;
    else if (isIncompleteHalfSentence(full)) delay = 3200;
    else delay = allFinal ? 380 : 720;
    interimCommitTimer = setTimeout(() => {
      if (active && !processing && !ttsBusy() && pendingInterim) {
        const toRun = pendingInterim;
        pendingInterim = '';
        executeVoiceTranscript(toRun);
      }
    }, delay);
  }

  function beginRecognitionLoop() {
    if (!active || processing || ttsBusy() || document.hidden) return;
    if (!SR) {
      const isFF = /firefox/i.test(navigator.userAgent || '');
      const msg = isFF
        ? 'Firefox does not enable continuous Web Speech Recognition by default. Use the V3GAM AI text bar or open in Chrome/Edge.'
        : 'Continuous voice recognition is not supported in this browser. Use the V3GAM AI text bar or Chrome/Edge.';
      showPill('BROWSER NOTICE', msg, 0, true);
      return;
    }
    if (rec) return;
    const nowTs = Date.now();
    restartTimestamps = restartTimestamps.filter(ts => nowTs - ts < 10000);
    if (restartTimestamps.length >= 4) {
      scheduleRestart(2500);
      return;
    }
    restartTimestamps.push(nowTs);
    try {
      const instance = new SR();
      rec = instance;
      instance.lang = (window.v3gamLiveAgent && window.v3gamLiveAgent.getLang()) || 'en-IN';
      instance.continuous = true;
      instance.interimResults = true;
      instance.maxAlternatives = 3;

      instance.onstart = () => {
        if (!active) return;
        updateOrbVisualState('Always listening (' + instance.lang.toUpperCase() + ') · Tap to off');
      };

      instance.onresult = (event) => handleSpeechResult(instance, event);

      instance.onerror = (event) => {
        const err = String(event?.error || '');
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          const fixMsg = "Microphone access is blocked. Click the lock or tune icon next to your browser's address bar, set Microphone to 'Allow', and tap the V3GAM Voice button again.";
          stopLiveAgent(fixMsg);
          if (window.v3gamLiveAgent) window.v3gamLiveAgent.speak(fixMsg);
        }
      };

      instance.onend = () => {
        if (rec === instance) rec = null;
        // If Chrome ended the recognition session while an interim transcript was waiting, execute it immediately!
        if (active && !processing && !ttsBusy() && pendingInterim) {
          clearTimeout(interimCommitTimer);
          const toRun = pendingInterim;
          pendingInterim = '';
          executeVoiceTranscript(toRun);
          return;
        }
        if (active && !processing && !ttsBusy() && !document.hidden) {
          scheduleRestart(220);
        }
      };

      instance.start();
    } catch (_) {
      rec = null;
      scheduleRestart(500);
    }
  }

  function startLiveAgent() {
    if (!SR) {
      const isFF = /firefox/i.test(navigator.userAgent || '');
      const msg = isFF
        ? 'Firefox does not support continuous Web Speech Recognition by default. Type in the V3GAM AI bar or use Chrome/Edge.'
        : 'Voice recognition is not supported in this browser. Use Chrome, Edge, or Safari.';
      showPill('BROWSER NOTICE', msg, 0, true);
      if (window.v3gamLiveAgent) window.v3gamLiveAgent.toast(msg);
      return;
    }
    try {
      if (leaderChannel) leaderChannel.postMessage({ type: 'CLAIM_LEADER', tabId: TAB_ID });
      localStorage.setItem('v3gam_active_voice_tab', TAB_ID);
    } catch (_) {}
    active = true;
    processing = false;
    updateOrbVisualState('Always listening · Tap to turn off');
    showPill('V3GAM LIVE AGENT ON', 'Hi buddy! What’s the plan today? Speak any command anytime.');
    if (window.v3gamLiveAgent) {
      window.v3gamLiveAgent.speak("Hi buddy! Vegam Live is on. What's the plan today?");
    }
    scheduleRestart(750);
  }

  function stopLiveAgent(reasonText) {
    active = false;
    processing = false;
    pendingInterim = '';
    clearTimeout(interimCommitTimer);
    clearTimeout(restartTimer);
    try { rec && rec.abort(); } catch (_) {}
    rec = null;
    updateOrbVisualState('Tap to enable live voice');
    showPill('V3GAM LIVE AGENT OFF', reasonText || 'Live voice mode turned off.', 2400);
  }

  window.v3gamNotifyTtsStart = (spokenText) => {
    const cleanText = sanitizeSpokenText(spokenText);
    if (!cleanText) return;
    speaking = true;
    lastSpokenReply = cleanText;
    lastSpokenAt = Date.now();
    pendingInterim = '';
    clearTimeout(interimCommitTimer);
    clearTimeout(restartTimer);
    try { rec && rec.abort(); } catch (_) {}
    rec = null;
  };

  window.v3gamNotifyTtsEnd = () => {
    lastSpokenAt = Date.now();
    setTimeout(() => {
      if (!(window.speechSynthesis && window.speechSynthesis.speaking)) {
        speaking = false;
        if (active && !processing) scheduleRestart(100);
      }
    }, 180);
  };

  function hookSpeechSynthesis() {
    if (!('speechSynthesis' in window)) return;
    // Wrap speechSynthesis.speak so raw JSON, Chinese tool headers, or hex invite codes are stripped before speaking
    if (!window.speechSynthesis.__v3gamWrapped && typeof window.speechSynthesis.speak === 'function') {
      const origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = function (utterance) {
        if (utterance && typeof utterance.text === 'string') {
          utterance.text = sanitizeSpokenText(utterance.text);
          if (!utterance.text) {
            if (typeof window.v3gamNotifyTtsEnd === 'function') window.v3gamNotifyTtsEnd();
            return;
          }
        }
        return origSpeak(utterance);
      };
      window.speechSynthesis.__v3gamWrapped = true;
    }
    setInterval(() => {
      if (!active) return;
      const nowSpeaking = window.speechSynthesis.speaking;
      if (nowSpeaking && !speaking) {
        speaking = true;
        pendingInterim = '';
        clearTimeout(interimCommitTimer);
        try { rec && rec.abort(); } catch (_) {}
        rec = null;
      } else if (!nowSpeaking && speaking && Date.now() - lastSpokenAt > 450) {
        speaking = false;
        scheduleRestart(200);
      }
    }, 180);
  }

  function syncVisibilityWithAuth() {
    createFloatingUi();
    const dock = document.getElementById('v3gamLiveOrbDock');
    if (!dock) return;
    const ready = !!(window.v3gamLiveAgent && window.v3gamLiveAgent.isReady());
    dock.classList.toggle('visible', ready);
    if (!ready && active) {
      stopLiveAgent('Signed out');
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!active) return;
    if (document.hidden) {
      try { rec && rec.abort(); } catch (_) {}
      rec = null;
    } else {
      scheduleRestart(250);
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    createFloatingUi();
    hookSpeechSynthesis();
    setInterval(syncVisibilityWithAuth, 500);
  });
  window.__v3gamWakeAgentDebug = {
    setActive: (v) => { active = !!v; updateOrbVisualState(); },
    getRec: () => rec,
    setRec: (r) => { rec = r; },
    handleSpeechResult,
    executeVoiceTranscript
  };
  createFloatingUi();
  hookSpeechSynthesis();
  syncVisibilityWithAuth();
  setInterval(syncVisibilityWithAuth, 500);
})();