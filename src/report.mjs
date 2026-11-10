// Pure helpers of the runner, kept apart so the tests can import them.

// "90s", "5m", "1h", "500ms" or plain seconds.
export function seconds(value) {
  const m = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/);
  if (!m) throw new Error(`invalid duration: ${value}`);
  const n = Number(m[1]);
  return { ms: n / 1000, s: n, m: n * 60, h: n * 3600 }[m[2] ?? 's'];
}

// ${VAR} and ${VAR:-default} from the exporter's environment, for secrets.
export function expand(value) {
  return String(value).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name, def) => {
    if (process.env[name] !== undefined) return process.env[name];
    if (def !== undefined) return def;
    throw new Error(`environment variable ${name} is not set`);
  });
}

// Collects the outermost test.step blocks; nested steps stay inside them.
function topSteps(result) {
  return (result.steps ?? [])
    .filter((s) => s.title && !s.title.startsWith('Before Hooks') && !s.title.startsWith('After Hooks'))
    .map((s) => ({ title: s.title, duration: (s.duration ?? 0) / 1000, ok: !s.error }));
}

// First lines of an error: the assertion plus its Expected/Received.
const shortError = (message) =>
  (message ?? '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' | ');

export function parseReport(json) {
  const report = JSON.parse(json);
  const results = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) for (const t of spec.tests ?? []) for (const r of t.results ?? []) results.push(r);
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const s of report.suites ?? []) walk(s);
  if (results.length === 0) {
    const err = (report.errors ?? []).map((e) => shortError(e.message)).join('; ');
    return { ok: false, duration: 0, steps: [], vitals: {}, error: err || 'no test found in spec' };
  }
  const vitals = {};
  for (const r of results) {
    for (const a of r.attachments ?? []) {
      if (a.name !== 'web-vitals' || !a.body) continue;
      const pages = JSON.parse(Buffer.from(a.body, 'base64').toString('utf8'));
      for (const [page, values] of Object.entries(pages)) Object.assign((vitals[page] ??= {}), values);
    }
  }
  const failed = results.filter((r) => r.status !== 'passed');
  return {
    ok: failed.length === 0,
    duration: results.reduce((sum, r) => sum + (r.duration ?? 0), 0) / 1000,
    steps: results.flatMap(topSteps),
    vitals,
    error: failed.flatMap((r) => (r.errors ?? []).map((e) => shortError(e.message))).join('; '),
  };
}

