window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const request = event.data;
  if (!request || request.type !== 'oportuna-extension:ping' || typeof request.nonce !== 'string') return;
  window.postMessage({ type: 'oportuna-extension:pong', nonce: request.nonce }, window.location.origin);
});
