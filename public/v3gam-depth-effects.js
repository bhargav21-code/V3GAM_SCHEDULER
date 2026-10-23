(() => {
  'use strict';
  const app = document.getElementById('app');
  if (!app) return;

  const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const finePointer = !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) && window.innerWidth > 768;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const CARD_SELECTOR = [
    '.metric-card','.sumcard','.activity-card','.progress-card','.deadlines-card','.meetings-card',
    '.mini-agenda','.calendar-board','.quote-card','.chartcard','.score','.streak','.monthcard',
    '.insight','.formcard','.workspace-page-card','.workspace-group-card','.workspace-detail-head',
    '.workspace-detail-stats>div','.workspace-task-row','.when-choice','.ai-promo',
    '.habit-overview-card','.weekly-habit-breakdown','.selected-day-card','.habit-tracker-card',
    '.habit-chart-card','.selected-task-row','.workspace-page-empty'
  ].join(',');
  const ICON_SELECTOR = [
    '.metric-tile','.panel-title-icon','.deadline-icon','.meeting-badge','.workspace-page-icon',
    '.workspace-group-icon','.workspace-member-avatar','.group-owner-manage-icon','.when-choice-icon',
    '.selected-task-state'
  ].join(',');
  const BUTTON_SELECTOR = [
    '.btn.primary','.plus','.send','.completion-next','.quote-add-task','.project-action.primary'
  ].join(',');
  const ENTER_SELECTOR = '.mini-task,.task,.selected-task-row,.workspace-task-row,.deadline-item,.meeting-item,.agenda-item';
  const seenCards = new WeakSet();
  const seenIcons = new WeakSet();
  const seenButtons = new WeakSet();
  const seenEnter = new WeakSet();
  let pendingTaskInsertion = false;
  let pendingTaskTitle = '';
  const countTargets = new WeakMap();
  const countingNow = new WeakSet();
  const rafTilt = new WeakMap();
  const tiltCleanups = new WeakMap();
  let confettiCanvas = null;
  let confettiFrame = 0;

  function setupAmbient() {
    const banner = $('.hero-banner', app);
    if (banner && !$('.v3g-banner-particles', banner)) {
      const particles = document.createElement('span');
      particles.className = 'v3g-banner-particles';
      particles.setAttribute('aria-hidden', 'true');
      banner.appendChild(particles);
    }
    if (!$('.v3g-ambient-layer', app)) {
      const ambient = document.createElement('span');
      ambient.className = 'v3g-ambient-layer';
      ambient.setAttribute('aria-hidden', 'true');
      app.prepend(ambient);
    }
    if (!$('.v3g-cursor-spotlight', app)) {
      const spotlight = document.createElement('span');
      spotlight.className = 'v3g-cursor-spotlight';
      spotlight.setAttribute('aria-hidden', 'true');
      app.prepend(spotlight);
    }
    const nav = $('.nav', app);
    if (nav && !$('.v3g-sidebar-shimmer', nav)) {
      const shimmer = document.createElement('span');
      shimmer.className = 'v3g-sidebar-shimmer';
      shimmer.setAttribute('aria-hidden', 'true');
      nav.prepend(shimmer);
    }
    const orb = $('#agentBtn', app);
    if (orb && !$('.v3g-ai-tooltip', orb)) {
      const tip = document.createElement('span');
      tip.className = 'v3g-ai-tooltip';
      tip.textContent = 'Open V3GAM AI';
      tip.setAttribute('aria-hidden', 'true');
      orb.appendChild(tip);
      if (!orb.title) orb.title = 'Open V3GAM AI assistant';
    }
  }

  function useTilt(card) {
    if (!card || seenCards.has(card)) return;
    seenCards.add(card);
    card.classList.add('v3g-depth-ready');
    if (!$('.v3g-card-glare', card)) {
      const glare = document.createElement('span');
      glare.className = 'v3g-card-glare';
      glare.setAttribute('aria-hidden', 'true');
      card.prepend(glare);
    }
    if (reducedMotion || !finePointer) return;

    let targetX = 0, targetY = 0, currentX = 0, currentY = 0;
    let pointerX = 50, pointerY = 35;
    let frame = 0, active = false;

    function tick() {
      currentX += (targetX - currentX) * 0.20;
      currentY += (targetY - currentY) * 0.20;
      card.style.setProperty('--v3g-rx', currentX.toFixed(2) + 'deg');
      card.style.setProperty('--v3g-ry', currentY.toFixed(2) + 'deg');
      card.style.setProperty('--v3g-tz', (Math.abs(targetX) + Math.abs(targetY) > .1 ? 12 : 0) + 'px');
      card.style.setProperty('--v3g-glare-x', pointerX.toFixed(1) + '%');
      card.style.setProperty('--v3g-glare-y', pointerY.toFixed(1) + '%');
      if (active || Math.abs(targetX-currentX) > .05 || Math.abs(targetY-currentY) > .05) {
        frame = requestAnimationFrame(tick);
      } else {
        frame = 0;
        card.classList.remove('v3g-tilting');
        card.style.removeProperty('will-change');
      }
    }

    function onMove(event) {
      if (window.innerWidth <= 768 || reducedMotion) return;
      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      targetX = (0.5 - y) * 16;
      targetY = (x - 0.5) * 16;
      pointerX = x * 100;
      pointerY = y * 100;
      active = true;
      card.classList.add('v3g-tilting');
      card.style.willChange = 'transform';
      if (!frame) frame = requestAnimationFrame(tick);
    }
    function onLeave() {
      targetX = 0;
      targetY = 0;
      active = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      currentX = 0;
      currentY = 0;
      card.classList.remove('v3g-tilting');
      card.style.removeProperty('will-change');
      card.style.setProperty('--v3g-rx','0deg');
      card.style.setProperty('--v3g-ry','0deg');
      card.style.setProperty('--v3g-tz','0px');
      card.style.setProperty('--v3g-glare-x','50%');
      card.style.setProperty('--v3g-glare-y','35%');
    }
    card.addEventListener('pointermove', onMove, {passive:true});
    card.addEventListener('pointerleave', onLeave, {passive:true});
    tiltCleanups.set(card, () => {
      card.removeEventListener('pointermove', onMove);
      card.removeEventListener('pointerleave', onLeave);
      if (frame) cancelAnimationFrame(frame);
    });
    rafTilt.set(card, () => frame);
  }

  function addIconSpecular(icon) {
    if (!icon || seenIcons.has(icon)) return;
    seenIcons.add(icon);
    if (!$('.v3g-icon-specular', icon)) {
      const dot = document.createElement('span');
      dot.className = 'v3g-icon-specular';
      dot.setAttribute('aria-hidden', 'true');
      icon.appendChild(dot);
    }
  }

  function addButtonSweep(button) {
    if (!button || seenButtons.has(button)) return;
    seenButtons.add(button);
    if (!$('.v3g-button-sweep', button)) {
      const sweep = document.createElement('span');
      sweep.className = 'v3g-button-sweep';
      sweep.setAttribute('aria-hidden', 'true');
      button.appendChild(sweep);
    }
  }

  function addBarAnimation(root) {
    const host = root && root.matches && root.matches('#dashboardActivityChart') ? root : (root && root.closest ? root.closest('#dashboardActivityChart') : null) || (root && root.querySelector ? root.querySelector('#dashboardActivityChart') : null);
    const groups = host ? Array.from(host.children) : [];
    groups.forEach((group, index) => {
      const bar = $('.activity-bar', group);
      if (!bar) return;
      bar.style.setProperty('--v3g-stagger', Math.min(index, 6) * 60 + 'ms');
    });
  }

  function addTooltips(root) {
    const nodes = [];
    if (root.matches && root.matches('.mini-task,[data-task]')) nodes.push(root);
    if (root.querySelectorAll) nodes.push(...root.querySelectorAll('.mini-task,[data-task]'));
    nodes.forEach(node => {
      if (node.classList.contains('mini-task')) {
        const title = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (!node.title && title) node.title = title;
        node.style.setProperty('min-width', '0');
      }
    });
  }

  function replaceUndefined(root) {
    const start = root && root.nodeType === 1 ? root : null;
    if (!start || !app.contains(start) && start !== app) return;
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      if (!node.parentElement || node.parentElement.closest('script,style,textarea,input')) return;
      if (/\bundefined\b/i.test(node.nodeValue || '')) {
        node.nodeValue = node.nodeValue.replace(/\bundefined\b/gi, 'Smart scheduled');
      }
    });
  }

  const COUNTER_SELECTOR = '#dashboardPercent,#dashboardPercentPanel,#insightsScore,#weekHabitPercent,#habitProgressText';
  function useCountUp(el) {
    if (!el || countingNow.has(el) || reducedMotion) return;
    const target = (el.textContent || '').trim();
    const match = target.match(/^([^\d]*)(\d+(?:\.\d+)?)(\D*)$/);
    if (!match || countTargets.get(el) === target) return;
    countTargets.set(el, target);
    const end = Number(match[2]);
    const prefix = match[1], suffix = match[3];
    if (!Number.isFinite(end) || end < 0) return;
    countingNow.add(el);
    const start = performance.now(), duration = 760;
    function step(now) {
      if (!el.isConnected) { countingNow.delete(el); return; }
      const p = Math.min(1, (now-start)/duration);
      const value = end * (1-Math.pow(1-p,3));
      el.textContent = prefix + (Number.isInteger(end) ? String(Math.round(value)) : value.toFixed(1)) + suffix;
      if (p < 1 && !document.hidden && !reducedMotion) requestAnimationFrame(step);
      else {
        el.textContent = target;
        countingNow.delete(el);
      }
    }
    requestAnimationFrame(step);
  }

  const countObserver = !reducedMotion && 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) useCountUp(entry.target); });
  }, {threshold:0.25,rootMargin:'0px 0px -10px 0px'}) : null;
  const enterObserver = !reducedMotion && 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('v3g-enter');
      enterObserver.unobserve(entry.target);
    });
  }, {threshold:0.12,rootMargin:'0px 0px -20px 0px'}) : null;
  function observeCounter(el) {
    if (!el || reducedMotion) return;
    if (countObserver) countObserver.observe(el);
    else useCountUp(el);
  }

  function enhance(root) {
    if (!root) return;
    if (root.nodeType === 1 && root.matches && root.matches(CARD_SELECTOR)) useTilt(root);
    if (root.querySelectorAll) root.querySelectorAll(CARD_SELECTOR).forEach(useTilt);
    if (root.nodeType === 1 && root.matches && root.matches(ICON_SELECTOR)) addIconSpecular(root);
    if (root.querySelectorAll) root.querySelectorAll(ICON_SELECTOR).forEach(addIconSpecular);
    if (root.nodeType === 1 && root.matches && root.matches(BUTTON_SELECTOR)) addButtonSweep(root);
    if (root.querySelectorAll) root.querySelectorAll(BUTTON_SELECTOR).forEach(addButtonSweep);
    if (root.nodeType === 1 && root.matches && root.matches(ENTER_SELECTOR)) enterCard(root);
    if (root.querySelectorAll) root.querySelectorAll(ENTER_SELECTOR).forEach(enterCard);
    addTooltips(root);
    if (root === app || app.contains(root)) replaceUndefined(root);
    addBarAnimation(root);
    $$(COUNTER_SELECTOR, app).forEach(observeCounter);
  }

  function enterCard(node) {
    if (!node || seenEnter.has(node)) return;
    seenEnter.add(node);
    if (pendingTaskInsertion && node.matches('.mini-task,.task,.selected-task-row,.workspace-task-row')) {
      const titleNode = $('.tasktitle,.selected-task-open strong,.workspace-task-row b,.mini-task>span', node);
      const title = (titleNode ? titleNode.textContent : node.textContent || '').replace(/\s+/g,' ').trim();
      if (pendingTaskTitle && title.includes(pendingTaskTitle)) {
        node.classList.add('v3g-task-new');
        pendingTaskInsertion = false;
        pendingTaskTitle = '';
      }
    }
    const siblings = node.parentElement ? Array.from(node.parentElement.children).filter(n => n.matches && n.matches(ENTER_SELECTOR)) : [];
    node.style.setProperty('--v3g-stagger', Math.max(0, siblings.indexOf(node)) % 9 * 80 + 'ms');
    if (reducedMotion) return;
    if (enterObserver) enterObserver.observe(node);
    else node.classList.add('v3g-enter');
  }

  setupAmbient();
  enhance(app);

  if (finePointer && !reducedMotion) {
    let spotlightPoint = null, spotlightFrame = 0;
    app.addEventListener('pointermove', event => {
      spotlightPoint = {x:event.clientX,y:event.clientY};
      if (spotlightFrame) return;
      spotlightFrame = requestAnimationFrame(() => {
        spotlightFrame = 0;
        if (!spotlightPoint || document.hidden) return;
        const rect = app.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        app.style.setProperty('--v3g-spot-x', ((spotlightPoint.x-rect.left)/rect.width*100).toFixed(1)+'%');
        app.style.setProperty('--v3g-spot-y', ((spotlightPoint.y-rect.top)/rect.height*100).toFixed(1)+'%');
      });
    }, {passive:true});
    $$('.ai-promo', app).forEach(card => {
      let point = null, frame = 0;
      card.addEventListener('pointermove', event => {
        point = {x:event.clientX,y:event.clientY};
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (!point || document.hidden) return;
          const rect = card.getBoundingClientRect();
          const x = (point.x-rect.left)/Math.max(1,rect.width)-.5;
          const y = (point.y-rect.top)/Math.max(1,rect.height)-.5;
          const node = $('.ai-orbit', card);
          if (node) {
            node.style.setProperty('--v3g-node-x', (x*10).toFixed(1)+'px');
            node.style.setProperty('--v3g-node-y', (y*8).toFixed(1)+'px');
          }
        });
      }, {passive:true});
      card.addEventListener('pointerleave', () => {
        point = null;
        card.style.setProperty('--v3g-node-x','0px');
        card.style.setProperty('--v3g-node-y','0px');
      }, {passive:true});
    });
    const banner = $('.hero-banner', app);
    if (banner) {
      let point = null, frame = 0;
      banner.addEventListener('pointermove', event => {
        point = {x:event.clientX,y:event.clientY};
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (!point || document.hidden) return;
          const rect = banner.getBoundingClientRect();
          const x = (point.x-rect.left)/Math.max(1,rect.width)-.5;
          const y = (point.y-rect.top)/Math.max(1,rect.height)-.5;
          banner.style.setProperty('--v3g-hero-x', (-x*28).toFixed(1)+'px');
          banner.style.setProperty('--v3g-hero-y', (-y*16).toFixed(1)+'px');
        });
      }, {passive:true});
      banner.addEventListener('pointerleave', () => {
        point = null;
        banner.style.setProperty('--v3g-hero-x','0px');
        banner.style.setProperty('--v3g-hero-y','0px');
      }, {passive:true});
    }
  }

  // Visual reward bursts are layered on top of existing task handlers. They never prevent a click or call an API.
  function particleBurst(x, y, count) {
    if (reducedMotion || document.hidden) return;
    const colors = ['#6B8E3A','#A9C26B','#C9A35C','#8FAE55','#D9BD7A'];
    const total = Math.max(10, Math.min(14, count || 12));
    for (let i=0;i<total;i++) {
      const particle = document.createElement('span');
      particle.className = 'v3g-particle';
      particle.setAttribute('aria-hidden','true');
      particle.style.left = x+'px';
      particle.style.top = y+'px';
      particle.style.setProperty('--v3g-particle-color', colors[i%colors.length]);
      particle.style.setProperty('--v3g-particle-x', (Math.cos((Math.PI*2*i)/total)*(22+(i%3)*8)).toFixed(1)+'px');
      particle.style.setProperty('--v3g-particle-y', (Math.sin((Math.PI*2*i)/total)*(22+(i%3)*8)-8).toFixed(1)+'px');
      document.body.appendChild(particle);
      window.setTimeout(() => particle.remove(), 680);
    }
  }

  function runConfetti() {
    if (reducedMotion || document.hidden) return;
    if (confettiFrame) cancelAnimationFrame(confettiFrame);
    if (confettiCanvas) confettiCanvas.remove();
    confettiCanvas = document.createElement('canvas');
    confettiCanvas.className = 'v3g-confetti-canvas';
    confettiCanvas.setAttribute('aria-hidden','true');
    confettiCanvas.style.position = 'fixed';
    confettiCanvas.style.inset = '0';
    confettiCanvas.style.width = '100vw';
    confettiCanvas.style.height = '100vh';
    confettiCanvas.style.pointerEvents = 'none';
    confettiCanvas.style.zIndex = '10001';
    document.body.appendChild(confettiCanvas);
    const canvas = confettiCanvas;
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) { canvas.remove(); confettiCanvas = null; return; }
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    canvas.width = w*ratio; canvas.height = h*ratio; ctx.scale(ratio,ratio);
    const colors = ['#2F4A1E','#6B8E3A','#A9C26B','#C9A35C','#E6D59C'];
    const pieces = Array.from({length:76},(_,i)=>({
      x:w*.5+(Math.random()-.5)*Math.min(220,w*.45),
      y:h*.30+(Math.random()-.5)*70,
      vx:(Math.random()-.5)*5.4, vy:-2.5-Math.random()*5,
      size:3+Math.random()*4, rotation:Math.random()*Math.PI,
      spin:(Math.random()-.5)*.24, color:colors[i%colors.length],
      opacity:1, shape:i%3
    }));
    const start = performance.now(), duration = 1500;
    function draw(now) {
      if (!ctx || document.hidden || !canvas.isConnected) { canvas.remove(); confettiCanvas = null; confettiFrame=0; return; }
      ctx.clearRect(0,0,w,h);
      const elapsed = now-start, p = Math.min(1,elapsed/duration);
      pieces.forEach(piece => {
        piece.x += piece.vx; piece.y += piece.vy; piece.vy += .11; piece.rotation += piece.spin;
        piece.opacity = Math.max(0,1-p*.95);
        ctx.save(); ctx.globalAlpha=piece.opacity; ctx.translate(piece.x,piece.y); ctx.rotate(piece.rotation); ctx.fillStyle=piece.color;
        if (piece.shape===0) ctx.fillRect(-piece.size/2,-piece.size/3,piece.size,piece.size*.65);
        else if (piece.shape===1) { ctx.beginPath(); ctx.arc(0,0,piece.size*.45,0,Math.PI*2); ctx.fill(); }
        else { ctx.beginPath(); ctx.moveTo(-piece.size/2,-piece.size/2); ctx.lineTo(piece.size/2,0); ctx.lineTo(-piece.size/2,piece.size/2); ctx.closePath(); ctx.fill(); }
        ctx.restore();
      });
      if (elapsed < duration) confettiFrame=requestAnimationFrame(draw);
      else { canvas.remove(); confettiCanvas=null; confettiFrame=0; }
    }
    confettiFrame=requestAnimationFrame(draw);
  }

  document.addEventListener('click', event => {
    const addTask = event.target && event.target.closest ? event.target.closest('#confirmTaskBtn') : null;
    if (addTask) {
      pendingTaskTitle = ($('#taskName', app)?.value || $('#parsedTitle', app)?.textContent || '').trim();
      pendingTaskInsertion = !!pendingTaskTitle;
      window.setTimeout(() => { pendingTaskInsertion = false; pendingTaskTitle = ''; }, 12000);
    }
  }, true);

  const lastClick = {id:null,x:0,y:0,wasDone:false,root:null};
  document.addEventListener('click', event => {
    const target = event.target && event.target.closest ? event.target.closest('#app [data-toggle-task],#app .task-check,#app .habit-check') : null;
    if (!target || !app.contains(target) || target.disabled) return;
    const id = target.dataset.toggleTask || '';
    const done = target.classList.contains('checked') || target.classList.contains('done') || target.getAttribute('aria-pressed') === 'true';
    lastClick.id = id;
    lastClick.x = event.clientX || target.getBoundingClientRect().left+target.getBoundingClientRect().width/2;
    lastClick.y = event.clientY || target.getBoundingClientRect().top+target.getBoundingClientRect().height/2;
    lastClick.wasDone = done;
    lastClick.root = target.closest('#timeline');
    if (!id || done) return;
    let attempts = 0;
    const expectedSelector = '[data-toggle-task="' + CSS.escape(id) + '"]';
    function awaitRenderedState() {
      attempts++;
      const current = $$('#timeline [data-toggle-task]', app).find(item => item.dataset.toggleTask === id);
      if (current && (current.classList.contains('checked') || current.getAttribute('aria-pressed') === 'true')) {
        const completedRow = current.closest('.task,.selected-task-row,.workspace-task-row');
        if (completedRow) {
          completedRow.classList.add('v3g-task-completed');
          window.setTimeout(() => completedRow.classList.remove('v3g-task-completed'), 420);
        }
        particleBurst(lastClick.x,lastClick.y,12);
        const ring = $('#dashboardRingPanel', app);
        if (ring) {
          ring.classList.remove('v3g-ring-flash');
          void ring.offsetWidth;
          ring.classList.add('v3g-ring-flash');
          window.setTimeout(() => ring.classList.remove('v3g-ring-flash'), 1100);
        }
        if (lastClick.root) {
          const checkboxes = $$('#timeline [data-toggle-task]', app);
          if (checkboxes.length && checkboxes.every(item => item.classList.contains('checked') || item.getAttribute('aria-pressed') === 'true')) runConfetti();
        }
        return;
      }
      if (attempts < 18 && !document.hidden) window.setTimeout(awaitRenderedState, 90);
    }
    window.setTimeout(awaitRenderedState, 50);
  }, true);

  const observer = new MutationObserver(records => {
    records.forEach(record => {
      if (record.type === 'childList') {
        record.addedNodes.forEach(node => {
          if (node.nodeType === 1) {
            if (app.contains(node)) enhance(node);
          }
        });
        const ancestor = record.target && record.target.nodeType === 1 ? record.target : null;
        if (ancestor && app.contains(ancestor)) {
          replaceUndefined(ancestor);
          const counter = ancestor.matches && ancestor.matches(COUNTER_SELECTOR) ? ancestor : (ancestor.closest ? ancestor.closest(COUNTER_SELECTOR) : null);
          if (counter && app.contains(counter) && !countingNow.has(counter)) observeCounter(counter);
        }
      }
    });
  });
  observer.observe(app, {childList:true,subtree:true});

  const initialScreen = $('.screen.active', app);
  if (initialScreen) initialScreen.classList.add('v3g-first-screen');
  $$(COUNTER_SELECTOR, app).forEach(observeCounter);

  document.addEventListener('visibilitychange', () => {
    app.classList.toggle('v3g-effects-paused', document.visibilityState !== 'visible');
    if (document.visibilityState !== 'visible') {
      if (confettiFrame) cancelAnimationFrame(confettiFrame);
      confettiFrame = 0;
      if (confettiCanvas) confettiCanvas.remove();
      confettiCanvas = null;
    }
  });

  window.V3GAMDepthEffects = Object.freeze({
    useTilt,
    useParallax(element, targetSelector, factor) {
      if (!element || reducedMotion || !finePointer) return () => {};
      const target = targetSelector ? $(targetSelector, element) : element;
      if (!target) return () => {};
      const scale = Number(factor || 12);
      const move = event => {
        const r=element.getBoundingClientRect();
        if (!r.width||!r.height) return;
        target.style.setProperty('--v3g-parallax-x',(((event.clientX-r.left)/r.width-.5)*scale).toFixed(2)+'px');
        target.style.setProperty('--v3g-parallax-y',(((event.clientY-r.top)/r.height-.5)*scale).toFixed(2)+'px');
      };
      const reset = () => {target.style.setProperty('--v3g-parallax-x','0px');target.style.setProperty('--v3g-parallax-y','0px')};
      element.addEventListener('pointermove',move,{passive:true});element.addEventListener('pointerleave',reset,{passive:true});
      return () => {element.removeEventListener('pointermove',move);element.removeEventListener('pointerleave',reset);};
    },
    useCountUp,
    TiltCard(element) { useTilt(element); return element; },
    GlowButton(element) { addButtonSweep(element); return element; },
    GlossyIconTile(element) { addIconSpecular(element); return element; },
    ConfettiBurst: runConfetti,
    refresh() { enhance(app); }
  });
})();