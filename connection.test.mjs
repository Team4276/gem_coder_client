import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const page = await readFile(new URL('./index.html', import.meta.url), 'utf8');
function client(fetch) {
  const timers = new Map();
  const events = {};
  let id = 0;
  const context = vm.createContext({
    fetch, AbortController, config: { baseUrl: 'http://server/v1', model: 'gem', apiKey: '', companionUrl: 'http://local', companionToken: '' },
    navigator: { onLine: true }, document: { addEventListener() {} },
    window: { addEventListener(name, fn) { events[name] = fn; } },
    setTimeout(fn, delay) { timers.set(++id, { fn, delay }); return id; },
    clearTimeout(key) { timers.delete(key); },
    normalizeUrl: value => value, companionHeaders: () => ({}),
    workspaceInfo: null, updateWorkspaceUI() {}, updateSkillAutocomplete() {},
    setStatus(state, text) { context.status = text; }
  });
  vm.runInContext(page.slice(page.indexOf('      // Health checks'), page.indexOf('      function autoResize')), context);
  vm.runInContext(page.slice(page.indexOf('      var workspaceRefresh'), page.indexOf('      async function workspaceTool')), context);
  return { context, timers, events };
}
const response = data => ({ ok: true, json: async () => data });

test('network failure retries with backoff and restores server and project', async () => {
  let available = false;
  const { context, timers } = client(async url => {
    if (!available) throw new TypeError('Failed to fetch');
    return response(url.endsWith('/models') ? { data: [{ id: 'gem' }] } : { workspace: 'Robot', skills: [] });
  });
  await context.checkConnections();
  assert.equal(context.status, 'Reconnecting…');
  assert.equal(context.workspaceInfo, null);
  let timer = [...timers.values()][0];
  assert.equal(timer.delay, 1000);
  timers.clear();
  await timer.fn();
  timer = [...timers.values()][0];
  assert.equal(timer.delay, 2000);
  timers.clear();
  available = true;
  await timer.fn();
  assert.equal(context.status, 'Connected');
  assert.equal(context.workspaceInfo.workspace, 'Robot');
  assert.equal([...timers.values()][0].delay, 30000);
});

test('online event immediately checks again and stale checks cannot overwrite recovery', async () => {
  const pending = [];
  const { context, events, timers } = client(url => new Promise(resolve => pending.push({ url, resolve })));
  const old = context.checkConnections();
  events.online();
  assert.equal(pending.length, 4);
  for (const item of pending.slice(2)) item.resolve(response(item.url.endsWith('/models') ? { data: [{ id: 'gem' }] } : { workspace: 'Recovered' }));
  await new Promise(resolve => setImmediate(resolve));
  for (const item of pending.slice(0, 2)) item.resolve(response({}));
  await old;
  assert.equal(context.status, 'Connected');
  assert.equal(context.workspaceInfo.workspace, 'Recovered');
  assert.equal(timers.size, 1);
});

test('hung health checks time out and schedule another attempt', async () => {
  const { context, timers } = client((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('Timed out')));
  }));
  const check = context.checkConnections();
  for (const timer of [...timers.values()]) {
    assert.equal(timer.delay, 5000);
    timer.fn();
  }
  await check;
  assert.equal(context.status, 'Reconnecting…');
  assert.equal([...timers.values()][0].delay, 1000);
});

test('the complete browser script parses', () => {
  new vm.Script(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
});
