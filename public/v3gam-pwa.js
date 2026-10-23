/* V3GAM PWA support — uses the existing v63 Settings menu; no replacement dashboard or floating controls. */
(function () {
  'use strict';

  var standalone = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  var ua = window.navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var deferredPrompt = null;
  var installItem = document.getElementById('v3gamPwaInstall');
  var authPanel = document.getElementById('orbitAuth');

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/v3gam-service-worker.js', { scope: '/' })
        .then(function (registration) {
          var pageHadController = !!navigator.serviceWorker.controller;
          var updateNoticeDismissed = false;
          var releaseUpdateAvailable = false;
          var releaseScript = document.querySelector('script[src*="/__hatchable/config.js"]');
          var releaseSrc = releaseScript && (releaseScript.getAttribute('src') || releaseScript.src) || '';
          var loadedReleaseMatch = releaseSrc.match(/[?&]v=([0-9]+)/);
          var loadedRelease = loadedReleaseMatch ? loadedReleaseMatch[1] : '';

          function showUpdatePrompt() {
            if (!standalone || (!registration.waiting && !releaseUpdateAvailable) || !navigator.serviceWorker.controller || updateNoticeDismissed || document.getElementById('v3gamUpdateNotice')) return;
            var notice = document.createElement('aside');
            notice.id = 'v3gamUpdateNotice';
            notice.setAttribute('role', 'status');
            notice.setAttribute('aria-live', 'polite');
            notice.style.cssText = 'position:fixed;left:16px;right:16px;bottom:calc(env(safe-area-inset-bottom, 0px) + 16px);z-index:99999;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px 16px;border:1px solid rgba(137,120,255,.5);border-radius:16px;background:#171922;color:#f4f5f9;box-shadow:0 12px 35px rgba(0,0,0,.32);font:500 14px/1.4 system-ui,sans-serif';

            var message = document.createElement('span');
            message.textContent = 'A new version of V3GAM is ready.';
            var actions = document.createElement('div');
            actions.style.cssText = 'display:flex;align-items:center;gap:8px;margin-left:auto';
            var updateButton = document.createElement('button');
            updateButton.type = 'button';
            updateButton.textContent = 'Update now';
            updateButton.style.cssText = 'min-height:44px;padding:0 16px;border:0;border-radius:10px;background:#8978ff;color:#101116;font:700 13px system-ui,sans-serif;cursor:pointer';
            updateButton.addEventListener('click', function () {
              var waiting = registration.waiting;
              if (!waiting) { window.location.reload(); return; }
              updateButton.disabled = true;
              updateButton.textContent = 'Updating…';
              waiting.postMessage({ type: 'V3GAM_SKIP_WAITING' });
            });
            var dismissButton = document.createElement('button');
            dismissButton.type = 'button';
            dismissButton.textContent = 'Not now';
            dismissButton.setAttribute('aria-label', 'Dismiss update notice');
            dismissButton.style.cssText = 'min-height:44px;padding:0 10px;border:1px solid #55596a;border-radius:10px;background:transparent;color:#f4f5f9;font:600 12px system-ui,sans-serif;cursor:pointer';
            dismissButton.addEventListener('click', function () { updateNoticeDismissed = true; notice.remove(); });
            actions.appendChild(updateButton);
            actions.appendChild(dismissButton);
            notice.appendChild(message);
            notice.appendChild(actions);
            document.body.appendChild(notice);
          }

          function watchInstalling(worker) {
            if (!worker) return;
            worker.addEventListener('statechange', function () {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdatePrompt();
            });
            if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdatePrompt();
          }

          if (registration.waiting) showUpdatePrompt();
          registration.addEventListener('updatefound', function () { watchInstalling(registration.installing); });
          if (registration.installing) watchInstalling(registration.installing);
          navigator.serviceWorker.addEventListener('controllerchange', function () {
            if (pageHadController) window.location.reload();
          });

          function checkReleaseVersion() {
            if (!standalone || !loadedRelease || document.visibilityState !== 'visible' || !navigator.onLine) return;
            fetch('/login', { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' })
              .then(function (response) {
                if (!response.ok) return;
                var etag = response.headers.get('etag') || '';
                var liveReleaseMatch = etag.match(/v([0-9]+)-/);
                if (liveReleaseMatch && liveReleaseMatch[1] !== loadedRelease) {
                  releaseUpdateAvailable = true;
                  showUpdatePrompt();
                }
              })
              .catch(function (error) { console.warn('[V3GAM PWA] Release check failed:', error); });
          }

          function checkForUpdate() {
            if (document.visibilityState === 'visible' && navigator.onLine) {
              registration.update().catch(function (error) { console.warn('[V3GAM PWA] Update check failed:', error); });
              checkReleaseVersion();
            }
          }
          checkForUpdate();
          window.addEventListener('focus', checkForUpdate);
          document.addEventListener('visibilitychange', checkForUpdate);
          window.addEventListener('online', checkForUpdate);
          window.setInterval(checkForUpdate, 30 * 60 * 1000);
        })
        .catch(function (error) {
          console.warn('[V3GAM PWA] Service worker unavailable:', error);
        });
    });
  }

  // Existing installed app: no install option is needed.
  if (standalone || !installItem) return;

  function signedInViewVisible() {
    // The current v63 UI keeps the dashboard in the DOM beneath #orbitAuth.
    // The install item belongs only in Settings once that overlay is hidden.
    return !authPanel || authPanel.hidden;
  }

  function syncInstallItem() {
    installItem.hidden = !signedInViewVisible() || !(isIOS || deferredPrompt);
  }

  installItem.addEventListener('click', async function () {
    if (!signedInViewVisible()) {
      installItem.hidden = true;
      return;
    }

    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        var choice = await deferredPrompt.userChoice;
        deferredPrompt = null;
        if (choice && choice.outcome === 'accepted') installItem.hidden = true;
      } catch (error) {
        console.warn('[V3GAM PWA] Install prompt did not open:', error);
      }
      syncInstallItem();
      return;
    }

    if (isIOS) {
      window.alert('To add V3GAM to your Home Screen:\n\n1. Open this page in Safari.\n2. Tap Share.\n3. Choose “Add to Home Screen”.\n4. Tap Add.');
    }
  });

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    syncInstallItem();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    installItem.hidden = true;
  });

  if (authPanel && 'MutationObserver' in window) {
    new MutationObserver(syncInstallItem).observe(authPanel, {
      attributes: true,
      attributeFilter: ['hidden']
    });
  }

  syncInstallItem();
})();