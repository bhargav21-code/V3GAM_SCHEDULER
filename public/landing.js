(() => {
  const APP = 'Orbit';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const path = {
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
  function Icon(name, extra) {
    return '<svg class="lucide ' + (extra || '') + '" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (path[name] || path.sparkles) + '</svg>';
  }
  function Brand() {
    return '<a class="brand" href="/" aria-label="Orbit home"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span><span></span></span><span class="brand-name">Orbit<small>AI TASK SCHEDULER</small></span></a>';
  }
  function Hero() {
    return '<section class="hero section-shell" id="about"><div class="hero-atmosphere" aria-hidden="true"><span class="orb orb-green"></span><span class="orb orb-cream"></span><span class="orb orb-blue"></span></div>' +
      '<div class="hero-layout content-width"><div class="hero-copy" data-reveal><div class="eyebrow-pill"><span class="pill-dot"></span>The scheduler that thinks in time</div>' +
      '<h1>Your day,<br><span>actually planned.</span></h1><p class="hero-subtext">' + APP + ' turns fuzzy intentions into a realistic schedule. It weighs deadlines, priorities and your real free time, then explains every decision. No more overloaded days.</p>' +
      '<div class="hero-actions"><a class="button button-primary" href="/login">Start planning free <span>' + Icon('arrow') + '</span></a><a class="button button-glass" href="#how-it-works"><span class="play-icon">' + Icon('play') + '</span> See how it works</a></div>' +
      '<div class="hero-note"><span class="note-check">' + Icon('check') + '</span> Free to start <i></i> No card required</div></div>' +
      '<div class="hero-visual" data-reveal data-reveal-delay="120" aria-label="Illustration of a realistic planned day"><div class="floating-label label-top"><span class="tiny-live"></span>A little more room to breathe</div>' +
      '<div class="schedule-window"><div class="schedule-top"><div><span class="window-overline">YOUR TUESDAY</span><strong>A plan that fits</strong></div><span class="window-avatar">O</span></div>' +
      '<div class="schedule-meta"><span>4 tasks planned</span><span class="schedule-complete">● Balanced</span></div><div class="schedule-timeline">' +
      '<div class="time-mark"><span>9:00</span><i></i></div><article class="schedule-task task-study"><span class="task-icon">' + Icon('calendar') + '</span><div><strong>Study algorithms</strong><small>Deep work · 60 min</small></div><b>9:00</b></article>' +
      '<div class="time-mark"><span>10:00</span><i></i></div><article class="schedule-task task-break"><span class="task-icon">' + Icon('leaf') + '</span><div><strong>Breathing room</strong><small>Buffer · 15 min</small></div><b>10:00</b></article>' +
      '<div class="time-mark"><span>10:15</span><i></i></div><article class="schedule-task task-project"><span class="task-icon">' + Icon('list') + '</span><div><strong>Finish lab notes</strong><small>Project · 45 min</small></div><b>10:15</b></article></div>' +
      '<div class="schedule-reason"><span>' + Icon('sparkles') + '</span><p><b>Why this time?</b>Your deadline is close, and this slot is clear.</p></div></div>' +
      '<div class="floating-label label-bottom"><span class="floating-check">' + Icon('check') + '</span><span><b>Room for real life</b><small>Buffers stay on the plan</small></span></div></div></div>' +
      '<div class="stats-grid content-width" data-reveal><article class="stat-card"><strong>3 rounds</strong><p>of honest design critique before a line of code</p></article><article class="stat-card"><strong>100%</strong><p>of scheduling decisions explained to you</p></article><article class="stat-card"><strong>0</strong><p>important tasks moved without your permission</p></article></div></section>';
  }
  function Features() {
    const features = [
      {icon:'message', title:'Natural-language entry', body:'Type “Python study tomorrow 7pm for an hour” and ' + APP + ' structures it, then always confirms before saving.'},
      {icon:'calendar', title:'Smart scheduling', body:'Slots weigh deadline urgency, priority, duration and your availability. Every suggestion comes with a reason.'},
      {icon:'target', title:'Conflict detection', body:'Overloaded days get flagged early, with alternatives that respect what you already committed to.'},
      {icon:'bell', title:'Reminders that respect you', body:'Complete, postpone or mark missed. No duplicate alerts, no nagging, no fake urgency.'},
      {icon:'clock', title:'A focus mode for getting it done', body:'Start a task with its own timer, track the time left, and choose to finish, snooze, or skip when life changes.'},
      {icon:'checkCircle', title:'Habits and progress that add up', body:'Track daily routines, see your streaks and completion trends, and celebrate the steady work behind bigger goals.'},
      {icon:'shield', title:'Personal and group workspaces', body:'Keep your own plan private, or join a shared space for group tasks, members, and plans that stay organized together.'},
      {icon:'route', title:'A voice assistant that takes action', body:'Ask Orbit to add or update tasks, check your schedule, or open progress. Actions use your signed-in account and return a real result.'}
    ];
    return '<section class="features-section section-shell" id="features"><div class="content-width"><div class="problem-intro" data-reveal><span class="section-kicker section-kicker-light">A BETTER WAY TO PLAN</span><h2>To-do lists ignore the<br class="desktop-break"> one thing that matters.</h2><p>They store what you need to do, but never when. Tasks have duration, deadlines and conflicts, and pretending otherwise is how days fall apart.</p></div>' +
      '<div class="features-heading" data-reveal><div><span class="section-kicker section-kicker-green">PURPOSE-BUILT FOR REAL LIFE</span><h2>Built to make your day fit.</h2></div><p>A deterministic engine decides when. A light AI layer only understands your words and explains the plan.</p></div>' +
      '<div class="features-grid">' + features.map((f, i) => '<article class="feature-card" data-reveal data-reveal-delay="' + (i * 70) + '"><div class="feature-icon">' + Icon(f.icon) + '</div><div class="feature-card-copy"><h3>' + f.title + '</h3><p>' + f.body + '</p></div><span class="feature-arrow">' + Icon('arrowUpRight') + '</span></article>').join('') + '</div></div></section>';
  }
  function HowItWorks() {
    const steps = [
      {n:'01', icon:'message', title:'Tell it what you mean', body:'Type in plain language. ' + APP + ' asks a follow-up only when something is genuinely unclear.'},
      {n:'02', icon:'calendarCheck', title:'Get a real plan', body:'Your tasks land in the free time that actually exists, ranked by what is actually urgent.'},
      {n:'03', icon:'checkCircle', title:'Finish and move on', body:'Tick tasks off with a satisfying check, watch your progress update, and get nudged to the next one.'}
    ];
    return '<section class="how-section section-shell" id="how-it-works"><div class="content-width"><div class="how-heading" data-reveal><span class="section-kicker">THE FLOW</span><h2>How it works</h2><p>Three steps, no magic required.</p></div><div class="steps-grid">' +
      steps.map((s, i) => '<article class="step-card" data-reveal data-reveal-delay="' + (i * 100) + '"><div class="step-card-top"><span class="step-number">' + s.n + '</span><span class="step-icon">' + Icon(s.icon) + '</span></div><h3>' + s.title + '</h3><p>' + s.body + '</p><span class="step-line" aria-hidden="true"></span></article>').join('') + '</div></div></section>';
  }
  function CTA() {
    return '<section class="final-cta-section section-shell" id="get-started"><div class="cta-card content-width" data-reveal><div class="cta-decoration" aria-hidden="true"><span></span><span></span><span></span></div><div class="cta-content"><span class="section-kicker section-kicker-green">YOUR NEXT DAY STARTS HERE</span><h2>Ready to plan a day<br>that fits?</h2><p>Free to start. Your data stays yours.</p></div><div class="cta-actions"><a class="button button-primary" href="/login">Start planning free <span>' + Icon('arrow') + '</span></a><a class="button button-dark" href="/login">Sign in</a></div></div></section>';
  }
  function Footer() {
    return '<footer class="site-footer" id="footer"><div class="footer-inner content-width"><div class="footer-top"><div class="footer-brand-block">' + Brand() + '<p>Plan real days, not just lists.</p></div>' +
      '<div class="footer-links"><div class="footer-column"><h3>Product</h3><a href="#features">Features</a><a href="#how-it-works">How it works</a></div><div class="footer-column"><h3>Company</h3><a href="#about">About</a><a href="#how-it-works">How it works</a></div><div class="footer-column"><h3>Legal</h3><a href="#privacy" data-legal="privacy">Privacy</a><a href="#terms" data-legal="terms">Terms</a></div></div>' +
      '<a class="footer-start" href="/login">Get started ' + Icon('arrowUpRight') + '</a></div><div class="footer-bottom"><span>© 2026 ' + APP + '. All rights reserved.</span><span>Plan real days, not just lists.</span></div></div></footer>' +
      '<dialog class="legal-dialog" id="legal-dialog" aria-labelledby="legal-title"><form method="dialog"><button class="dialog-close" aria-label="Close">' + Icon('close') + '</button></form><span class="section-kicker">ORBIT · INFORMATION</span><h2 id="legal-title">Privacy</h2><p id="legal-copy"></p><button class="button button-primary dialog-done" type="button" data-dialog-close>Close</button></dialog>';
  }
  const root = $('#landing-app');
  if (!root) return;
  root.innerHTML = [Hero(), Features(), HowItWorks(), CTA(), Footer()].join('');
  // Enable motion only after the landing markup has been rendered.
  const prefersReduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const heroVisual = $('.hero-visual');
  if (heroVisual && !prefersReduce && window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    heroVisual.addEventListener('pointermove', event => {
      const bounds = heroVisual.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      heroVisual.style.setProperty('--tilt-x', (x * 13 - 4.5).toFixed(2) + 'deg');
      heroVisual.style.setProperty('--tilt-y', (-y * 8 + 2).toFixed(2) + 'deg');
      heroVisual.style.setProperty('--float-shift', (x * 8).toFixed(2) + 'px');
    });
    heroVisual.addEventListener('pointerleave', () => {
      heroVisual.style.setProperty('--tilt-x', '-4.5deg');
      heroVisual.style.setProperty('--tilt-y', '2deg');
      heroVisual.style.setProperty('--float-shift', '0px');
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
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealEls = $$('[data-reveal]');
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
    }), {threshold:0.14, rootMargin:'0px 0px -28px 0px'});
    revealEls.forEach(el => observer.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('is-visible'));
  }
  document.documentElement.classList.add('landing-motion-ready');
  const legal = $('#legal-dialog');
  $$('[data-legal]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    const isTerms = link.dataset.legal === 'terms';
    $('#legal-title', legal).textContent = isTerms ? 'Terms' : 'Privacy';
    $('#legal-copy', legal).textContent = isTerms
      ? 'Orbit is a planning aid. Review suggested changes before applying them, keep your sign-in secure, and use the service responsibly. Specific terms may be updated as the product evolves.'
      : 'Your schedule belongs to you. Orbit uses your signed-in account and workspace permissions to protect saved tasks. Review your account settings for controls over your data.';
    if (legal && legal.showModal) legal.showModal();
  }));
  $('[data-dialog-close]', legal)?.addEventListener('click', () => legal.close());
  legal?.addEventListener('click', event => { if (event.target === legal) legal.close(); });

  // Preserve auth recovery callbacks; otherwise send an existing session to the original app at /login.
  (async () => {
    const recovery = new URLSearchParams(location.search).get('type') === 'recovery' || location.hash.includes('type=recovery');
    if (recovery) { location.replace('/login' + location.search + location.hash); return; }
    try {
      const response = await fetch('/api/auth-config', {cache:'no-store'});
      if (!response.ok) return;
      const config = await response.json();
      if (!config.url || !config.key || !window.supabase || !window.supabase.createClient) return;
      const client = window.supabase.createClient(config.url, config.key, {
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,flowType:'pkce'}
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