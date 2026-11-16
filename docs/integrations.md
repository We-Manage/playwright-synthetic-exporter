# Integrations

The exporter serves plain Prometheus metrics on `/metrics`. Anything that can
scrape Prometheus metrics can collect them. The dashboard and the alert rules
use PromQL, so they work with Prometheus and everything that speaks PromQL
(VictoriaMetrics, Mimir, Thanos, hosted Prometheus-compatible services). They need the `instance`
label to tell exporters apart; Prometheus and vmagent set it themselves, with
Telegraf you set it yourself (see below).

## Prometheus

```yaml
# prometheus.yml
scrape_configs:
  - job_name: playwright-synthetic
    static_configs:
      - targets: ["synthetic-1.example.com:9470", "synthetic-2.example.com:9470"]
```

Any scrape interval works: scrapes only read the last results, the checks
run on their own interval. The example in `examples/` uses this setup.

## VictoriaMetrics

Single-node VictoriaMetrics reads the same scrape config:

```sh
victoria-metrics -promscrape.config=prometheus.yml
```

With vmagent next to the exporter, for example on each location:

```sh
vmagent -promscrape.config=prometheus.yml \
  -remoteWrite.url=https://victoria.example.com/api/v1/write
```

In Grafana, add VictoriaMetrics as a data source of type *Prometheus* and
import the dashboard.

## Telegraf

If Telegraf already runs on the host, let it scrape the exporter and send the
metrics on with remote write, to VictoriaMetrics, Prometheus (with
`--web.enable-remote-write-receiver`), Mimir or any other remote-write endpoint:

```toml
[[inputs.prometheus]]
  urls = ["http://127.0.0.1:9470/metrics"]
  # Keeps the metric names as they are (synthetic_pw_success, ...).
  metric_version = 2
  fieldinclude = ["synthetic_pw_*"]
  tagexclude = ["url"]
  # The dashboard tells exporters apart by instance; Telegraf only sets host.
  [inputs.prometheus.tags]
    instance = "synthetic-1"

[[outputs.http]]
  url = "https://victoria.example.com/api/v1/write"
  # username = "..."
  # password = "..."
  data_format = "prometheusremotewrite"
  # Only the synthetic metrics, if this Telegraf sends other data elsewhere.
  # namepass = ["prometheus"]
  [outputs.http.headers]
    Content-Type = "application/x-protobuf"
    Content-Encoding = "snappy"
    X-Prometheus-Remote-Write-Version = "0.1.0"
```

`metric_version = 2` matters: without it Telegraf renames the metrics
(`synthetic_pw_success_gauge`) and the dashboard stays empty. Labels from the
checks file, `check`, `step` and `page` arrive unchanged; Telegraf's global
tags and `host` are added.

## hurl-probe

[`hurl-probe`](../hurl/) runs behind script_exporter, and every scrape of
`/probe?script=<name>` runs the flow once, so the scrape interval is the check
interval. Give each flow its own `check` label.

Prometheus or vmagent, one job per flow:

```yaml
scrape_configs:
  - job_name: hurl-jsonplaceholder-api
    metrics_path: /probe
    params:
      script: [jsonplaceholder-api]
    scrape_interval: 1m
    scrape_timeout: 40s
    static_configs:
      - targets: ["127.0.0.1:9469"]
        labels:
          check: jsonplaceholder-api
```

Telegraf, one input per flow:

```toml
[[inputs.prometheus]]
  urls = ["http://127.0.0.1:9469/probe?script=jsonplaceholder-api&timeout=30"]
  metric_version = 2
  interval = "1m"
  # Longer than the flow may take, or Telegraf gives up before hurl does.
  response_timeout = "35s"
  fieldinclude = ["script_*", "synthetic_hurl_*"]
  tagexclude = ["url"]
  [inputs.prometheus.tags]
    check = "jsonplaceholder-api"
    instance = "synthetic-1"
```

The outputs are the same as above. `script_success` is the result of the
whole flow, `synthetic_hurl_step_*` the requests in it.

## Elasticsearch

Telegraf can write the same metrics to Elasticsearch:

```toml
[[inputs.prometheus]]
  urls = ["http://127.0.0.1:9470/metrics"]
  metric_version = 2
  fieldinclude = ["synthetic_pw_*"]
  tagexclude = ["url"]

[[outputs.elasticsearch]]
  urls = ["https://elasticsearch.example.com:9200"]
  index_name = "synthetic-%Y.%m.%d"
  # username = "..."
  # password = "..."
  namepass = ["prometheus"]
```

Each scrape becomes one document per label set, with the metric names as
fields (`prometheus.synthetic_pw_success`) and the labels under `tag`. The
Grafana dashboard does not work on Elasticsearch, since it is written in
PromQL; build the views in Kibana or with Grafana's Elasticsearch data source
instead. Elastic Agent and Metricbeat can also scrape `/metrics` directly
with their Prometheus integration.

For dashboards and alerting, a PromQL store is the better fit: the metrics
are gauges with labels, which is exactly what it is made for.
