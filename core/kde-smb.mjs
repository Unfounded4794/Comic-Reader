import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const runCommand = promisify(execFile);
const disconnected = new Set(['ENOENT', 'ENOTCONN', 'ESTALE', 'EIO', 'ENODEV', 'ETIMEDOUT']);

export function kdeSmbPath(file) {
  if (typeof file !== 'string') return;
  const runtime = process.env.XDG_RUNTIME_DIR;
  const standard = /^(?:\/var)?\/run\/user\/\d+\//.exec(file)?.[0];
  const prefix = standard || (runtime && file.startsWith(`${runtime}/`) ? `${runtime}/` : '');
  if (!prefix) return;
  const match = /^(kio-fuse-[a-z0-9]+\/smb\/([^/?#]+)\/([^/]+))(?:\/(.*))?$/is.exec(file.slice(prefix.length));
  if (!match) return;
  const [, sharePath, authority, share, relative = ''] = match;
  try {
    const url = new URL(`smb://${authority}/${encodeURIComponent(share)}`);
    if (!url.hostname || url.password || relative.split('/').some(part => part === '..')) return;
    return { url: url.href, base: prefix + sharePath, relative };
  } catch { return; }
}

async function mountShare(url) {
  const { stdout } = await runCommand('dbus-send', [
    '--session', '--print-reply', '--reply-timeout=12000', '--type=method_call', '--dest=org.kde.KIOFuse',
    '/org/kde/KIOFuse', 'org.kde.KIOFuse.VFS.mountUrl', `string:${url}`,
  ], { timeout: 13000, maxBuffer: 32768 });
  const mounted = /^\s*string "(\/[^\0\r\n]*)"\s*$/m.exec(stdout)?.[1];
  if (!mounted) throw new Error('KDE did not return a mount path.');
  return mounted;
}

export class KdeSmbPaths {
  constructor({ enabled = process.platform === 'linux', mount = mountShare, stat = fs.stat, onReconnect = () => {} } = {}) {
    this.enabled = enabled;
    this.mount = mount;
    this.stat = stat;
    this.onReconnect = onReconnect;
    this.shares = new Map();
  }

  reference(file) { return this.enabled && kdeSmbPath(file); }

  remember(file) {
    const ref = this.reference(file);
    if (ref) this.shares.set(ref.url, { base: ref.base });
  }

  async run(file, operation) {
    const ref = this.reference(file);
    if (!ref) return operation(file);
    let share = this.shares.get(ref.url);
    if (!share) {
      share = { base: ref.base };
      this.shares.set(ref.url, share);
    }
    const base = share.base;
    try { return await operation(path.posix.join(base, ref.relative)); }
    catch (error) {
      if (!disconnected.has(error.code)) throw error;
      // A missing comic on a healthy mount should still count as a removal.
      if (share.base === base && error.code === 'ENOENT') {
        const present = await this.stat(base).then(() => true, failure => {
          if (!disconnected.has(failure.code)) throw failure;
          return false;
        });
        if (present && share.base === base) throw error;
      }
      if (share.base === base) await this.reconnect(share, ref.url);
      return operation(path.posix.join(share.base, ref.relative));
    }
  }

  async reconnect(share, url) {
    if (!share.pending) {
      if (share.failure && Date.now() < share.retryAfter) throw share.failure;
      share.pending = this.mount(url).then(base => {
        share.base = base;
        share.failure = null;
        this.onReconnect(url);
      }).catch(error => {
        const reason = error.stderr?.trim() || error.message;
        share.failure = new Error(`KDE could not reconnect to ${url}. ${reason}`);
        share.retryAfter = Date.now() + 5000;
        throw share.failure;
      }).finally(() => { share.pending = null; });
    }
    return share.pending;
  }
}
