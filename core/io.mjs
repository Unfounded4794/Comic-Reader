export function abortError() { return Object.assign(new Error('Operation cancelled.'), { name: 'AbortError', code: 'ABORT_ERR' }); }
export function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
export function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) { promise.catch(() => {}); return Promise.reject(abortError()); }
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError()); signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export function limitConcurrency(concurrency) {
  const waiting = []; let active = 0;
  function pump() {
    while (active < concurrency && waiting.length) {
      const { fn, signal, resolve, reject } = waiting.shift();
      if (signal?.aborted) { reject(abortError()); continue; }
      active++;
      Promise.resolve().then(() => { checkAbort(signal); return fn(); }).then(resolve, reject).finally(() => { active--; pump(); });
    }
  }
  return (fn, signal) => new Promise((resolve, reject) => { waiting.push({ fn, signal, resolve, reject }); pump(); });
}
