# hurl-probe: lightweight API flows

For API flows that are a chain of requests (log in, take a token or an id from
the answer, use it in the next request), [hurl](https://hurl.dev) is enough:
one binary, no Node, no browser, a few MB of memory. The flow is a plain text
file. That makes it cheap enough to run from many locations every minute.

`hurl-probe` runs one such file and prints the duration and the result of
every request as metrics, so a slow or failing flow shows *which* request it
was. It runs behind [script_exporter](https://github.com/ricoberger/script_exporter),
which adds the result of the whole flow.

Take the Playwright exporter instead when a flow needs logic (polling until
something appears, cleanup in `finally`, several APIs) or a browser.

## Setup

Needs `hurl` (8.x) and Python 3 (standard library only).

```sh
install -m 0755 hurl/hurl-probe /usr/local/bin/hurl-probe
hurl-probe hurl/example.hurl          # try it: metrics on stdout, hurl's summary on stderr
```

[`script_exporter.yml`](script_exporter.yml) defines one script per flow.
Secrets go into a hurl variables file (`name=value` per line) passed with
`--variables-file`, and the flow uses them as `{{name}}`.

Prometheus scrapes each flow through `/probe`:

```yaml
scrape_configs:
  - job_name: hurl
    metrics_path: /probe
    scrape_interval: 1m
    scrape_timeout: 40s
    params:
      script: [jsonplaceholder-api]
    static_configs:
      - targets: ["127.0.0.1:9469"]
```

One job per flow, or one job with relabeling from a list of flows. Every scrape
runs the flow once, so the scrape interval is the check interval.

## Metrics

| Metric | Labels | |
|---|---|---|
| `script_success` | `script` | from script_exporter: 1 if hurl exited 0 (every request and assert passed) |
| `script_duration_seconds` | `script` | from script_exporter: the whole flow |
| `synthetic_hurl_step_duration_seconds` | `index`, `step` | per request of this run |
| `synthetic_hurl_step_success` | `index`, `step` | 1 if the request got a response and all its asserts passed |

`index` is the position of the request in the file (`01`, `02`, ...). `step` is
method and path from the hurl file without host and query, for example
`GET /posts` or `POST /users/{{user_id}}/posts`: captured values stay
templated, so they do not create a new series on every run. A request that is
missing at the end was not reached because an earlier one failed.

`HURL_BIN` points to another hurl binary; the default is `hurl` from `PATH`.
