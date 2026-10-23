'use strict';
const retryButton = document.getElementById('offline-retry');
if (retryButton) retryButton.addEventListener('click', () => location.reload());