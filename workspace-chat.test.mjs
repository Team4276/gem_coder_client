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

test('project context instructions explain mismatches and distinguish general coding help', () => {
  const { context } = client();
  const messages = context.apiMessages({ messages: [{ role: 'user', content: 'Help with my other project' }] });
  assert.match(messages[0].content, /briefly name the connected project and explain the mismatch/);
  assert.match(messages[0].content, /connect the intended project/);
  assert.match(messages[0].content, /general coding questions, answer generally/);
  assert.match(messages[0].content, /Do not infer a mismatch from an unfamiliar subsystem name or a single failed search/);
  assert.match(messages[0].content, /Never apply changes intended for another project/);
});

test('tool exhaustion requests a final summary with the collected results and no more actions', async () => {
  const { context } = client();
  const requests = [];
  let executions = 0;
  context.fulfillTool = async () => { executions++; return { content: 'Inspected elevator target: 42' }; };
  context.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    const message = request.tool_choice === 'none'
      ? { content: 'The inspected target is 42; more investigation is pending.' }
      : { tool_calls: [{ id: String(requests.length), function: { name: 'read_file', arguments: '{"path":"src/Elevator.java"}' } }] };
    return { ok: true, json: async () => ({ choices: [{ message }] }) };
  };
  const answer = {};
  await context.runWorkspaceAgent({ messages: [] }, answer, {});
  assert.equal(executions, 10);
  assert.equal(requests.length, 11);
  const final = requests.at(-1);
  assert.equal(final.tool_choice, 'none');
  assert.equal(final.messages.filter(message => message.role === 'tool').length, 10);
  assert.match(answer.content, /target is 42/);
  assert.match(answer.content, /inspection limit/);
  assert.doesNotMatch(answer.content, /Connection error|Reconnecting/);
});

test('a model that keeps calling tools after exhaustion cannot execute additional actions', async () => {
  const { context } = client();
  let executions = 0;
  context.fulfillTool = async () => { executions++; return { content: 'Read successfully' }; };
  context.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: {
    content: 'Everything is complete.',
    tool_calls: [{ id: 'repeat', function: { name: 'read_file', arguments: '{}' } }],
  } }] }) });
  const answer = {};
  await context.runWorkspaceAgent({ messages: [] }, answer, {});
  assert.equal(executions, 10);
  assert.match(answer.content, /inspection limit/);
  assert.doesNotMatch(answer.content, /Everything is complete/);
});

test('persistent read failures finish honestly without requesting an ungrounded summary', async () => {
  const { context, requests } = client();
  context.fulfillTool = async () => ({ error: 'File not found' });
  const answer = {};
  await context.runWorkspaceAgent({ messages: [] }, answer, {});
  assert.equal(requests.length, 10);
  assert.match(answer.content, /could not successfully read/);
});

test('only connection failures trigger reconnect and the server address action', async () => {
  for (const [error, shouldReconnect] of [
    [new Error('The model did not inspect the connected project as requested.'), false],
    [new SyntaxError('Invalid server response'), false],
    [Object.assign(new Error('Server returned 401'), { status: 401 }), false],
    [new TypeError('Failed to fetch'), true],
    [Object.assign(new Error('Server returned 503'), { status: 503 }), true],
  ]) {
    const chat = { messages: [] };
    let reconnects = 0;
    let actions = 0;
    const context = vm.createContext({
      isSending: false, workspaceInfo: {}, promptEl: { value: '' }, welcomeEl: {},
      sendButton: { classList: { remove() {} } },
      validateSkillReferences: () => null, ensureChat: () => chat,
      hideSkillAutocomplete() {}, saveChats() {}, addMessageElement() {}, autoResize() {}, updateSend() {},
      createThinking: () => ({ querySelector: () => ({}) }), scrollToLatestAnswer() {},
      runWorkspaceAgent: async () => { throw error; }, renderMessageContent() {}, renderHistory() {},
      setStatus() {}, reconnect: () => { reconnects++; }, addServerUpdateAction: () => { actions++; },
    });
    vm.runInContext(page.slice(page.indexOf('      function isConnectionFailure('), page.indexOf('      function updateSend(')), context);
    await context.sendMessage('Explain the elevator');
    assert.equal(reconnects, Number(shouldReconnect));
    assert.equal(actions, Number(shouldReconnect));
    assert.match(chat.messages.at(-1).content, shouldReconnect ? /Connection error/ : /Could not complete this response/);
    assert.equal(context.isSending, false);
  }
});
