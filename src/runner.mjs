#!/usr/bin/env node
// playwright-synthetic-exporter: runs Playwright Test specs on a schedule and
// serves the last result of each check as Prometheus metrics.
//
// Checks run one at a time with Playwright's JSON reporter. Scrapes only read
// the cached results; a browser flow may take minutes and must not run inside
// a scrape.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import YAML from 'yaml';
import { expand, parseReport, seconds } from './report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { values: args } = parseArgs({
  options: {
    config: { type: 'string', default: process.env.PSE_CONFIG ?? join(ROOT, 'checks', 'checks.yml') },
    'data-dir': { type: 'string', default: process.env.PSE_DATA_DIR ?? '/tmp/playwright-synthetic-exporter' },
    listen: { type: 'string', default: process.env.PSE_LISTEN ?? ':9470' },
    once: { type: 'boolean', default: false },
    check: { type: 'string', multiple: true },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help) {
  console.log(`Usage: playwright-synthetic-exporter [options]

  --config <file>     checks file, YAML or JSON (env PSE_CONFIG, default ./checks/checks.yml)
  --data-dir <dir>    traces and screenshots of failed runs (env PSE_DATA_DIR)
  --listen <addr>     metrics address, host:port or :port (env PSE_LISTEN, default :9470)
  --once              run every check once, print the results and exit 1 on failure
  --check <name>      only this check, may be repeated`);
  process.exit(0);
}

const RESERVED = new Set(['check', 'index', 'step', 'page', 'metric', 'result', 'spec', 'interval', 'timeout', 'description']);

function checkLabels(labels, where) {
  for (const k of Object.keys(labels ?? {})) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) || k.startsWith('__')) throw new Error(`${where}: invalid label name ${k}`);
    if (RESERVED.has(k)) throw new Error(`${where}: label ${k} is used by the exporter itself`);
  }
  return Object.fromEntries(Object.entries(labels ?? {}).map(([k, v]) => [k, String(v)]));
}

function loadConfig(file) {
  const raw = YAML.parse(readFileSync(file, 'utf8')) ?? {};
  const base = dirname(resolve(file));
  const defaults = raw.defaults ?? {};
  const globalLabels = checkLabels(raw.labels, 'labels');
  const seen = new Set();
  const checks = (raw.checks ?? [])
    .filter((c) => c.enabled ?? true)
    .map((c) => {
      if (!c.name || !/^[A-Za-z0-9._-]+$/.test(c.name)) throw new Error(`check name must match [A-Za-z0-9._-]+: ${c.name}`);
      if (seen.has(c.name)) throw new Error(`duplicate check name: ${c.name}`);
      seen.add(c.name);
      if (!c.spec) throw new Error(`check ${c.name}: spec is missing`);
      const interval = c.interval ?? defaults.interval ?? '5m';
      const timeout = c.timeout ?? defaults.timeout ?? '60s';
      return {
        name: c.name,
        spec: isAbsolute(c.spec) ? c.spec : join(base, c.spec),
        specName: c.spec,
        description: c.description ?? '',
        interval,
        timeout,
        intervalS: seconds(interval),
        timeoutS: seconds(timeout),
        labels: { ...globalLabels, ...checkLabels(c.labels, `check ${c.name}`) },
        env: Object.fromEntries(Object.entries({ ...defaults.env, ...c.env }).map(([k, v]) => [k, expand(v)])),
      };
    });
  return args.check ? checks.filter((c) => args.check.includes(c.name)) : checks;
}

const checks = loadConfig(args.config);
if (checks.length === 0) console.error(JSON.stringify({ warning: 'no checks configured', config: args.config }));

// The error line of a crashed Playwright run, not the last stack frame.
const stderrSummary = (text) => {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /error/i.test(l) && !l.startsWith('at ')) ?? lines.pop() ?? '';
};

function run(check) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(
      process.execPath,
      [join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '--config', join(ROOT, 'src', 'playwright.config.ts')],
      {
        cwd: ROOT,
        detached: true,
        env: {
          ...process.env,
          ...check.env,
          PSE_SPEC: check.spec,
          PSE_OUTPUT_DIR: join(args['data-dir'], check.name),
          PSE_TIMEOUT_MS: String(check.timeoutS * 1000),
          PSE_CHECK: check.name,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    // Playwright enforces the test timeout itself; this only catches a hung run.
    const killer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }, (check.timeoutS + 60) * 1000);
    child.on('close', (code) => {
      clearTimeout(killer);
      let result;
      try {
        result = parseReport(out);
      } catch (e) {
        result = { ok: false, duration: 0, steps: [], vitals: {}, error: `no report (exit ${code}): ${stderrSummary(err) || e.message}` };
      }
      result.wall = (Date.now() - started) / 1000;
      result.finished = Date.now() / 1000;
      done(result);
    });
  });
}

const logLine = (check, result) => {
  const line = { check: check.name, ok: result.ok, duration: result.duration, wall: result.wall };
  if (!result.ok) line.error = result.error;
  console.log(JSON.stringify(line));
};

