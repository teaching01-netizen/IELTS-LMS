import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import express from 'express';
import { parseLiveSatControlConfig } from './live-sat-control';

const ROOT = process.cwd();
const app = express();
app.use(express.json({ limit: '16kb' }));

interface RunState {
  running: boolean;
  status: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'finished' | 'failed';
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  pid: number | null;
  monitorPort: number;
  accessLinkId: string | null;
  error: string | null;
}

const monitorPort = Number(process.env['SAT_MONITOR_PORT'] ?? '3334');
let state: RunState = {
  running: false,
  status: 'idle',
  startedAt: null,
  endedAt: null,
  exitCode: null,
  pid: null,
  monitorPort,
  accessLinkId: null,
  error: null,
};
let child: ChildProcess | null = null;
const logLines: string[] = [];
const sseClients = new Set<express.Response>();

function pushLog(line: string): void {
  const text = String(line ?? '').replace(/\r?\n$/, '');
  if (!text) return;
  logLines.push(`[${new Date().toISOString()}] ${text}`);
  while (logLines.length > 1000) logLines.shift();
  const event = `data: ${JSON.stringify({ line: logLines[logLines.length - 1] })}\n\n`;
  for (const client of sseClients) client.write(event);
}

function requestIsSameOrigin(req: express.Request): boolean {
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

function controlPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SAT Live Test Control</title>
<style>
:root{color-scheme:dark;--bg:#0b1020;--panel:#121a2c;--line:#26334a;--text:#eef3fc;--muted:#9baac0;--blue:#82b5ff;--red:#ff9a9a;--green:#86dbb1}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 24px;border-bottom:1px solid var(--line);background:#0e1627;position:sticky;top:0;z-index:2}
h1{font-size:18px;line-height:1.2;margin:0;letter-spacing:-.02em}header p{margin:4px 0 0;color:var(--muted);font-size:12px}.badge{border:1px solid var(--line);border-radius:99px;padding:5px 10px;color:var(--muted);font-size:12px;white-space:nowrap}.badge[data-status="running"]{color:var(--green);border-color:#27634a}.badge[data-status="failed"]{color:var(--red);border-color:#733d43}
main{display:grid;grid-template-columns:minmax(320px,390px) minmax(0,1fr);gap:16px;padding:16px;max-width:1800px;margin:auto}.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;min-width:0}.settings{padding:18px}.section-title{font-size:13px;font-weight:700;margin:0 0 14px}.field{margin:0 0 12px}.field label{display:block;color:#c7d2e3;font-size:12px;font-weight:600;margin-bottom:5px}.field input{width:100%;min-height:40px;border:1px solid #3a4962;border-radius:7px;background:#0a1222;color:var(--text);padding:8px 10px;font:inherit;font-size:13px}.field input:focus-visible,button:focus-visible{outline:3px solid #82b5ff;outline-offset:2px}.field small{display:block;color:var(--muted);font-size:11px;margin-top:4px}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.actions{display:flex;gap:8px;margin-top:16px}.actions button{min-height:42px;border:0;border-radius:8px;padding:0 16px;color:#08101f;background:var(--blue);font-weight:700;cursor:pointer}.actions button.stop{background:#5b2932;color:#ffd6d6}.actions button:disabled{opacity:.45;cursor:not-allowed}.hint{border-left:2px solid #5877a4;padding:2px 0 2px 10px;color:var(--muted);font-size:11px;margin:12px 0 0}.state{min-height:22px;font-size:12px;color:var(--muted);margin:12px 0 0}.state[role="alert"]{color:var(--red)}
.monitor-wrap{display:flex;flex-direction:column;min-height:calc(100vh - 112px);overflow:hidden}.monitor-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--line);font-size:12px}.monitor-head a{color:var(--blue)}iframe{flex:1;width:100%;min-height:540px;border:0;background:#0b1220}.logs{height:145px;overflow:auto;border-top:1px solid var(--line);padding:10px 12px;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#b3c1d5;white-space:pre-wrap;overflow-wrap:anywhere}.empty{display:grid;place-items:center;min-height:540px;padding:24px;color:var(--muted);text-align:center}
@media(max-width:900px){main{grid-template-columns:1fr}.monitor-wrap{min-height:70vh}iframe,.empty{min-height:55vh}}@media(max-width:480px){header{padding:14px}.row{grid-template-columns:1fr 1fr}main{padding:10px;gap:10px}.settings{padding:14px}}
</style></head><body>
<header><div><h1>SAT live test</h1><p>Configure headless students and watch their sessions.</p></div><span class="badge" id="run-status" data-status="idle">IDLE</span></header>
<main>
<section class="panel settings" aria-labelledby="settings-title"><h2 class="section-title" id="settings-title">Run settings</h2>
<form id="settings-form" method="post" action="/api/start" novalidate aria-describedby="state-message">
<div class="field"><label for="join-url">SAT Student Link URL</label><input id="join-url" name="joinUrl" type="url" required value="https://ielts-warwick-institute.up.railway.app/join/623c75cf-f380-4ae1-b54c-f55b77af53ec" placeholder="https://host/join/accessLinkId" autocomplete="url" aria-describedby="join-url-help"><small id="join-url-help">Use the shared /join/:accessLinkId URL. You can change this value.</small></div>
<div class="field"><label for="users-file">Student roster file</label><input id="users-file" name="usersFile" required value="e2e/prod-load/live-users.500.csv"><small>CSV columns: userId,email,password,candidateId.</small></div>
<div class="row"><div class="field"><label for="user-count">Total students</label><input id="user-count" name="userCount" type="number" min="1" max="500" value="100" required></div><div class="field"><label for="user-offset">Roster offset</label><input id="user-offset" name="userOffset" type="number" min="0" value="0" required></div></div>
<div class="field"><label for="concurrency">Concurrent headless browsers</label><input id="concurrency" name="maxConcurrentUsers" type="number" min="1" max="100" value="15" required><small>Higher concurrency increases local memory use and production admission pressure.</small></div>
<div class="row"><div class="field"><label for="screenshot-ms">Screenshot interval (ms)</label><input id="screenshot-ms" name="screenshotIntervalMs" type="number" min="250" max="60000" step="250" value="5000" required></div><div class="field"><label for="jpeg-quality">JPEG quality</label><input id="jpeg-quality" name="jpegQuality" type="number" min="10" max="90" value="30" required></div></div>
<div class="row"><div class="field"><label for="start-timeout">Wait for proctor (minutes)</label><input id="start-timeout" name="startTimeoutMinutes" type="number" min="1" max="60" value="20" required></div><div class="field"><label for="exam-timeout">Exam timeout (minutes)</label><input id="exam-timeout" name="examTimeoutMinutes" type="number" min="1" max="240" value="150" required></div></div>
<p class="hint">Browsers always run headless. The monitor appears after starting. Start the SAT session from the proctor UI; bots wait until it is live.</p>
<div class="actions"><button id="start-button" type="submit">Start students</button><button id="stop-button" class="stop" type="button" disabled>Stop all</button></div>
<p id="state-message" class="state" role="status" aria-live="polite"></p>
</form></section>
<section class="panel monitor-wrap" aria-label="Live student monitor"><div class="monitor-head"><strong>Live monitor</strong><a id="open-monitor" href="#" target="_blank" rel="noreferrer" hidden>Open monitor in new tab</a></div><div class="empty" id="monitor-empty">Set the run options, then choose <strong>Start students</strong>.</div><iframe id="monitor" title="SAT bot browser monitor" hidden></iframe><pre class="logs" id="logs" aria-label="Runner log"></pre></section>
</main>
<script>
const form=document.getElementById('settings-form'),startButton=document.getElementById('start-button'),stopButton=document.getElementById('stop-button'),statusBadge=document.getElementById('run-status'),message=document.getElementById('state-message'),monitor=document.getElementById('monitor'),empty=document.getElementById('monitor-empty'),openMonitor=document.getElementById('open-monitor'),logs=document.getElementById('logs');
function monitorUrl(port){return location.protocol+'//'+location.hostname+':'+port}
function renderState(s){statusBadge.textContent=String(s.status||'idle').toUpperCase();statusBadge.dataset.status=s.status||'idle';startButton.disabled=Boolean(s.running);stopButton.disabled=!s.running;message.textContent=s.error||'';message.setAttribute('role',s.error?'alert':'status');if(s.running||s.status==='finished'||s.status==='failed'){const url=monitorUrl(s.monitorPort);if(monitor.src!==url)monitor.src=url;monitor.hidden=false;empty.hidden=true;openMonitor.href=url;openMonitor.hidden=false}}
async function refresh(){try{const response=await fetch('/api/state');if(response.ok)renderState(await response.json())}catch{}}
try{const saved=JSON.parse(localStorage.getItem('sat-live-test-settings')||'null');if(saved&&typeof saved==='object')for(const [key,value] of Object.entries(saved)){const control=form.elements.namedItem(key);if(control&&typeof value==='string')control.value=value}}catch{}
// A bookmarked control URL may carry the run settings (?joinUrl=…&userCount=…).
// Query values are explicit, so they win over whatever this browser saved last.
const queryKeys=['joinUrl','usersFile','userCount','userOffset','maxConcurrentUsers','screenshotIntervalMs','jpegQuality','startTimeoutMinutes','examTimeoutMinutes'];
let queryApplied=0;
for(const [key,value] of new URLSearchParams(location.search)){if(!queryKeys.includes(key))continue;const control=form.elements.namedItem(key);if(!control)continue;const next=String(value||'').trim();if(!next)continue;if(control.type==='number'){const numeric=Number(next);if(!Number.isFinite(numeric))continue;const min=Number(control.min||'0'),max=Number(control.max||'100000');if(numeric<min||numeric>max)continue;control.value=String(numeric)}else{control.value=next}queryApplied+=1}
if(queryApplied>0){message.textContent='Loaded '+queryApplied+' setting'+(queryApplied===1?'':'s')+' from the link. Review them, then choose Start students.'}
form.addEventListener('submit',async(event)=>{event.preventDefault();const invalid=form.querySelector(':invalid');if(invalid){message.textContent=invalid.name==='joinUrl'&&!invalid.value.trim()?'Enter the SAT Student Link URL before starting.':invalid.validationMessage||'Check the highlighted setting.';message.setAttribute('role','alert');invalid.focus();invalid.reportValidity();return}const data=Object.fromEntries(new FormData(form));data.userCount=Number(data.userCount);data.userOffset=Number(data.userOffset);data.maxConcurrentUsers=Number(data.maxConcurrentUsers);data.screenshotIntervalMs=Number(data.screenshotIntervalMs);data.jpegQuality=Number(data.jpegQuality);data.startTimeoutMs=Number(data.startTimeoutMinutes)*60000;data.examTimeoutMs=Number(data.examTimeoutMinutes)*60000;delete data.startTimeoutMinutes;delete data.examTimeoutMinutes;try{localStorage.setItem('sat-live-test-settings',JSON.stringify(Object.fromEntries(new FormData(form))))}catch{}message.textContent='Starting headless students…';message.setAttribute('role','status');try{const response=await fetch('/api/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not start the run.');renderState(result.state);message.textContent='Runner started. Students will join and wait for the proctor.'}catch(error){message.textContent=error instanceof Error?error.message:String(error);message.setAttribute('role','alert')}});
stopButton.addEventListener('click',async()=>{if(!confirm('Stop all SAT test students and close their browser sessions?'))return;try{const response=await fetch('/api/stop',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not stop the run.');renderState(result.state);message.textContent='Stop requested.'}catch(error){message.textContent=error instanceof Error?error.message:String(error);message.setAttribute('role','alert')}});
const events=new EventSource('/api/logs');events.onmessage=(event)=>{const item=JSON.parse(event.data);logs.textContent+=(logs.textContent?'\\n':'')+item.line;logs.scrollTop=logs.scrollHeight};refresh();setInterval(refresh,2000);
</script></body></html>`;
}

app.get('/', (_req, res) => res.type('html').send(controlPage()));
app.get('/api/state', (_req, res) => res.json(state));
app.get('/api/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  sseClients.add(res);
  for (const line of logLines.slice(-200)) res.write(`data: ${JSON.stringify({ line })}\n\n`);
  req.on('close', () => sseClients.delete(res));
});

app.post('/api/start', (req, res) => {
  if (!requestIsSameOrigin(req)) return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
  if (child && !child.killed && state.running) return res.status(409).json({ error: 'A SAT run is already active.' });

  try {
    const config = parseLiveSatControlConfig(req.body, ROOT);
    if (!fs.existsSync(config.usersFile) || !fs.statSync(config.usersFile).isFile()) {
      return res.status(400).json({ error: `USERS_FILE not found: ${path.relative(ROOT, config.usersFile)}` });
    }
    const env = {
      ...process.env,
      SAT_JOIN_URL: config.joinUrl,
      USERS_FILE: path.relative(ROOT, config.usersFile),
      USER_COUNT: String(config.userCount),
      USER_OFFSET: String(config.userOffset),
      MAX_CONCURRENT_USERS: String(config.maxConcurrentUsers),
      DASHBOARD_PORT: String(monitorPort),
      SCREENSHOT_INTERVAL_MS: String(config.screenshotIntervalMs),
      JPEG_QUALITY: String(config.jpegQuality),
      START_TIMEOUT_MS: String(config.startTimeoutMs),
      EXAM_TIMEOUT_MS: String(config.examTimeoutMs),
      HEADLESS: 'true',
      HEADED_USERS: '0',
      OUTPUT_DIR: 'e2e/.generated/live-sat-runner',
      DELETE_ARTIFACTS_ON_FINISH: 'false',
    };

    const bun = process.env['BUN_BIN'] || 'bun';
    const spawned = spawn(bun, ['run', 'e2e:live-sat-runner'], {
      cwd: ROOT,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = spawned;
    state = {
      running: true,
      status: 'starting',
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
      pid: spawned.pid ?? null,
      monitorPort,
      accessLinkId: config.accessLinkId,
      error: null,
    };
    logLines.length = 0;
    pushLog(`[control] starting ${config.userCount} headless students (${config.maxConcurrentUsers} concurrent)`);
    spawned.stdout?.on('data', (chunk: Buffer) => pushLog(chunk.toString()));
    spawned.stderr?.on('data', (chunk: Buffer) => pushLog(`[stderr] ${chunk.toString()}`));
    spawned.once('spawn', () => {
      if (child === spawned && state.running) state = { ...state, status: 'running' };
    });
    spawned.once('error', (error) => {
      state = { ...state, running: false, status: 'failed', endedAt: new Date().toISOString(), error: error.message };
      pushLog(`[spawn-error] ${error.message}`);
      child = null;
    });
    spawned.once('exit', (code, signal) => {
      const wasStopped = state.status === 'stopping';
      state = {
        ...state,
        running: false,
        status: wasStopped ? 'stopped' : code === 0 ? 'finished' : 'failed',
        endedAt: new Date().toISOString(),
        exitCode: code ?? (signal ? 1 : 0),
        error: wasStopped || code === 0 ? null : `Runner exited with ${signal ?? `code ${code}`}.`,
      };
      pushLog(`[exit] code=${code ?? 'null'} signal=${signal ?? 'none'}`);
      child = null;
    });
    return res.status(202).json({ state });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(400).json({ error: message });
  }
});

app.post('/api/stop', async (req, res) => {
  if (!requestIsSameOrigin(req)) return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
  if (!child || !state.running) return res.status(409).json({ error: 'No SAT run is active.' });

  const runningChild = child;
  state = { ...state, status: 'stopping' };
  pushLog('[control] stop requested');
  try {
    const pid = runningChild.pid;
    if (pid && process.platform !== 'win32') process.kill(-pid, 'SIGTERM');
    else runningChild.kill('SIGTERM');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
      return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  await Promise.race([
    new Promise<void>((resolve) => runningChild.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (child === runningChild && runningChild.pid) {
    try {
      if (process.platform !== 'win32') process.kill(-runningChild.pid, 'SIGKILL');
      else runningChild.kill('SIGKILL');
    } catch {
      // The child may have exited between the timeout and kill.
    }
  }
  return res.json({ state });
});

const port = Number(process.env['PORT'] ?? process.env['DASHBOARD_PORT'] ?? '3333');
const host = process.env['HOST'] ?? '127.0.0.1';
const server = app.listen(port, host, () => {
  console.log(`[live-sat-control] http://${host}:${port}`);
  console.log(`[live-sat-control] student monitor port ${monitorPort}`);
});

function shutdown(): void {
  if (child?.pid && state.running) {
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      // Best effort while shutting down the local controller.
    }
  }
  server.close(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
