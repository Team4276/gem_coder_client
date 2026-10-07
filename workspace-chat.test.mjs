import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const page = await readFile(new URL('./index.html', import.meta.url), 'utf8');
function client({ files = ['src/Elevator.java'], workspace = 'Robot', readFails = false } = {}) {
  const requests = [];
  const listings = [];
  let reads = 0;
  const context = vm.createContext({
    AbortController, config: { baseUrl: 'http://server', model: 'gem', systemPrompt: '' },
    codingOnlyPolicy: 'Only answer coding questions.',
    workspaceInfo: { workspace, tools: ['list_files', 'read_file', 'search_code'], skills: [] },
    agentTools: ['list_files', 'read_file', 'search_code'].map(name => ({ type: 'function', function: { name } })),
    loadExplicitSkills: async () => [], normalizeUrl: value => value, headers: () => ({}),
    async workspaceTool(name, input) { listings.push({ name, input }); return { files }; },
    async fulfillTool() {
      reads += 1;
      if (readFails && reads === 1) return { error: 'File not found' };
      return { content: 'class Elevator { int target = 42; }' };
    },
    async fetch(url, options) {
      const request = JSON.parse(options.body);
      requests.push(request);
      const message = request.tool_choice === 'auto'
        ? { content: 'Elevator target is 42.' }
        : { tool_calls: [{ id: String(requests.length), function: { name: 'read_file', arguments: '{"path":"src/Elevator.java"}' } }] };
      return { ok: true, json: async () => ({ choices: [{ message }] }) };
    }
  });
  vm.runInContext(page.slice(page.indexOf('      async function runWorkspaceAgent('), page.indexOf('      function renderHistory(')), context);
  vm.runInContext(page.slice(page.indexOf('      function apiMessages('), page.indexOf('      function headers(')), context);
  return { context, requests, listings };
}

test('every question names the project, refreshes its files, and reads before answering', async () => {
  const { context, requests, listings } = client();
  const chat = { messages: [{ role: 'user', content: 'What is the elevator target?' }] };
  for (const question of ['What is the elevator target?', 'Why that target?']) {
    chat.messages.push({ role: 'user', content: question });
    const answer = {};
    await context.runWorkspaceAgent(chat, answer, {});
    assert.equal(answer.content, 'Elevator target is 42.');
  }
  assert.equal(listings.length, 2);
  for (const first of [requests[0], requests[2]]) {
    assert.equal(first.tool_choice.function.name, 'read_file');
    assert.match(first.messages[0].content, /Connected project name.*Robot/);
    assert.match(first.messages[0].content, /src\/Elevator.java/);
    assert.match(first.messages[0].content, /before saying you do not know/);
  }
  for (const final of [requests[1], requests[3]]) {
    assert.equal(final.tool_choice, 'auto');
    assert.ok(final.messages.some(message => message.role === 'tool' && message.content.includes('target = 42')));
  }
  assert.equal(chat.messages.some(message => message.role === 'tool'), false);
});

test('an unsuccessful read must be retried before a final answer', async () => {
  const { context, requests } = client({ readFails: true });
  await context.runWorkspaceAgent({ messages: [] }, {}, {});
  assert.equal(requests.length, 3);
  assert.equal(requests[1].tool_choice.function.name, 'read_file');
  assert.equal(requests[2].tool_choice, 'auto');
});

test('empty projects and skills-only companions do not force a nonexistent file read', async () => {
  for (const options of [{ files: [] }, { workspace: null }]) {
    const { context, requests, listings } = client(options);
    await context.runWorkspaceAgent({ messages: [] }, {}, {});
    assert.equal(requests[0].tool_choice, 'auto');
    assert.equal(listings.length, options.workspace === null ? 0 : 1);
    if (options.workspace === null) assert.doesNotMatch(requests[0].messages[0].content, /Connected project name/);
  }
});

test('a model that ignores the mandatory read cannot claim an ungrounded answer', async () => {
  const { context } = client();
  context.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'Unknown subsystem.' } }] }) });
  const answer = {};
  await assert.rejects(context.runWorkspaceAgent({ messages: [] }, answer, {}), /did not inspect/);
  assert.equal(answer.content, undefined);
});

test('project listing failures stop the request instead of silently answering without context', async () => {
  const { context, requests } = client();
  context.workspaceTool = async () => { throw new Error('Companion unreachable'); };
  await assert.rejects(context.runWorkspaceAgent({ messages: [] }, {}, {}), /Companion unreachable/);
  assert.equal(requests.length, 0);
});
