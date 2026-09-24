import express from 'express';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const app = express();
app.use(express.json({ limit: '1mb' }));

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const generatedDir = path.join(ROOT, 'e2e/.generated/live-runner');

let proc = null;
let state = {
  running: false,
  startedAt: null,
  endedAt: null,
  exitCode: null,
  dashboardPort: 3333,
  deleteAfterFinish: false,
};
const logLines = [];
const sseClients = new Set();

function pushLog(line) {
  const text = String(line ?? '').replace(/\r?\n$/, '');
  if (!text) return;
  logLines.push(`[${new Date().toISOString()}] ${text}`);
  while (logLines.length > 2000) logLines.shift();
  for (const res of sseClients) {
    res.write(`data: ${JSON.stringify({ line: logLines[logLines.length - 1] })}\n\n`);
  }
}

function killProcess() {
  if (!proc) return;
  try {
    proc.kill('SIGTERM');
  } catch {}
}

function cleanupGeneratedArtifacts() {
  if (!fs.existsSync(generatedDir)) return;
  const files = fs.readdirSync(generatedDir);
  for (const file of files) {
    if (file.startsWith('k6-') || file.startsWith('live-runner-') || file.startsWith('live-run-summary-')) {
      try {
        fs.unlinkSync(path.join(generatedDir, file));
      } catch {}
    }
  }
}

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Leapcell Load UI</title>
<style>
body{font-family:ui-sans-serif,system-ui;background:#081225;color:#e5e7eb;margin:0}
header{padding:12px 16px;background:#020617;border-bottom:1px solid #1f2937}
main{display:grid;grid-template-columns:360px 1fr;gap:12px;padding:12px}
.panel{background:#0b1730;border:1px solid #1f2937;border-radius:10px;padding:10px}
label{display:block;font-size:12px;margin-top:8px;color:#93c5fd}
input{width:100%;padding:8px;border-radius:6px;border:1px solid #334155;background:#020617;color:#e5e7eb}
button{margin-top:10px;padding:8px 12px;border:none;border-radius:6px;background:#2563eb;color:white;cursor:pointer}
button.stop{background:#dc2626}
pre{height:240px;overflow:auto;background:#020617;padding:8px;border-radius:6px;border:1px solid #334155}
iframe{width:100%;height:70vh;border:1px solid #334155;border-radius:8px;background:#020617}
.small{font-size:12px;color:#94a3b8}
.row{display:flex;gap:8px}
</style></head>
<body><header><strong>Leapcell Load Control</strong> <span class="small" id="status"></span></header>
<main>
<div class="panel">
<label>Register URL</label><input id="registerUrl" value="" placeholder="https://.../student/<scheduleId>/register" />
<label>Users File</label><input id="usersFile" value="e2e/prod-load/live-users.500.csv" />
<label>Test Mode</label>
<select id="testMode" style="width:100%;padding:8px;border-radius:6px;border:1px solid #334155;background:#020617;color:#e5e7eb">
  <option value="headless">Headless browser UI</option>
  <option value="headed">Chrome UI (visible browsers)</option>
  <option value="hybrid">hybrid (browser + k6)</option>
  <option value="k6">k6 test (API only)</option>
</select>
<div class="row"><div style="flex:1"><label>Browser Students</label><input id="userCount" type="number" min="1" value="100" /></div><div style="flex:1"><label>Browser Student Offset</label><input id="userOffset" type="number" min="0" value="0" /></div></div>
<div class="row"><div style="flex:1"><label>Headed Users</label><input id="headedUsers" value="3" /></div><div style="flex:1"><label>Max Concurrent</label><input id="maxConcurrent" value="10" /></div></div>
<div class="row"><div style="flex:1"><label>Dashboard Port</label><input id="dashboardPort" value="3360" /></div><div style="flex:1"><label>Mode</label><input id="liveMode" value="balanced" /></div></div>
<div class="row"><div style="flex:1"><label>Screenshot ms</label><input id="screenshotMs" value="1000" /></div><div style="flex:1"><label>JPEG Quality</label><input id="jpegQuality" value="45" /></div></div>
<label>k6 Base URL (optional)</label><input id="k6BaseUrl" value="" placeholder="https://your-host" />
<label><input type="checkbox" id="runWithK6" /> Run with k6</label>
<label><input type="checkbox" id="deleteAfterFinish" checked /> Delete artifacts after finish</label>
<label>K6 Students (separate count)</label><input id="k6Students" type="number" min="1" value="195" />
<div class="row"><button id="startBtn">Start</button><button class="stop" id="stopBtn">Stop</button></div>
<label>Logs</label><pre id="logs"></pre>
</div>
<div class="panel">
<div class="small" id="dashLabel">Dashboard not started</div>
<iframe id="dash"></iframe>
</div>
</main>
<script>
const statusEl = document.getElementById('status');
const logsEl = document.getElementById('logs');
const dash = document.getElementById('dash');
const dashLabel = document.getElementById('dashLabel');

function v(id){return document.getElementById(id).value}
function c(id){return document.getElementById(id).checked}

async function refresh(){
  const r = await fetch('/api/state');
  const s = await r.json();
  statusEl.textContent = s.running ? 'RUNNING' : 'IDLE';
  const host = location.hostname || 'localhost';
  const dashUrl = location.protocol + '//' + host + ':' + s.dashboardPort;
  dashLabel.textContent = 'Dashboard: ' + dashUrl;
  dash.src = dashUrl;
}

document.getElementById('startBtn').onclick = async () => {
  const payload = {
    registerUrl:v('registerUrl'), usersFile:v('usersFile'), userCount:Number(v('userCount')), userOffset:Number(v('userOffset')),
    testMode:v('testMode'),
    headedUsers:Number(v('headedUsers')), maxConcurrentUsers:Number(v('maxConcurrent')), dashboardPort:Number(v('dashboardPort')),
    liveMode:v('liveMode'), runWithK6:c('runWithK6'), k6Students:Number(v('k6Students')), deleteAfterFinish:c('deleteAfterFinish'),
    k6BaseUrl:v('k6BaseUrl'), screenshotMs:Number(v('screenshotMs')), jpegQuality:Number(v('jpegQuality'))
  };
  const resp = await fetch('/api/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const data = await resp.json().catch(()=>({}));
  if(!resp.ok){
    alert(data.error || ('Start failed: HTTP ' + resp.status));
    return;
  }
  alert('Started');
  await refresh();
};

document.getElementById('stopBtn').onclick = async ()=>{ await fetch('/api/stop',{method:'POST'}); await refresh(); };

const es = new EventSource('/api/logs');
es.onmessage = (e)=>{ const m = JSON.parse(e.data); logsEl.textContent += m.line + '\n'; logsEl.scrollTop = logsEl.scrollHeight; };
refresh();
setInterval(refresh, 3000);
</script>
</body></html>`);
});

app.get('/api/state', (_req, res) => res.json(state));

app.get('/api/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  sseClients.add(res);
  for (const line of logLines.slice(-200)) {
    res.write(`data: ${JSON.stringify({ line })}\n\n`);
  }
  req.on('close', () => sseClients.delete(res));
});

app.post('/api/start', (req, res) => {
  pushLog(`[api/start] payload=${JSON.stringify(req.body || {})}`);
  if (proc) return res.status(409).json({ error: 'already running' });
  const body = req.body || {};
  const dashboardPort = Number(body.dashboardPort || 3360);
  const testMode = String(body.testMode || 'headed');
  const runWithK6 = testMode === 'hybrid' ? true : Boolean(body.runWithK6);
  const deleteAfterFinish = Boolean(body.deleteAfterFinish);
  const userCount = Number(body.userCount || 100);
  const headedUsers = Number(body.headedUsers || 0);

  const env = {
    ...process.env,
    REGISTER_URL: String(body.registerUrl || ''),
    USERS_FILE: String(body.usersFile || ''),
    USER_COUNT: String(body.userCount || 100),
    USER_OFFSET: String(body.userOffset || 0),
    HEADED_USERS: String(headedUsers),
    MAX_CONCURRENT_USERS: String(body.maxConcurrentUsers || 10),
    DASHBOARD_PORT: String(dashboardPort),
    LIVE_MODE: String(body.liveMode || 'balanced'),
    SCREENSHOT_INTERVAL_MS: String(body.screenshotMs || 1000),
    JPEG_QUALITY: String(body.jpegQuality || 45),
    HEADLESS: testMode === 'headed' ? 'false' : 'true',
    DELETE_ARTIFACTS_ON_FINISH: deleteAfterFinish ? 'true' : 'false',
    RUN_WITH_K6: runWithK6 ? 'true' : 'false',
    K6_CONFIRM_PROD: 'true',
    K6_SCRIPT: 'k6/prod-start-exam-200.js',
    K6_STUDENTS: String(body.k6Students || body.userCount || 100),
    K6_BASE_URL: String(body.k6BaseUrl || ''),
  };
  if (!env.REGISTER_URL && String(body.testMode || 'headed') !== 'k6') {
    return res.status(400).json({ error: 'REGISTER_URL is required.' });
  }
  if (!env.USERS_FILE && String(body.testMode || 'headed') !== 'k6') {
    return res.status(400).json({ error: 'USERS_FILE is required.' });
  }
  if (testMode === 'headless') {
    env.HEADED_USERS = '0';
    env.HEADLESS = 'true';
  } else if (testMode === 'headed') {
    env.HEADLESS = 'false';
    env.HEADED_USERS = String(Math.max(1, headedUsers || userCount));
  } else if (testMode === 'hybrid') {
    env.HEADLESS = 'true';
  } else if (testMode === 'k6') {
    env.HEADLESS = 'true';
    env.HEADED_USERS = '0';
  }

  let cmd = runWithK6 ? ['bun', 'run', 'e2e:live-with-k6'] : ['bun', 'run', 'e2e:live-runner'];
  if (testMode === 'k6') {
    cmd = ['k6', 'run', String(env.K6_SCRIPT || 'k6/prod-start-exam-200.js')];
  }
  try {
    proc = spawn(cmd[0], cmd.slice(1), { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushLog(`[spawn-error] ${message}`);
    return res.status(500).json({ error: message });
  }
  state = { ...state, running: true, startedAt: new Date().toISOString(), endedAt: null, exitCode: null, dashboardPort, deleteAfterFinish };
  pushLog(`[start] ${cmd.join(' ')}`);

  proc.stdout.on('data', (d) => pushLog(d.toString()));
  proc.stderr.on('data', (d) => pushLog(`[stderr] ${d.toString()}`));
  proc.on('exit', (code) => {
    state = { ...state, running: false, endedAt: new Date().toISOString(), exitCode: code ?? 0 };
    pushLog(`[exit] code=${code ?? 0}`);
    proc = null;
    if (state.deleteAfterFinish) cleanupGeneratedArtifacts();
  });

  res.json({ ok: true });
});

app.post('/api/stop', (_req, res) => {
  killProcess();
  res.json({ ok: true });
});

const port = Number(process.env.PORT || process.env.LEAPCELL_LOAD_UI_PORT || 3366);
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`[leapcell-load-ui] http://${host}:${port}`);
});
