#!/usr/bin/env node
/**
 * Gem Coder Workspace Companion
 *
 * Runs on a student's computer and exposes a deliberately small, token-protected
 * API to the local Gem Coder browser UI. It never listens on the LAN.
 */
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
function option(name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}
const workspaceArg = option('--workspace');
const port = Number(option('--port', '8787'));
const suppliedToken = option('--token');
const serveApp = args.includes('--serve-app');
const openBrowser = args.includes('--open');
let workspaceRoot = workspaceArg ? await fs.realpath(path.resolve(workspaceArg)) : null;
const docsArg = option('--wpilib-docs');
const wpilibDocsRoot = docsArg ? await fs.realpath(path.resolve(docsArg)) : null;
const token = suppliedToken || randomBytes(24).toString('base64url');
const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const appFile = path.join(appDirectory, 'index.html');
const folderPickerScript = path.join(appDirectory, 'pick-folder.ps1');
const bundledSkillsRoot = path.join(appDirectory, 'bundled-skills');
const defaultDataRoot = process.platform === 'win32'
  ? (process.env.LOCALAPPDATA || process.env.APPDATA || appDirectory)
  : (process.env.XDG_DATA_HOME || path.join(process.env.HOME || appDirectory, '.local', 'share'));
const skillsRoot = path.resolve(option('--skills-dir', path.join(defaultDataRoot, 'GemCoder', 'skills')));
const ignoredDirectories = new Set(['.git', 'node_modules', '.gradle', 'build', 'out', 'dist', '.idea', '.vscode']);
const maxFileBytes = 300_000;
const maxResults = 120;
const maxSkillFiles = 200;
const maxSkillBytes = 5_000_000;
const allowedOrigins = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const appOrigin = 'http://127.0.0.1:' + port;
const appOrigins = new Set([appOrigin, 'http://localhost:' + port]);

await fs.mkdir(skillsRoot, { recursive: true });

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function hash(content) { return createHash('sha256').update(content).digest('hex'); }
function isText(content) { return !content.subarray(0, 4096).includes(0); }
function json(response, status, payload, origin) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origin || 'null',
    'access-control-allow-headers': 'content-type, x-gem-coder-token',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}
