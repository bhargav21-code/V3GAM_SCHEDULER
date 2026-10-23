/* Supplementary clickjacking guard. The real protection is a server-sent
 * X-Frame-Options / CSP frame-ancestors header; this only covers browsers and
 * hosts where that header is missing. */
(function () {
  'use strict';
  try {
    if (window.top === window.self) return;
  } catch (_) { /* cross-origin access threw: we are framed */ }
  try {
    window.top.location.replace(window.self.location.href);
  } catch (_) {
    // Cannot navigate the parent; blank this page so it cannot be overlaid.
    document.documentElement.style.display = 'none';
  }
})();