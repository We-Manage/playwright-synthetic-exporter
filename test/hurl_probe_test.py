"""Tests for hurl/hurl-probe with a stub in place of hurl (no network, no hurl needed)."""
import importlib.machinery
import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROBE = os.path.join(ROOT, "hurl", "hurl-probe")

loader = importlib.machinery.SourceFileLoader("hurl_probe", PROBE)
spec = importlib.util.spec_from_loader("hurl_probe", loader)
probe = importlib.util.module_from_spec(spec)
loader.exec_module(probe)

FLOW = """GET https://api.example.com/users/1?verbose=1
HTTP 200
[Captures]
user_id: jsonpath "$.id"

POST https://api.example.com/users/{{user_id}}/posts
HTTP 201

GET https://api.example.com
HTTP 200
"""


def entry(index, line, time, calls=True, asserts=(True,)):
    return {
        "index": index,
        "line": line,
        "time": time,
        "calls": [{}] if calls else [],
        "asserts": [{"success": ok} for ok in asserts],
    }


class StepName(unittest.TestCase):
    def test_method_and_path_without_host_and_query(self):
        source = FLOW.splitlines()
        self.assertEqual(probe.step_name(source, 1), "GET /users/1")
        self.assertEqual(probe.step_name(source, 6), "POST /users/{{user_id}}/posts")
        self.assertEqual(probe.step_name(source, 9), "GET /")

    def test_unknown_line(self):
        self.assertEqual(probe.step_name(["[Captures]"], 1), "line 1")
        self.assertEqual(probe.step_name([], 7), "line 7")
        self.assertEqual(probe.step_name(["GET https://x/"], 0), "line 0")

    def test_escaping(self):
        self.assertEqual(probe.esc('a"b\\c\nd'), 'a\\"b\\\\c d')


class Metrics(unittest.TestCase):
    def test_steps_in_order_with_result(self):
        report = json.dumps({"entries": [
            entry(1, 1, 120),
            entry(2, 6, 80, asserts=(True, False)),
            entry(3, 9, 0, calls=False, asserts=()),
        ]})
        lines = probe.metrics(report, FLOW.splitlines()).splitlines()
        self.assertIn('synthetic_hurl_step_duration_seconds{index="01",step="GET /users/1"} 0.12', lines)
        self.assertIn('synthetic_hurl_step_success{index="01",step="GET /users/1"} 1', lines)
        # A failed assert fails the step.
        self.assertIn('synthetic_hurl_step_success{index="02",step="POST /users/{{user_id}}/posts"} 0', lines)
        # No calls: the request never got a response.
        self.assertIn('synthetic_hurl_step_success{index="03",step="GET /"} 0', lines)

    def test_unparsable_report_gives_headers_only(self):
        out = probe.metrics("not json", [])
        self.assertNotIn("{", out)
        self.assertIn("# TYPE synthetic_hurl_step_success gauge", out)


class Command(unittest.TestCase):
    """Runs the probe as script_exporter would, with a stub hurl."""

    def run_probe(self, report, exit_code, *args):
        with tempfile.TemporaryDirectory() as d:
            flow = os.path.join(d, "flow.hurl")
            with open(flow, "w") as f:
                f.write(FLOW)
            argv_file = os.path.join(d, "argv")
            stub = os.path.join(d, "hurl")
            with open(stub, "w") as f:
                f.write(
                    "#!/usr/bin/env python3\n"
                    "import json, sys\n"
                    f"open({argv_file!r}, 'w').write(json.dumps(sys.argv[1:]))\n"
                    f"print({report!r})\n"
                    f"sys.exit({exit_code})\n"
                )
            os.chmod(stub, os.stat(stub).st_mode | stat.S_IEXEC)
            proc = subprocess.run(
                [sys.executable, PROBE, *args, flow],
                env={**os.environ, "HURL_BIN": stub},
                capture_output=True,
                text=True,
            )
            with open(argv_file) as f:
                argv = json.load(f)
            return proc, argv, flow

    def test_passes_hurl_exit_code_through(self):
        report = json.dumps({"entries": [entry(1, 1, 50, asserts=(False,))]})
        proc, argv, flow = self.run_probe(report, 4)
        self.assertEqual(proc.returncode, 4)
        self.assertIn('synthetic_hurl_step_success{index="01",step="GET /users/1"} 0', proc.stdout)
        self.assertEqual(argv, ["--test", "--no-color", "--json", flow])

    def test_variables_file(self):
        proc, argv, flow = self.run_probe(json.dumps({"entries": []}), 0, "--variables-file", "/etc/x.vars")
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(argv, ["--test", "--no-color", "--json", "--variables-file", "/etc/x.vars", flow])


if __name__ == "__main__":
    unittest.main()
