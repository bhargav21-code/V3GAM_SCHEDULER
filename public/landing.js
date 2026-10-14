(() => {
  'use strict';
  const APP = 'V3GAM';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const iconPaths = {
    sparkles:'<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"/><path d="m19 14 1.1 2.9L23 18l-2.9 1.1L19 22l-1.1-2.9L15 18l2.9-1.1L19 14Z"/>',
    message:'<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 4a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.4Z"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h3m-3 3h7"/>',
    shield:'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    arrow:'<path d="M5 12h14m-7-7 7 7-7 7"/>',
    play:'<path d="m8 5 12 7-12 7V5Z"/>',
    menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
    close:'<path d="m18 6-12 12M6 6l12 12"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    route:'<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h3a3 3 0 0 0 3-3V8a3 3 0 0 1 3-3"/>',
    calendarCheck:'<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18m-13 5 2 2 4-4"/>',
    checkCircle:'<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
    leaf:'<path d="M20 4c-8 0-14 3-14 10a6 6 0 0 0 6 6c7 0 10-6 8-16Z"/><path d="M4 21c3-5 7-8 12-11"/>',
    list:'<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    arrowUpRight:'<path d="M7 17 17 7M7 7h10v10"/>'
  };
  function Icon(name, extra = '') {
    return '<svg class="lucide ' + extra + '" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (iconPaths[name] || iconPaths.sparkles) + '</svg>';
  }
  function Brand(extra = '') {
    return '<a class="brand ' + extra + '" href="/" aria-label="V3GAM home"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="brand-name">V3GAM<small>AI TASK SCHEDULER</small></span></a>';
  }
  function Hero() {
    return `
      <section class="hero section-shell" id="about">
        <div class="hero-atmosphere" aria-hidden="true"><span class="orb orb-green"></span><span class="orb orb-amber"></span><span class="orb orb-teal"></span><div class="dot-grid"></div></div>
        <div class="hero-layout content-width">
          <div class="hero-copy" data-reveal>
            <div class="eyebrow-pill"><span class="pill-dot"></span> The scheduler that thinks in time</div>
            <h1>Your day,<br><span>actually planned.</span></h1>
            <p class="hero-subtext">V3GAM turns fuzzy intentions into a realistic schedule. It weighs deadlines, priorities and your real free time, then explains every decision. No more overloaded days.</p>
            <div class="hero-actions">
              <a class="button button-primary" href="/login?mode=signup">Start planning free <span>${Icon('arrow')}</span></a>
              <a class="button button-glass" href="#how-it-works"><span class="play-icon">${Icon('play')}</span> See how it works</a>
            </div>
            <div class="hero-note"><span class="note-check">${Icon('check')}</span> Free to start <i></i> No card required</div>
          </div>
          <div class="hero-visual" data-reveal data-reveal-delay="120" aria-label="3D preview of a balanced V3GAM day planner">
            <div class="scene-halo" aria-hidden="true"></div>
            <div class="floating-layer reminder-layer" data-parallax="1.15"><div class="float-surface floating-card reminder-card"><span class="floating-icon">${Icon('bell')}</span><span><b>Reminder</b><small>Study in 5 min</small></span><i class="live-dot"></i></div></div>
            <div class="floating-layer besttime-layer" data-parallax="1.7"><div class="float-surface floating-card besttime-card"><span class="besttime-spark">${Icon('sparkles')}</span><span><small>BEST TIME</small><b>7:00 PM</b><em>Why? Your focus window is clear.</em></span></div></div>
            <div class="floating-layer streak-layer" data-parallax="1.35"><div class="float-surface floating-card streak-card"><span class="streak-flame">✦</span><span><b>7 day streak</b><small>You're showing up.</small></span></div></div>
            <div class="floating-layer main-card-layer" data-parallax=".62">
              <div class="product-card glass-card">
                <div class="product-top"><div class="product-brand"><span class="mini-brand">${Icon('sparkles')}</span><span><small>V3GAM / TODAY</small><b>Today's Flow</b></span></div><button class="product-more" type="button" aria-label="Preview menu">···</button></div>
                <div class="product-date"><span>Tuesday, October 13</span><span class="balanced"><i></i> Balanced day</span></div>
                <div class="product-progress-row"><div><span class="mini-label">DAILY PROGRESS</span><b class="progress-title">You're finding your flow.</b><small>3 tasks planned around your day</small></div><div class="progress-ring" aria-label="60 percent planned"><span><b>60%</b><small>planned</small></span></div></div>
                <div class="flow-list">
                  <article class="flow-task task-done"><span class="flow-check">${Icon('check')}</span><span class="flow-task-copy"><b>Morning review</b><small>Focus · 30 min</small></span><time>9:00</time></article>
                  <article class="flow-task task-current"><span class="flow-task-icon">${Icon('calendar')}</span><span class="flow-task-copy"><b>Study algorithms</b><small>Deep work · 60 min</small></span><time>10:00</time></article>
                  <article class="flow-task task-next"><span class="flow-task-icon">${Icon('leaf')}</span><span class="flow-task-copy"><b>A little breathing room</b><small>Reset · 15 min</small></span><time>11:00</time></article>
                </div>
                <div class="product-foot"><span>${Icon('shield')} Your plan, always in your hands</span><span class="foot-pulse"></span></div>
              </div>
            </div>
          </div>
        </div>
        <div class="stats-grid content-width">
          <article class="stat-card" data-reveal data-reveal-delay="0"><strong><span class="count-value" data-count="3">3</span><span class="count-suffix"> rounds</span></strong><p>of honest design critique before a line of code</p></article>
          <article class="stat-card" data-reveal data-reveal-delay="80"><strong><span class="count-value" data-count="100">100</span><span class="count-suffix">%</span></strong><p>of scheduling decisions explained to you</p></article>
          <article class="stat-card" data-reveal data-reveal-delay="160"><strong><span class="count-value" data-count="0">0</span></strong><p>important tasks moved without your permission</p></article>
        </div>
      </section>`;
  }
  function TypingDemo() {
    return `
      <section class="typing-demo section-shell" id="try-a-plan" aria-labelledby="typing-demo-title">
        <div class="content-width typing-demo-inner">
          <div class="typing-demo-intro" data-reveal><span class="section-kicker section-kicker-green">A LITTLE V3GAM MAGIC</span><h2 id="typing-demo-title">From thought<br>to <span>time well spent.</span></h2><p>See how a simple thought becomes a plan that actually fits.</p></div>
          <div class="typing-stage" data-reveal data-reveal-delay="100">
            <div class="typing-window glass-card">
              <div class="typing-window-top"><span class="window-dots"><i></i><i></i><i></i></span><span>YOUR THOUGHT, UNDERSTOOD</span><span class="typing-spark">${Icon('sparkles')}</span></div>
              <div class="typing-input" role="img" aria-label="Decorative example typing: Python study tomorrow 7pm for an hour"><span class="typing-prompt">✦</span><span id="typingText" class="typing-text">Python study tomorrow 7pm for an hour</span><span class="typing-caret" aria-hidden="true"></span></div>
            </div>
            <article class="typed-task glass-card" id="typedTask">
              <div class="typed-task-icon">${Icon('calendarCheck')}</div><div class="typed-task-copy"><span class="task-created-label"><i></i> TASK UNDERSTOOD</span><b>Python study</b><span>Tomorrow · 7:00 PM · 1h</span></div>
              <button class="why-chip" id="whySlot" type="button" aria-expanded="false">Why this slot? <span>+</span></button>
              <p class="why-reason" id="whyReason" hidden>Your evening is clear, so you can focus without rushing.</p>
            </article>
            <p class="demo-disclaimer">A visual demo only — no task is created or saved.</p>
          </div>
        </div>
      </section>`;
  }
  function Features() {
    const primary = [
      {icon:'message', title:'Natural-language entry', body:'Type "Python study tomorrow 7pm for an hour" and V3GAM structures it, and always confirms before saving.', micro:'caret', microLabel:'Parsing words'},
      {icon:'calendar', title:'Smart scheduling', body:'Slots weigh deadline urgency, priority, duration and your availability. Every suggestion comes with a reason.', micro:'clock', microLabel:'Finding a clear slot'},
      {icon:'target', title:'Conflict detection', body:'Overloaded days get flagged early, with alternatives that respect what you already committed to.', micro:'warning', microLabel:'Checking conflicts'},
      {icon:'bell', title:'Reminders that respect you', body:'Complete, postpone or mark missed. No duplicate alerts, no nagging, no fake urgency.', micro:'bell', microLabel:'A gentle reminder'}
    ];
    const more = [
      {icon:'clock', title:'A focus mode for getting it done', body:'Start a task with its own timer, track the time left, and choose to finish, snooze, or skip when life changes.'},
      {icon:'checkCircle', title:'Habits and progress that add up', body:'Track daily routines, see your streaks and completion trends, and celebrate the steady work behind bigger goals.'},
      {icon:'shield', title:'Personal and group workspaces', body:'Keep your own plan private, or join a shared space for group tasks, members, and plans that stay organized together.'},
      {icon:'route', title:'A voice assistant that takes action', body:'Ask V3GAM to add or update tasks, check your schedule, or open progress. Actions use your signed-in account and return a real result.'}
    ];
    const card = (f, i) => `<div class="feature-shell" data-reveal data-reveal-delay="${(i % 4) * 80}"><article class="feature-card tilt-card" data-tilt><div class="feature-card-top"><div class="feature-icon glossy-icon">${Icon(f.icon)}</div>${f.micro ? `<span class="micro-visual micro-${f.micro}" aria-hidden="true"><i></i><i></i><i></i></span>` : `<span class="feature-arrow">${Icon('arrowUpRight')}</span>`}</div><div class="feature-card-copy"><h3>${f.title}</h3><p>${f.body}</p></div>${f.micro ? `<span class="micro-caption">${f.microLabel}</span>` : ''}</article></div>`;
    return `
      <section class="features-section section-shell" id="features">
        <div class="features-glow" aria-hidden="true"></div>
        <div class="content-width">
          <div class="problem-intro" data-reveal><span class="section-kicker section-kicker-light">A BETTER WAY TO PLAN</span><h2>To-do lists ignore the<br class="desktop-break"> one thing that matters.</h2><p>They store what you need to do, but never when. Tasks have duration, deadlines and conflicts, and pretending otherwise is how days fall apart.</p></div>
          <div class="features-heading" data-reveal><div><span class="section-kicker section-kicker-green">PURPOSE-BUILT FOR REAL LIFE</span><h2>Built to make your day fit.</h2></div><p>A deterministic engine decides when. A light AI layer only understands your words and explains the plan.</p></div>
          <div class="features-grid">${primary.map(card).join('')}</div>
          <div class="more-features-heading" data-reveal><span class="section-kicker section-kicker-green">THOUGHTFUL DETAILS</span><h3>More room for the way you live.</h3></div>
          <div class="more-features-grid">${more.map(card).join('')}</div>
        </div>
      </section>`;
  }
  function HowItWorks() {
    const steps = [
      {n:'01', icon:'message', title:'Tell it what you mean', body:'Type in plain language. V3GAM asks a follow-up only when something is genuinely unclear.'},
      {n:'02', icon:'calendarCheck', title:'Get a real plan', body:'Your tasks land in the free time that actually exists, ranked by what is actually urgent.'},
      {n:'03', icon:'checkCircle', title:'Finish and move on', body:'Tick tasks off with a satisfying check, watch your progress update, and get nudged to the next one.'}
    ];
    return `
      <section class="how-section section-shell" id="how-it-works">
        <div class="content-width">
          <div class="how-heading" data-reveal><span class="section-kicker">THE FLOW</span><h2>How it works</h2><p>Three steps, no magic required.</p></div>
          <div class="steps-wrap">
            <svg class="step-connector step-connector-desktop" viewBox="0 0 900 80" preserveAspectRatio="none" aria-hidden="true"><path class="step-line-draw" d="M30 40 H870"/></svg>
            <svg class="step-connector step-connector-mobile" viewBox="0 0 80 600" preserveAspectRatio="none" aria-hidden="true"><path class="step-line-draw" d="M42 0 V600"/></svg>
            <div class="steps-grid">${steps.map((s, i) => `<div class="step-shell" data-reveal data-reveal-delay="${i * 100}"><article class="step-card tilt-card" data-tilt><div class="step-card-top"><span class="step-number">${s.n}</span><span class="step-icon glossy-grey-icon">${Icon(s.icon)}</span></div><h3>${s.title}</h3><p>${s.body}</p><span class="step-line" aria-hidden="true"></span></article></div>`).join('')}</div>
          </div>
        </div>
      </section>`;
  }
  function CTA() {
    return `
      <section class="final-cta-section section-shell" id="get-started">
        <div class="cta-glow" aria-hidden="true"></div>
        <div class="cta-card content-width" data-reveal>
          <div class="cta-decoration" aria-hidden="true"><span></span><span></span><span></span></div>
          <div class="cta-content"><span class="section-kicker section-kicker-green">YOUR NEXT DAY STARTS HERE</span><h2>Ready to plan a day<br>that fits?</h2><p>Free to start. Your data stays yours.</p></div>
          <div class="cta-actions"><a class="button button-primary" href="/login?mode=signup">Start planning free <span>${Icon('arrow')}</span></a><a class="button button-ghost" href="/login">Sign in</a></div>
          <div class="cta-check" aria-hidden="true">${Icon('checkCircle')}</div>
        </div>
      </section>`;
  }
  function Footer() {
    return `
      <footer class="site-footer" id="footer">
        <div class="footer-inner content-width">
          <div class="footer-top">
            <div class="footer-brand-block">${Brand('brand-footer')}<p>Plan real days, not just lists.</p></div>
            <div class="footer-links">
              <div class="footer-column"><h3>Product</h3><a href="#features">Features</a><a href="#how-it-works">How it works</a></div>
              <div class="footer-column"><h3>Company</h3><a href="#about">About</a><a href="#how-it-works">How it works</a></div>
              <div class="footer-column"><h3>Legal</h3><a href="#privacy" data-legal="privacy">Privacy</a><a href="#terms" data-legal="terms">Terms</a></div>
            </div>
            <a class="footer-start" href="/login">Get started ${Icon('arrowUpRight')}</a>
          </div>
          <div class="footer-bottom"><span>© 2026 V3GAM. All rights reserved.</span><span>Plan real days, not just lists.</span></div>
        </div>
        <dialog class="legal-dialog" id="legal-dialog" aria-labelledby="legal-title"><form method="dialog"><button class="dialog-close" aria-label="Close">${Icon('close')}</button></form><span class="section-kicker">V3GAM · INFORMATION</span><h2 id="legal-title">Privacy</h2><p id="legal-copy"></p><button class="button button-primary dialog-done" type="button" data-dialog-close>Close</button></dialog>
      </footer>`;
  }
  const root = $('#landing-app');
  if (!root) return;
  root.innerHTML = [Hero(), TypingDemo(), Features(), HowItWorks(), CTA(), Footer()].join('');

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const heroVisual = $('.hero-visual');

  // Desktop parallax is interpolated with one animation-frame loop and disabled on touch.
  if (heroVisual && !reduceMotion && finePointer) {
    let targetX = 0, targetY = 0, currentX = 0, currentY = 0, frame = 0, active = false;
    const layers = $$('.floating-layer', heroVisual);
    function tickParallax() {
      currentX += (targetX - currentX) * 0.12;
      currentY += (targetY - currentY) * 0.12;
      layers.forEach(layer => {
        const depth = Number(layer.dataset.parallax || 1);
        layer.style.setProperty('--px', (currentX * depth).toFixed(2) + 'px');
        layer.style.setProperty('--py', (currentY * depth).toFixed(2) + 'px');
      });
      if (Math.abs(targetX - currentX) > .08 || Math.abs(targetY - currentY) > .08 || active) frame = requestAnimationFrame(tickParallax);
      else frame = 0;
    }
    heroVisual.addEventListener('pointermove', event => {
      const b = heroVisual.getBoundingClientRect();
      if (!b.width || !b.height) return;
      targetX = ((event.clientX - b.left) / b.width - .5) * 16;
      targetY = ((event.clientY - b.top) / b.height - .5) * 13;
      active = true;
      if (!frame) frame = requestAnimationFrame(tickParallax);
    });
    heroVisual.addEventListener('pointerleave', () => {
      targetX = 0; targetY = 0; active = false;
      if (!frame) frame = requestAnimationFrame(tickParallax);
    });
  }

  const menuButton = $('#menu-toggle');
  const mobileMenu = $('#mobile-menu');
  function closeMenu() {
    if (!menuButton || !mobileMenu) return;
    menuButton.setAttribute('aria-expanded', 'false');
    mobileMenu.classList.remove('is-open');
    menuButton.innerHTML = Icon('menu');
    menuButton.setAttribute('aria-label', 'Open navigation menu');
  }
  if (menuButton && mobileMenu) {
    menuButton.addEventListener('click', () => {
      const open = menuButton.getAttribute('aria-expanded') !== 'true';
      menuButton.setAttribute('aria-expanded', String(open));
      mobileMenu.classList.toggle('is-open', open);
      menuButton.innerHTML = Icon(open ? 'close' : 'menu');
      menuButton.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    });
    $$('a', mobileMenu).forEach(link => link.addEventListener('click', closeMenu));
  }

  const revealEls = $$('[data-reveal]');
  function countUp(card) {
    const value = $('.count-value', card);
    if (!value || value.dataset.counted) return;
    value.dataset.counted = 'true';
    const end = Number(value.dataset.count || 0);
    if (reduceMotion || !end) { value.textContent = String(end); return; }
    const duration = 900, start = performance.now();
    function step(now) {
      const p = Math.min(1, (now - start) / duration);
      value.textContent = String(Math.round(end * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        countUp(entry.target);
        observer.unobserve(entry.target);
      }
    }), { threshold: 0.12, rootMargin: '0px 0px -28px 0px' });
    revealEls.forEach(el => observer.observe(el));
    const stepObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('step-seen');
        const stepsWrap = entry.target.closest('.steps-wrap');
        if (stepsWrap) stepsWrap.classList.add('step-seen');
        stepObserver.unobserve(entry.target);
      }
    }), { threshold: 0.2 });
    $$('.step-card').forEach(el => stepObserver.observe(el));
  } else {
    revealEls.forEach(el => { el.classList.add('is-visible'); countUp(el); });
    $$('.step-card').forEach(el => el.classList.add('step-seen'));
    $$('.step-line-draw').forEach(el => el.classList.add('drawn'));
  }
  document.documentElement.classList.add('landing-motion-ready');

  // Shared cursor tilt for glass cards, disabled for touch and reduced motion.
  if (!reduceMotion && finePointer) {
    $$('[data-tilt]').forEach(card => {
      card.addEventListener('pointermove', event => {
        const r = card.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const x = (event.clientX - r.left) / r.width - .5;
        const y = (event.clientY - r.top) / r.height - .5;
        card.style.setProperty('--tilt-x', (x * 12).toFixed(2) + 'deg');
        card.style.setProperty('--tilt-y', (-y * 12).toFixed(2) + 'deg');
      });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--tilt-x', '0deg');
        card.style.setProperty('--tilt-y', '0deg');
      });
    });
  }

  // Purely visual typewriter demo; it never calls an app API.
  const typingText = $('#typingText');
  const typedTask = $('#typedTask');
  const whySlot = $('#whySlot');
  const whyReason = $('#whyReason');
  const exampleText = 'Python study tomorrow 7pm for an hour';
  let typingTimer = null;
  function runTypingDemo() {
    if (!typingText || !typedTask) return;
    if (typingTimer) clearTimeout(typingTimer);
    typedTask.classList.remove('is-ready');
    if (whySlot) whySlot.setAttribute('aria-expanded', 'false');
    if (whyReason) whyReason.hidden = true;
    typingText.textContent = '';
    let index = 0;
    function typeNext() {
      if (index >= exampleText.length) {
        typedTask.classList.add('is-ready');
        return;
      }
      typingText.textContent += exampleText[index++];
      typingTimer = setTimeout(typeNext, 43 + Math.random() * 23);
    }
    typeNext();
  }
  if (typingText && typedTask) {
    if (reduceMotion) {
      typingText.textContent = exampleText;
      typedTask.classList.add('is-ready');
    } else {
      runTypingDemo();
      window.setInterval(runTypingDemo, 8000);
    }
  }
  if (whySlot && whyReason) {
    whySlot.addEventListener('click', () => {
      const expanded = whySlot.getAttribute('aria-expanded') !== 'true';
      whySlot.setAttribute('aria-expanded', String(expanded));
      whyReason.hidden = !expanded;
    });
  }

  const legal = $('#legal-dialog');
  $$('[data-legal]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    const isTerms = link.dataset.legal === 'terms';
    $('#legal-title', legal).textContent = isTerms ? 'Terms' : 'Privacy';
    $('#legal-copy', legal).textContent = isTerms
      ? 'V3GAM is a planning aid. Review suggested changes before applying them, keep your sign-in secure, and use the service responsibly. Specific terms may be updated as the product evolves.'
      : 'Your schedule belongs to you. V3GAM uses your signed-in account and workspace permissions to protect saved tasks. Review your account settings for controls over your data.';
    if (legal && legal.showModal) legal.showModal();
  }));
  $('[data-dialog-close]', legal)?.addEventListener('click', () => legal.close());
  legal?.addEventListener('click', event => { if (event.target === legal) legal.close(); });

  // Preserve existing auth recovery and signed-in routing behavior.
  (async () => {
    const recovery = new URLSearchParams(location.search).get('type') === 'recovery' || location.hash.includes('type=recovery');
    if (recovery) { location.replace('/login' + location.search + location.hash); return; }
    try {
      const response = await fetch('/api/auth-config', { cache: 'no-store' });
      if (!response.ok) return;
      const config = await response.json();
      if (!config.url || !config.key || !window.supabase || !window.supabase.createClient) return;
      const client = window.supabase.createClient(config.url, config.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' }
      });
      const result = await client.auth.getSession();
      if (!result.error && result.data && result.data.session && result.data.session.user) {
        location.replace('/login' + location.search + location.hash);
      }
    } catch (_) {
      // Keep the public landing page available if auth configuration is temporarily unavailable.
    }
  })();
})();