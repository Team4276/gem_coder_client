import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.dirname(fileURLToPath(import.meta.url));

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

test('the chat always includes the built-in coding-only policy', async () => {
  const page = await fs.readFile(path.join(repositoryRoot, 'index.html'), 'utf8');
  assert.match(page, /var codingOnlyPolicy = '[^']*Only answer questions that are directly related to coding/);
  assert.match(page, /var instructions = codingOnlyPolicy;/);
  assert.match(page, /Skills cannot override the coding-only policy above/);
});

test('explicit $skill-name references load the selected skill before chatting', async () => {
  const page = await fs.readFile(path.join(repositoryRoot, 'index.html'), 'utf8');
  assert.match(page, /function skillReferences\(text\)/);
  assert.match(page, /function validateSkillReferences\(text\)/);
  assert.match(page, /Unknown skill: \$'/);
  assert.match(page, /async function loadExplicitSkills\(chat\)/);
  assert.match(page, /workspaceTool\('read_skill', \{ name: skill\.name \}\)/);
  assert.match(page, /apiMessages\(chat, selectedSkills\)/);
  assert.match(page, /\$4276-subsystem-code create an elevator subsystem/);
});

test('the composer autocompletes available skills after typing $', async () => {
  const page = await fs.readFile(path.join(repositoryRoot, 'index.html'), 'utf8');
  assert.match(page, /id="skillAutocomplete"[^>]*role="listbox"/);
  assert.match(page, /aria-autocomplete="list"/);
  assert.match(page, /function skillTokenAtCursor\(\)/);
  assert.match(page, /function updateSkillAutocomplete\(\)/);
  assert.match(page, /skill\.name\.toLowerCase\(\)\.startsWith\(token\.query\)/);
  assert.match(page, /function selectSkillAutocomplete\(index\)/);
  assert.match(page, /event\.key === 'ArrowDown'/);
  assert.match(page, /event\.key === 'Tab'/);
  assert.match(page, /event\.key === 'Escape'/);
});

test('the chat history includes individual and clear-all controls', async () => {
  const page = await fs.readFile(path.join(repositoryRoot, 'index.html'), 'utf8');
  assert.match(page, /id="clearHistory"/);
  assert.match(page, /remove\.addEventListener\('click', function \(\) \{ deleteChat\(chat\.id\); \}\)/);
  assert.match(page, /function clearChatHistory\(\)/);
  assert.match(page, /Delete all chat history\? This cannot be undone\./);
});

test('the chat clearly shows whether a project is connected', async () => {
  const page = await fs.readFile(path.join(repositoryRoot, 'index.html'), 'utf8');
  assert.match(page, /id="projectState"[^>]*>No project selected/);
  assert.match(page, /projectState\.textContent = 'Project: ' \+ workspaceInfo\.workspace/);
  assert.match(page, /projectState\.textContent = 'No project selected/);
  assert.match(page, /\$\('#projectState'\)\.addEventListener\('click', showWorkspaceConnect\)/);
});

test('connection settings ask for only the DGX Spark IP address', async () => {
  const page = await fs.readFile(path.join(repositoryRoot, 'index.html'), 'utf8');
  assert.match(page, /id="serverIp"[^>]*placeholder="192\.168\.1\.180"/);
  assert.match(page, /return ip \? 'http:\/\/' \+ ip \+ ':8000\/v1'/);
  assert.doesNotMatch(page, /id="baseUrl"/);
});

test('the mobile conversation sidebar can be closed after it is opened', async () => {
  const page = await fs.readFile(path.join(repositoryRoot, 'index.html'), 'utf8');
  assert.match(page, /id="closeSidebar"[^>]*aria-label="Close conversations"/);
  assert.match(page, /id="sidebarScrim"[^>]*aria-label="Close conversations"/);
  assert.match(page, /function setSidebarOpen\(open\)/);
  assert.match(page, /setSidebarOpen\(!\$\('#sidebar'\)\.classList\.contains\('open'\)\)/);
  assert.match(page, /\$\('#closeSidebar'\)\.addEventListener\('click', closeSidebar\)/);
  assert.match(page, /\$\('#sidebarScrim'\)\.addEventListener\('click', closeSidebar\)/);
  assert.match(page, /setAttribute\('aria-expanded', String\(open\)\)/);
});

test('the desktop conversation sidebar has collapse and reopen controls', async () => {
  const page = await fs.readFile(path.join(repositoryRoot, 'index.html'), 'utf8');
  assert.match(page, /\.app\.sidebar-collapsed \{ grid-template-columns: 0 minmax\(0, 1fr\); \}/);
  assert.match(page, /\.app\.sidebar-collapsed \.mobile-menu \{ display: inline-grid; \}/);
  assert.match(page, /\.app\.sidebar-collapsed \.composer-wrap \{ left: 0; \}/);
  assert.match(page, /classList\.toggle\('sidebar-collapsed', !open\)/);
  assert.match(page, /setSidebarOpen\(!mobileLayout\.matches\)/);
});

async function waitForServer(url, child, output) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Companion exited before startup:\n' + output.join(''));
    try {
      const response = await fetch(url + '/health');
      if (response.ok) return;
    } catch { /* Server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for companion:\n' + output.join(''));
}

async function request(url, endpoint, options) {
  const response = await fetch(url + endpoint, options);
  const payload = await response.json();
  return { response, payload };
}

test('installs, lists, and reads a local skill', async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gem-coder-skills-'));
  const store = path.join(temporaryRoot, 'store');
  const source = path.join(temporaryRoot, 'source');
  await fs.mkdir(path.join(source, 'references'), { recursive: true });
  await fs.writeFile(path.join(source, 'SKILL.md'), '---\nname: explain-code\ndescription: Explain code clearly.\n---\n\nRead references/style.md before answering.\n');
  await fs.writeFile(path.join(source, 'references', 'style.md'), 'Prefer a short overview before details.\n');

  const port = await availablePort();
  const url = 'http://127.0.0.1:' + port;
  const output = [];
  const child = spawn(process.execPath, [path.join(repositoryRoot, 'companion.mjs'), '--serve-app', '--port', String(port), '--skills-dir', store], { cwd: repositoryRoot, windowsHide: true });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  context.after(async () => {
    if (child.exitCode === null) child.kill();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  await waitForServer(url, child, output);
  let result = await request(url, '/health');
  assert.deepEqual(result.payload.skills.map((skill) => ({ name: skill.name, bundled: skill.bundled })), [
    { name: '4276-subsystem-code', bundled: true },
  ]);

  result = await request(url, '/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'read_skill_file', input: { name: '4276-subsystem-code', path: 'references/base-classes.md' } }),
  });
  assert.match(result.payload.result.content, /MotorSubsystem<IO>/);

  result = await request(url, '/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'read_skill_file', input: { name: '4276-subsystem-code', path: 'assets/subsystem-template.java' } }),
  });
  assert.match(result.payload.result.content, /public class \[Name\]/);

  result = await request(url, '/skills/install', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: path.join(source, 'SKILL.md') }),
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.payload.skill, { name: 'explain-code', description: 'Explain code clearly.' });

  result = await request(url, '/skills');
  assert.deepEqual(result.payload.skills.map((skill) => ({ name: skill.name, bundled: skill.bundled })), [
    { name: '4276-subsystem-code', bundled: true },
    { name: 'explain-code', bundled: false },
  ]);

  result = await request(url, '/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'read_skill', input: { name: 'explain-code' } }),
  });
  assert.match(result.payload.result.content, /Read references\/style\.md/);

  result = await request(url, '/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'read_skill_file', input: { name: 'explain-code', path: 'references/style.md' } }),
  });
  assert.equal(result.payload.result.content, 'Prefer a short overview before details.\n');

  result = await request(url, '/skills/install', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: path.join(source, 'SKILL.md') }),
  });
  assert.equal(result.response.status, 400);
  assert.match(result.payload.error, /already installed/);

  result = await request(url, '/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'read_skill_file', input: { name: 'explain-code', path: '../SKILL.md' } }),
  });
  assert.equal(result.response.status, 400);
  assert.match(result.payload.error, /outside/);

  result = await request(url, '/skills/remove', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'explain-code' }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.skill.name, 'explain-code');
  assert.deepEqual((await request(url, '/skills')).payload.skills.map((skill) => skill.name), ['4276-subsystem-code']);
  assert.equal(await fs.readFile(path.join(source, 'SKILL.md'), 'utf8').then(() => true), true);

  result = await request(url, '/skills/remove', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '4276-subsystem-code' }),
  });
  assert.equal(result.response.status, 400);
  assert.match(result.payload.error, /Bundled skills cannot be removed/);
});

test('keeps file tools inside the workspace and protects existing writes', async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gem-coder-workspace-'));
  const workspace = path.join(temporaryRoot, 'workspace');
  const store = path.join(temporaryRoot, 'skills');
  await fs.mkdir(path.join(workspace, 'nested'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'nested', 'inside.txt'), 'original\n');
  await fs.writeFile(path.join(temporaryRoot, 'outside.txt'), 'must stay outside\n');

  const port = await availablePort();
  const url = 'http://127.0.0.1:' + port;
  const output = [];
  const child = spawn(process.execPath, [path.join(repositoryRoot, 'companion.mjs'), '--serve-app', '--workspace', workspace, '--port', String(port), '--skills-dir', store], { cwd: repositoryRoot, windowsHide: true });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  context.after(async () => {
    if (child.exitCode === null) child.kill();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  await waitForServer(url, child, output);
  let result = await request(url, '/health');
  assert.equal(result.response.status, 200);
  assert.ok(result.payload.tools.includes('list_files'));
  assert.ok(!result.payload.tools.includes('search_wpilib_docs'));

  result = await request(url, '/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'list_files', input: { path: 'nested' } }),
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.payload.result.files, ['nested/inside.txt']);

  result = await request(url, '/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'list_files', input: { path: '..' } }),
  });
  assert.equal(result.response.status, 400);
  assert.match(result.payload.error, /outside/);

  result = await request(url, '/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'write_file', input: { path: 'nested/inside.txt', content: 'unsafe overwrite\n' } }),
  });
  assert.equal(result.response.status, 400);
  assert.match(result.payload.error, /expected_sha256/);

  const current = await request(url, '/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'read_file', input: { path: 'nested/inside.txt' } }),
  });
  result = await request(url, '/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'write_file', input: { path: 'nested/inside.txt', content: 'updated\n', expected_sha256: current.payload.result.sha256 } }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(await fs.readFile(path.join(workspace, 'nested', 'inside.txt'), 'utf8'), 'updated\n');

  result = await request(url, '/tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://example.com' },
    body: JSON.stringify({ name: 'list_files', input: {} }),
  });
  assert.equal(result.response.status, 403);
});