function error(response, status, message, origin) { json(response, status, { error: message }, origin); }
function requestOrigin(request) {
  const origin = request.headers.origin;
  return typeof origin === 'string' && allowedOrigins.test(origin) ? origin : null;
}
async function selectWorkspace(directory) {
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('Choose a project folder first.');
  const resolved = await fs.realpath(path.resolve(directory));
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) throw new Error('That path is not a folder.');
  workspaceRoot = resolved;
  return { workspace: path.basename(workspaceRoot), path: workspaceRoot };
}
function requireWorkspace() {
  if (!workspaceRoot) throw new Error('Choose a project folder before using local tools.');
  return workspaceRoot;
}
function chooseFolderOnWindows(title = 'Choose your project folder', okLabel = 'Choose folder', pickFile = false, fileName = '') {
  if (process.platform !== 'win32') throw new Error('Enter the folder path on this computer.');
  return new Promise((resolve, reject) => {
    const pickerArgs = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', folderPickerScript, '-Title', title, '-OkLabel', okLabel];
    if (pickFile) pickerArgs.push('-PickFile', '-FileName', fileName);
    execFile('powershell.exe', pickerArgs, { windowsHide: true }, (error, stdout) => {
      if (error) { reject(error); return; }
      resolve(stdout.trim());
    });
  });
}
async function serveWebApp(response) {
  const page = await fs.readFile(appFile);
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(page);
}
async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new Error('Request body must be valid JSON.'); }
}
async function resolveExisting(relativePath, root = workspaceRoot) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) throw new Error('A workspace-relative path is required.');
  const candidate = path.resolve(root, relativePath);
  if (!within(root, candidate)) throw new Error('Path is outside the selected workspace.');
  const real = await fs.realpath(candidate);
  if (!within(root, real)) throw new Error('Symlinks outside the selected workspace are not allowed.');
  return real;
}
async function resolveWriteTarget(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) throw new Error('A workspace-relative path is required.');
  const target = path.resolve(workspaceRoot, relativePath);
  if (!within(workspaceRoot, target)) throw new Error('Path is outside the selected workspace.');
  const parent = await fs.realpath(path.dirname(target));
  if (!within(workspaceRoot, parent)) throw new Error('Write target is outside the selected workspace.');
  return target;
}
async function resolveDirectory(root, relativePath = '.') {
  const candidate = path.resolve(root, relativePath || '.');
  if (!within(root, candidate)) throw new Error('Path is outside the selected workspace.');
  const real = await fs.realpath(candidate);
  if (!within(root, real)) throw new Error('Symlinks outside the selected workspace are not allowed.');
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) throw new Error('The requested path is not a folder.');
  return real;
}
async function walk(root, relative = '', results = [], limit = maxResults) {
  if (results.length >= limit) return results;
  const directory = await fs.opendir(path.join(root, relative));
  for await (const entry of directory) {
    if (results.length >= limit) break;
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await walk(root, path.join(relative, entry.name), results, limit);
    } else if (entry.isFile()) {
      results.push(path.join(relative, entry.name).split(path.sep).join('/'));
    }
  }
  return results;
}
async function readText(root, relativePath) {
  const fullPath = await resolveExisting(relativePath, root);
  const stat = await fs.stat(fullPath);
  if (stat.size > maxFileBytes) throw new Error('File is larger than 300 KB. Narrow the request first.');
  const buffer = await fs.readFile(fullPath);
  if (!isText(buffer)) throw new Error('Binary files cannot be sent to the model.');
  return { path: path.relative(root, fullPath).split(path.sep).join('/'), content: buffer.toString('utf8'), sha256: hash(buffer) };
}
function yamlScalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(trimmed[0] === '"' ? /\\"/g : /''/g, trimmed[0]);
  }
  return trimmed;
}
function parseSkillManifest(content) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|\s*$)/);
  if (!match) throw new Error('SKILL.md must start with YAML front matter enclosed by --- lines.');
  const lines = match[1].split(/\r?\n/);
  const values = {};
  for (let index = 0; index < lines.length; index += 1) {
    const field = lines[index].match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!field) continue;
    if ((field[2] === '>' || field[2] === '>-' || field[2] === '|' || field[2] === '|-')) {
      const parts = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) parts.push(lines[index += 1].trim());
      values[field[1]] = parts.join(field[2].startsWith('|') ? '\n' : ' ');
    } else values[field[1]] = yamlScalar(field[2]);
  }
  const name = values.name || '';
  const description = values.description || '';
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error('Skill name must use 1-64 lowercase letters, numbers, or hyphens.');
  if (!description.trim()) throw new Error('SKILL.md front matter must include a description.');
  if (description.length > 1_000) throw new Error('Skill description must be 1,000 characters or fewer.');
  return { name, description: description.trim() };
}
async function loadSkill(directory) {
  const manifestPath = path.join(directory, 'SKILL.md');
  const stat = await fs.stat(manifestPath);
  if (!stat.isFile()) throw new Error('SKILL.md must be a file.');
  if (stat.size > maxFileBytes) throw new Error('SKILL.md is larger than 300 KB.');
  const manifest = await fs.readFile(manifestPath, 'utf8');
  return parseSkillManifest(manifest);
}
async function listSkillsIn(root, bundled) {
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try { skills.push({ ...await loadSkill(path.join(root, entry.name)), bundled }); } catch { /* Ignore incomplete folders. */ }
  }
  return skills;
}
async function listSkills() {
  const skillsByName = new Map();
  for (const skill of await listSkillsIn(bundledSkillsRoot, true)) skillsByName.set(skill.name.toLowerCase(), skill);
  for (const skill of await listSkillsIn(skillsRoot, false)) {
    if (!skillsByName.has(skill.name.toLowerCase())) skillsByName.set(skill.name.toLowerCase(), skill);
  }
  return [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
}
async function scanSkillSource(root, relative = '', files = [], totals = { bytes: 0 }) {
  const directory = await fs.opendir(path.join(root, relative));
  for await (const entry of directory) {
    const entryRelative = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Skill folders cannot contain symbolic links.');
    if (entry.isDirectory()) await scanSkillSource(root, entryRelative, files, totals);
    else if (entry.isFile()) {
      const stat = await fs.stat(path.join(root, entryRelative));
      files.push(entryRelative);
      totals.bytes += stat.size;
      if (files.length > maxSkillFiles) throw new Error('Skill contains more than 200 files.');
      if (totals.bytes > maxSkillBytes) throw new Error('Skill is larger than 5 MB.');
    }
  }
  return files;
}
async function installSkill(selectedPath) {
  if (typeof selectedPath !== 'string' || !selectedPath.trim()) throw new Error('Choose a SKILL.md file first.');
  const selected = await fs.realpath(path.resolve(selectedPath));
  const selectedStat = await fs.stat(selected);
  if (selectedStat.isFile() && path.basename(selected).toLowerCase() !== 'skill.md') throw new Error('The selected file must be named SKILL.md.');
  if (!selectedStat.isFile() && !selectedStat.isDirectory()) throw new Error('The selected skill path must be a SKILL.md file.');
  const source = selectedStat.isFile() ? path.dirname(selected) : selected;
  const metadata = await loadSkill(source);
  const files = await scanSkillSource(source);
  const destination = path.join(skillsRoot, metadata.name);
  if (within(skillsRoot, source) || within(source, skillsRoot)) throw new Error('Choose a skill folder outside the Gem Coder skills store.');
  const installedNames = (await listSkills()).map((skill) => skill.name.toLowerCase());
  if (installedNames.includes(metadata.name.toLowerCase())) throw new Error('A skill named ' + metadata.name + ' is already installed.');
  try {
    await fs.access(destination);
    throw new Error('A skill folder named ' + metadata.name + ' already exists in the skills store.');
  } catch (caught) {
    if (caught.code !== 'ENOENT') throw caught;
  }
  const temporary = path.join(skillsRoot, '.' + metadata.name + '-' + randomBytes(6).toString('hex'));
  try {
    await fs.mkdir(temporary);
    for (const relativeFile of files) {
      const target = path.join(temporary, relativeFile);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(source, relativeFile), target);
    }
    await fs.rename(temporary, destination);
  } catch (caught) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw caught;
  }
  return metadata;
}
async function resolveSkill(name) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error('A valid skill name is required.');
  for (const root of [bundledSkillsRoot, skillsRoot]) {
    const directory = path.join(root, name);
    try {
      const real = await fs.realpath(directory);
      if (!within(root, real)) throw new Error('Skill path is outside the skills store.');
      return real;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('Skill not found: ' + name);
}
async function removeSkill(name) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error('A valid skill name is required.');
  const directory = path.join(skillsRoot, name);
  let real;
  try { real = await fs.realpath(directory); }
  catch (error) {
    if (error.code === 'ENOENT' && (await listSkillsIn(bundledSkillsRoot, true)).some((skill) => skill.name === name)) {
      throw new Error('Bundled skills cannot be removed.');
    }
    throw error;
  }
  if (!within(skillsRoot, real)) throw new Error('Skill path is outside the skills store.');
  const metadata = await loadSkill(real);
  await fs.rm(real, { recursive: true, force: false });
  return metadata;
}
async function searchText(root, query, relativePath = '.', max = 40) {
  if (typeof query !== 'string' || query.trim().length < 2) throw new Error('Search query must contain at least two characters.');
  const start = path.resolve(root, relativePath || '.');
  if (!within(root, start)) throw new Error('Search path is outside the selected workspace.');
  const realStart = await fs.realpath(start);
  if (!within(root, realStart)) throw new Error('Search path is outside the selected workspace.');
  const files = await walk(realStart, '', [], 450);
  const needle = query.toLowerCase();
  const matches = [];
  for (const relativeFile of files) {
    if (matches.length >= max) break;
    const fullPath = path.join(realStart, relativeFile);
    const stat = await fs.stat(fullPath);
    if (stat.size > maxFileBytes) continue;
    const buffer = await fs.readFile(fullPath);
    if (!isText(buffer)) continue;
    const lines = buffer.toString('utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (matches.length < max && line.toLowerCase().includes(needle)) {
        matches.push({ path: path.relative(root, fullPath).split(path.sep).join('/'), line: index + 1, text: line.slice(0, 360) });
      }
    });
  }
  return matches;
}
function runGradleBuild() {
  return new Promise(async (resolve, reject) => {
    const candidate = process.platform === 'win32' ? path.join(workspaceRoot, 'gradlew.bat') : path.join(workspaceRoot, 'gradlew');
    try { await fs.access(candidate); } catch { reject(new Error('No Gradle wrapper was found at the workspace root.')); return; }
    const child = spawn(candidate, ['build'], { cwd: workspaceRoot, shell: process.platform === 'win32', windowsHide: true });
    let output = '';
    const append = (chunk) => { if (output.length < 200_000) output += chunk.toString('utf8'); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const timer = setTimeout(() => child.kill(), 300_000);
    child.on('error', reject);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ exitCode: code, signal, output: output.slice(-200_000) }); });
  });
}
async function executeTool(name, input) {
  switch (name) {
    case 'list_skills': return { skills: await listSkills() };
    case 'read_skill': return await readText(await resolveSkill(input.name), 'SKILL.md');
    case 'read_skill_file': return await readText(await resolveSkill(input.name), input.path);
  }
  requireWorkspace();
  switch (name) {
    case 'list_files': {
      const start = await resolveDirectory(workspaceRoot, input.path || '.');
      const relativeStart = path.relative(workspaceRoot, start);
      return { files: await walk(workspaceRoot, relativeStart, [], Math.min(Number(input.max_results) || maxResults, maxResults)) };
    }
    case 'read_file': return await readText(workspaceRoot, input.path);
    case 'search_code': return { matches: await searchText(workspaceRoot, input.query, input.path || '.', Math.min(Number(input.max_results) || 40, maxResults)) };
    case 'write_file': {
      if (typeof input.content !== 'string') throw new Error('write_file requires string content.');
      if (Buffer.byteLength(input.content, 'utf8') > 500_000) throw new Error('Proposed file content is too large.');
      const target = await resolveWriteTarget(input.path);
      let previous = null;
      try { previous = await fs.readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (previous && !input.expected_sha256) throw new Error('Existing files require expected_sha256. Re-read the file before applying this edit.');
      if (input.expected_sha256 && (!previous || hash(previous) !== input.expected_sha256)) throw new Error('File changed since it was read. Re-read it before applying this edit.');
      await fs.writeFile(target, input.content, 'utf8');
      return { path: path.relative(workspaceRoot, target).split(path.sep).join('/'), sha256: hash(input.content), message: 'File written after user approval.' };
    }
    case 'run_wpilib_build': return await runGradleBuild();
    case 'search_wpilib_docs': {
      if (!wpilibDocsRoot) throw new Error('WPILib documentation is not configured. Restart companion with --wpilib-docs <folder>.');
      return { matches: await searchText(wpilibDocsRoot, input.query, input.path || '.', Math.min(Number(input.max_results) || 30, maxResults)) };
    }
    default: throw new Error('Unsupported tool: ' + name);
  }
}

const server = createServer(async (request, response) => {
  const origin = requestOrigin(request);
  if (serveApp && request.method === 'GET' && (request.url === '/' || request.url === '/index.html')) {
    try { await serveWebApp(response); } catch { error(response, 500, 'Could not load the Gem Coder app.', null); }
    return;
  }
  if (request.headers.origin && (!origin || (serveApp && !appOrigins.has(origin)))) { error(response, 403, 'This companion accepts requests only from its own local app.', null); return; }
  if (request.method === 'OPTIONS') { json(response, 204, {}, origin); return; }
  if (!serveApp && request.headers['x-gem-coder-token'] !== token) { error(response, 401, 'Invalid workspace token.', origin); return; }
  try {
    if (request.method === 'GET' && request.url === '/health') {
      const workspaceTools = workspaceRoot ? ['list_files', 'read_file', 'search_code', 'write_file', 'run_wpilib_build'] : [];
      if (workspaceRoot && wpilibDocsRoot) workspaceTools.push('search_wpilib_docs');
      json(response, 200, { workspace: workspaceRoot ? path.basename(workspaceRoot) : null, wpilibDocs: Boolean(wpilibDocsRoot), skills: await listSkills(), tools: ['list_skills', 'read_skill', 'read_skill_file', ...workspaceTools] }, origin);
      return;
    }
    if (request.method === 'GET' && request.url === '/skills') {
      json(response, 200, { skills: await listSkills() }, origin);
      return;
    }
    if (serveApp && request.method === 'POST' && request.url === '/choose-folder') {
      const selectedPath = await chooseFolderOnWindows();
      if (!selectedPath) throw new Error('No folder was selected.');
      json(response, 200, { path: selectedPath }, origin);
      return;
    }
    if (serveApp && request.method === 'POST' && request.url === '/choose-skill-file') {
      const selectedPath = await chooseFolderOnWindows('Choose a SKILL.md file', 'Choose skill', true, 'SKILL.md');
      if (!selectedPath) throw new Error('No skill file was selected.');
      json(response, 200, { path: selectedPath }, origin);
      return;
    }
    if (serveApp && request.method === 'POST' && request.url === '/skills/install') {
      const body = await readJson(request);
      json(response, 200, { skill: await installSkill(body.path) }, origin);
      return;
    }
    if (serveApp && request.method === 'POST' && request.url === '/skills/remove') {
      const body = await readJson(request);
      json(response, 200, { skill: await removeSkill(body.name) }, origin);
      return;
    }
    if (serveApp && request.method === 'POST' && request.url === '/connect') {
      const body = await readJson(request);
      json(response, 200, { result: await selectWorkspace(body.path) }, origin);
      return;
    }
    if (request.method === 'POST' && request.url === '/tool') {
      const body = await readJson(request);
      const result = await executeTool(body.name, body.input || {});
      json(response, 200, { result }, origin);
      return;
    }
    error(response, 404, 'Not found.', origin);
  } catch (caught) { error(response, 400, caught instanceof Error ? caught.message : 'Request failed.', origin); }
});
server.listen(port, '127.0.0.1', () => {
  console.log('\nGem Coder is running at ' + appOrigin);
  if (workspaceRoot) console.log('Workspace: ' + workspaceRoot);
  console.log('Skills:    ' + skillsRoot);
  if (!serveApp) console.log('Token:     ' + token);
  if (wpilibDocsRoot) console.log('WPILib docs: ' + wpilibDocsRoot);
  if (openBrowser && process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '', appOrigin], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
});