if (args.once) {
  let failed = 0;
  for (const check of checks) {
    const result = await run(check);
    logLine(check, result);
    if (!result.ok) failed += 1;
  }
  process.exit(failed > 0 ? 1 : 0);
}

const state = checks.map((check, i) => ({
  check,
  // Spread the first runs so a restart does not start everything at once.
  next: Date.now() + i * 15000,
  runs: { success: 0, failure: 0 },
  last: null,
}));

async function loop() {
  for (;;) {
    const due = state.filter((s) => s.next <= Date.now()).sort((a, b) => a.next - b.next)[0];
    if (!due) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    const started = Date.now();
    const result = await run(due.check);
    due.last = result;
    due.runs[result.ok ? 'success' : 'failure'] += 1;
    due.next = started + due.check.intervalS * 1000;
    logLine(due.check, result);
  }
}

const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const labels = (o) => '{' + Object.entries(o).map(([k, v]) => `${k}="${esc(v)}"`).join(',') + '}';

function metrics() {
  const out = [];
  const family = (name, type, help) => out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
  const base = (s) => ({ ...s.check.labels, check: s.check.name });
  const ran = state.filter((s) => s.last);
  // index keeps the execution order, two digits so it also sorts as a string.
  const stepLabels = (s, st, i) => ({ ...base(s), index: String(i + 1).padStart(2, '0'), step: st.title });

  family('synthetic_pw_check_info', 'gauge', 'One series per configured check, with its spec, interval and description.');
  for (const s of state)
    out.push(`synthetic_pw_check_info${labels({ ...base(s), spec: s.check.specName, interval: s.check.interval, timeout: s.check.timeout, description: s.check.description })} 1`);
  family('synthetic_pw_success', 'gauge', '1 if every test in the spec passed on the last run.');
  for (const s of ran) out.push(`synthetic_pw_success${labels(base(s))} ${s.last.ok ? 1 : 0}`);
  family('synthetic_pw_duration_seconds', 'gauge', 'Test duration of the last run as reported by Playwright.');
  for (const s of ran) out.push(`synthetic_pw_duration_seconds${labels(base(s))} ${s.last.duration}`);
  family('synthetic_pw_last_run_timestamp_seconds', 'gauge', 'End of the last run.');
  for (const s of ran) out.push(`synthetic_pw_last_run_timestamp_seconds${labels(base(s))} ${s.last.finished}`);
  family('synthetic_pw_interval_seconds', 'gauge', 'Configured interval of the check.');
  for (const s of state) out.push(`synthetic_pw_interval_seconds${labels(base(s))} ${s.check.intervalS}`);
  family('synthetic_pw_runs_total', 'counter', 'Runs since the exporter started, by result.');
  for (const s of state)
    for (const [result, n] of Object.entries(s.runs)) out.push(`synthetic_pw_runs_total${labels({ ...base(s), result })} ${n}`);
  family('synthetic_pw_step_duration_seconds', 'gauge', 'Duration of each top-level test.step on the last run.');
  for (const s of ran) s.last.steps.forEach((st, i) => out.push(`synthetic_pw_step_duration_seconds${labels(stepLabels(s, st, i))} ${st.duration}`));
  family('synthetic_pw_step_success', 'gauge', '1 if the top-level test.step passed on the last run.');
  for (const s of ran) s.last.steps.forEach((st, i) => out.push(`synthetic_pw_step_success${labels(stepLabels(s, st, i))} ${st.ok ? 1 : 0}`));
  family('synthetic_pw_web_vital_seconds', 'gauge', 'Lab Web Vitals per page on the last run (lcp, fcp, ttfb, tbt, inp).');
  for (const s of ran)
    for (const [page, v] of Object.entries(s.last.vitals))
      for (const [metric, value] of Object.entries(v))
        if (metric !== 'cls') out.push(`synthetic_pw_web_vital_seconds${labels({ ...base(s), page, metric })} ${value / 1000}`);
  family('synthetic_pw_cls', 'gauge', 'Cumulative layout shift per page on the last run.');
  for (const s of ran)
    for (const [page, v] of Object.entries(s.last.vitals))
      if (v.cls !== undefined) out.push(`synthetic_pw_cls${labels({ ...base(s), page })} ${v.cls}`);
  return out.join('\n') + '\n';
}

const m = args.listen.match(/^(.*):(\d+)$/);
if (!m) throw new Error(`invalid listen address: ${args.listen}`);
createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0];
  if (path === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
    res.end(metrics());
  } else if (path === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok\n');
  } else if (path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>playwright-synthetic-exporter</title><h1>playwright-synthetic-exporter</h1><p><a href="metrics">Metrics</a></p>\n');
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(Number(m[2]), m[1] || undefined, () =>
  console.log(JSON.stringify({ listening: args.listen, checks: checks.map((c) => c.name) })),
);

const shutdown = () => process.exit(0);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

loop();
