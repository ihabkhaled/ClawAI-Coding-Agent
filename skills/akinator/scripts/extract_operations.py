#!/usr/bin/env python3
"""Generate the operations wiki - the runnable surface of a repository.

Four pages under `<wiki>/infra/`, each a generated block plus a curated stub:

    tools-and-commands.md      every runnable task and the CLI tools they need
    environment-variables.md   every variable NAME the tree references
    repositories.md            CI provider, owners, .github, submodules, workspaces
    installation.md            detected install/run/test steps, runtimes, and
                               the README sections that already hold the manual

Rules this tool keeps:

- Every row names the file it came from. Nothing detected says
  "Nothing detected." - never an empty table.
- Environment variable VALUES are never read into output - names only, even
  when an example file holds a value.
- Git remotes are parsed from `.git/config` without running git, and any
  userinfo (user, password, token) is stripped before a URL is printed.
- The generated block is the only thing rewritten. Curated text - and CRLF line
  endings - are preserved byte for byte. A new page is H1 + block + a curated
  stub holding the honest gap marker.

Travels into host repositories: run it from the host repository root.
Standard library only; deterministic (sorted, no clock, no absolute paths).

Usage:
    python skills/akinator/scripts/extract_operations.py [root]            # dry run, exit 1 on drift
    python skills/akinator/scripts/extract_operations.py [root] --write
    python skills/akinator/scripts/extract_operations.py [root] --check
    python skills/akinator/scripts/extract_operations.py [root] --wiki docs/wiki

Exit codes: 0 current (or --write ok), 1 drift, 2 cannot run / broken block.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import extract_libraries as el  # noqa: E402

DEFAULT_WIKI = "docs/wiki"
# Links on a page under <wiki>/infra/ must climb back to the repository root.
_UP = "../../../"
BEGIN, END, GAP = el.BEGIN, el.END, el.GAP
REGENERATE = "python skills/akinator/scripts/extract_operations.py --write"
NOTHING = "Nothing detected."
SKIP_DIRS = frozenset(el.SKIP_DIRS) | {".git", ".tox", ".mypy_cache", ".ruff_cache"}
MAX_BYTES = 2_000_000
MAX_USED = 3
CODE_EXT = {".py", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".rb", ".rs", ".go"}
SECRET_NAME = re.compile(r"KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE|DSN")


# --------------------------------------------------------------------------
# Reading and scrubbing
# --------------------------------------------------------------------------

def _text(path: Path) -> str:
    try:
        if path.stat().st_size > MAX_BYTES:
            return ""
        return path.read_bytes().decode("utf-8", errors="replace").replace("\r\n", "\n")
    except OSError:
        return ""


def _walk(repo: Path) -> list[str]:
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(repo):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        base = Path(dirpath)
        for name in sorted(filenames):
            out.append((base / name).relative_to(repo).as_posix())
    return sorted(out)


URL_USERINFO = re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://)[^/\s@'\"]*@")
SECRET_ASSIGN = re.compile(
    r"(?i)([\w-]*(?:token|secret|password|passwd|apikey|api-key|key)[\w-]*\s*[=:]\s*)"
    r"(?:\"[^\"]*\"|'[^']*'|\S+)")


def scrub(text: str) -> str:
    """Free text safe to print: no URL userinfo, no `secret=value` pairs."""
    text = URL_USERINFO.sub(r"\1", text)
    return SECRET_ASSIGN.sub(r"\1[redacted]", text)


def _cell(text: str, limit: int = 90) -> str:
    text = " ".join(scrub(text).split())
    if len(text) > limit:
        text = text[: limit - 3].rstrip() + "..."
    return text.replace("|", "\\|") if text else "-"


def _c(text: str) -> str:
    return "`" + _cell(text, 120).replace("`", "'") + "`"


def table(headers: list[str], rows: list[list[str]]) -> list[str]:
    if not rows:
        return [NOTHING]
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    out += ["| " + " | ".join(r) + " |" for r in rows]
    return out


def _first(paths: list[str]) -> str:
    shown = ", ".join(f"`{p}`" for p in paths[:MAX_USED])
    more = len(paths) - MAX_USED
    return shown + (f" +{more} more" if more > 0 else "") if paths else "-"


# --------------------------------------------------------------------------
# Tiny YAML helpers (indentation based; enough for structure, never values)
# --------------------------------------------------------------------------

def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _blocks(text: str, key: str) -> list[list[str]]:
    """The child lines of every `key:` line that has no inline value."""
    lines = text.split("\n")
    out: list[list[str]] = []
    pattern = re.compile(rf"^(\s*)-?\s*{re.escape(key)}:\s*(?:#.*)?$")
    for i, line in enumerate(lines):
        m = pattern.match(line)
        if not m:
            continue
        base = len(m.group(1))
        child: list[str] = []
        for nxt in lines[i + 1:]:
            if nxt.strip() and not nxt.lstrip().startswith("#"):
                if _indent(nxt) <= base:
                    break
                child.append(nxt)
        out.append(child)
    return out


def _entries(child: list[str]) -> list[tuple[str, list[str]]]:
    """Direct children of a block: (key, its own sub-lines)."""
    if not child:
        return []
    level = min(_indent(l) for l in child)
    out: list[tuple[str, list[str]]] = []
    for line in child:
        if _indent(line) == level:
            m = re.match(r"\s*([\w.@/-]+)\s*:", line)
            if m:
                out.append((m.group(1), []))
        elif out:
            out[-1][1].append(line)
    return out


def _sub_value(lines: list[str], key: str) -> str:
    for line in lines:
        m = re.match(rf"\s*{key}:\s*(.+?)\s*$", line)
        if m:
            return m.group(1).strip("'\"")
    return ""


# --------------------------------------------------------------------------
# 1. Tools and commands
# --------------------------------------------------------------------------

KNOWN_TOOLS = (
    "python", "python3", "pip", "pip3", "node", "npm", "npx", "pnpm", "yarn", "bun",
    "docker", "git", "gh", "make", "cargo", "rustc", "go", "bash", "sh", "pwsh",
    "powershell", "pytest", "ruff", "mypy", "tsc", "eslint", "prettier", "uv",
    "poetry", "terraform", "kubectl", "helm", "just", "task", "curl", "tox", "nox",
)
TOOL_ALIAS = {"python3": "python", "pip3": "pip", "powershell": "pwsh", "npx": "npm"}
ACTION_TOOLS = {
    "actions/setup-python": "python", "actions/setup-node": "node",
    "actions/setup-go": "go", "actions/setup-java": "java",
    "actions/checkout": "git", "docker/": "docker", "astral-sh/setup-uv": "uv",
    "pnpm/action-setup": "pnpm", "dtolnay/rust-toolchain": "cargo",
}
SHEBANG = re.compile(r"^#!\s*(?:/usr/bin/env\s+(?:-S\s+)?|/[\w/.-]*/)([\w.-]+)")
IGNORE_TARGETS = {"PHONY", "DEFAULT_GOAL", "SUFFIXES", "PRECIOUS", "INTERMEDIATE", "SECONDARY"}


class Ops:
    """Collected rows and tool evidence for the tools page."""

    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []
        self.tools: dict[str, set[str]] = {}

    def add(self, command: str, what: str, where: str) -> None:
        self.rows.append((command, what, where))

    def tool(self, name: str, where: str) -> None:
        self.tools.setdefault(TOOL_ALIAS.get(name, name), set()).add(where)

    def words(self, command: str, where: str) -> None:
        for part in re.split(r"&&|\|\||;|\|", command):
            tokens = part.strip().split()
            while tokens and (re.match(r"^\w+=", tokens[0]) or tokens[0] in ("@", "-")):
                tokens.pop(0)
            if tokens:
                word = tokens[0].lstrip("@-").split("/")[-1]
                if word in KNOWN_TOOLS:
                    self.tool(word, where)


def _package_json(repo: Path, rel: str, ops: Ops) -> None:
    try:
        data = json.loads(_text(repo / rel))
    except ValueError:
        return
    ops.tool("node", rel)
    scripts = data.get("scripts") if isinstance(data, dict) else None
    if isinstance(scripts, dict):
        for name in sorted(scripts):
            body = str(scripts[name])
            ops.add(f"npm run {name}", body, rel)
            ops.words(body, rel)


def _makefile(text: str, rel: str, ops: Ops) -> None:
    ops.tool("make", rel)
    lines = text.split("\n")
    for i, line in enumerate(lines):
        m = re.match(r"^([A-Za-z0-9_][A-Za-z0-9_./-]*)[ \t]*:(?![=:])(.*)$", line)
        if m and m.group(1) not in IGNORE_TARGETS:
            comment = re.search(r"##\s*(.+)$", m.group(2))
            what = comment.group(1) if comment else ""
            if not what and i and lines[i - 1].startswith("##"):
                what = lines[i - 1].lstrip("# ").strip()
            ops.add(f"make {m.group(1)}", what, rel)
        elif line.startswith("\t"):
            ops.words(line.strip(), rel)


def _justfile(text: str, rel: str, ops: Ops) -> None:
    ops.tool("just", rel)
    lines = text.split("\n")
    for i, line in enumerate(lines):
        m = re.match(r"^@?([A-Za-z_][\w-]*)(?:\s+[^:=\n]*)?:(?!=)", line)
        if m:
            what = lines[i - 1].lstrip("# ").strip() if i and lines[i - 1].startswith("#") else ""
            ops.add(f"just {m.group(1)}", what, rel)
        elif line.startswith((" ", "\t")):
            ops.words(line.strip(), rel)


def _taskfile(text: str, rel: str, ops: Ops) -> None:
    ops.tool("task", rel)
    for child in _blocks(text, "tasks"):
        for name, sub in _entries(child):
            ops.add(f"task {name}", _sub_value(sub, "desc") or _sub_value(sub, "summary"), rel)
            for line in sub:
                m = re.match(r"\s*-\s*(?:cmd:\s*)?([A-Za-z][^\n]*)$", line)
                if m and ":" not in m.group(1).split()[0]:
                    ops.words(m.group(1), rel)


def _pyproject(text: str, rel: str, ops: Ops) -> None:
    ops.tool("python", rel)
    section = ""
    for line in text.split("\n"):
        head = re.match(r"^\s*\[([^\]]+)\]\s*$", line)
        if head:
            section = head.group(1).strip()
            poe = re.match(r"tool\.poe\.tasks\.([\w-]+)$", section)
            if poe:
                ops.add(f"poe {poe.group(1)}", "", rel)
            continue
        kv = re.match(r"^\s*([\w.-]+)\s*=\s*(.+)$", line)
        if not kv:
            continue
        if section == "project.scripts":
            ops.add(kv.group(1), f"entry point {kv.group(2).strip()}", rel)
        elif section == "tool.poe.tasks":
            ops.add(f"poe {kv.group(1)}", kv.group(2).strip(), rel)


def _tox(text: str, rel: str, ops: Ops) -> None:
    ops.tool("tox", rel)
    for env in re.findall(r"^\[testenv:([^\]\n]+)\]", text, re.MULTILINE):
        ops.add(f"tox -e {env}", "", rel)
    m = re.search(r"^envlist\s*=\s*(.+)$", text, re.MULTILINE)
    if m:
        for env in re.split(r"[,\s]+", m.group(1).strip()):
            if env and "{" not in env:
                ops.add(f"tox -e {env}", "envlist entry", rel)


def _noxfile(text: str, rel: str, ops: Ops) -> None:
    ops.tool("nox", rel)
    for name in re.findall(r"@nox\.session[^\n]*\n(?:[ \t]*@[^\n]*\n)*[ \t]*def[ \t]+(\w+)", text):
        ops.add(f"nox -s {name}", "", rel)


def _script_summary(text: str, ext: str) -> str:
    lines = [l for l in text.split("\n")[:30]]
    if ext == ".py":
        m = re.search(r'^\s*(?:"""|\'\'\')\s*(.*)', "\n".join(lines), re.MULTILINE)
        if m and m.group(1).strip():
            return m.group(1).strip().rstrip("\"'")
    for line in lines:
        if line.startswith("#!"):
            continue
        m = re.match(r"^\s*(?:#|//|REM|::)\s*(.+)$", line)
        if m:
            return m.group(1).strip()
        if line.strip() and not line.startswith("#"):
            break
    return ""


def _script_files(repo: Path, rel: str, ops: Ops) -> None:
    ext = Path(rel).suffix.lower()
    runner = {".py": "python", ".sh": "sh", ".ps1": "pwsh -File", ".js": "node",
              ".mjs": "node", ".rb": "ruby", ".cmd": "", ".bat": ""}.get(ext)
    if runner is None:
        return
    text = _text(repo / rel)
    command = f"{runner} {rel}".strip()
    ops.add(command, _script_summary(text, ext), rel)
    first = text.split("\n", 1)[0]
    m = SHEBANG.match(first)
    if m and m.group(1) in KNOWN_TOOLS:
        ops.tool(m.group(1), rel)
    elif runner:
        ops.tool(runner.split()[0], rel)


def _ci_workflow(text: str, rel: str, ops: Ops) -> None:
    for child in _blocks(text, "jobs"):
        for job, sub in _entries(child):
            ops.add(f"CI job {job}", _sub_value(sub, "name"), rel)
    for action in re.findall(r"^\s*-?\s*uses:\s*([^\s#]+)", text, re.MULTILINE):
        for prefix, tool in ACTION_TOOLS.items():
            if action.startswith(prefix):
                ops.tool(tool, rel)
    for run in re.findall(r"^\s*-?\s*run:\s*(?![|>])([^\n#]+)", text, re.MULTILINE):
        ops.words(run.strip(), rel)


def _gitlab_ci(text: str, rel: str, ops: Ops) -> None:
    for m in re.finditer(r"^([A-Za-z_][\w.-]*):\s*\n((?:[ \t]+[^\n]*\n|\n)+)", text + "\n", re.MULTILINE):
        if m.group(1) not in ("stages", "variables", "default", "include", "workflow") \
                and "script:" in m.group(2):
            ops.add(f"CI job {m.group(1)}", "", rel)
    for run in re.findall(r"^\s*-\s+([A-Za-z][^\n#]*)$", text, re.MULTILINE):
        ops.words(run.strip(), rel)


def _compose(text: str, rel: str, ops: Ops) -> None:
    ops.tool("docker", rel)
    for child in _blocks(text, "services"):
        for name, sub in _entries(child):
            ops.add(f"docker compose up {name}", _sub_value(sub, "image")
                    and f"image {_sub_value(sub, 'image')}", rel)


def tools_page(repo: Path, files: list[str]) -> str:
    ops = Ops()
    for rel in files:
        name = Path(rel).name
        parent = Path(rel).parent.as_posix()
        lower = name.lower()
        if name == "package.json" and "node_modules" not in rel:
            _package_json(repo, rel, ops)
        elif lower in ("makefile", "gnumakefile"):
            _makefile(_text(repo / rel), rel, ops)
        elif lower == "justfile":
            _justfile(_text(repo / rel), rel, ops)
        elif lower in ("taskfile.yml", "taskfile.yaml"):
            _taskfile(_text(repo / rel), rel, ops)
        elif name == "pyproject.toml":
            _pyproject(_text(repo / rel), rel, ops)
        elif name == "tox.ini":
            _tox(_text(repo / rel), rel, ops)
        elif name == "noxfile.py":
            _noxfile(_text(repo / rel), rel, ops)
        elif parent in ("scripts", "bin") or parent.endswith("/scripts"):
            if parent == "scripts" or parent.endswith("/scripts"):
                _script_files(repo, rel, ops)
        elif parent == ".github/workflows" and lower.endswith((".yml", ".yaml")):
            _ci_workflow(_text(repo / rel), rel, ops)
        elif name == ".gitlab-ci.yml":
            _gitlab_ci(_text(repo / rel), rel, ops)
        elif re.match(r"^(docker-)?compose(\.[\w-]+)?\.ya?ml$", lower):
            _compose(_text(repo / rel), rel, ops)
        if lower == "dockerfile":
            ops.tool("docker", rel)
    if any(f == ".git" or f.startswith(".git/") for f in files) or (repo / ".git").exists():
        ops.tool("git", ".git")
    if any(f.startswith(".github/") for f in files):
        ops.tool("gh", ".github")

    rows = sorted(set(ops.rows), key=lambda r: (r[2], r[0], r[1]))
    lines = ["### Commands", ""]
    lines += table(["Command", "What", "Where defined"],
                   [[_c(c), _cell(w), f"`{p}`"] for c, w, p in rows])
    lines += ["", "### Required CLI tools", ""]
    lines += table(["Tool", "Implied by"],
                   [[f"`{t}`", _first(sorted(ops.tools[t]))] for t in sorted(ops.tools)])
    return "\n".join(lines)


# --------------------------------------------------------------------------
# 2. Environment variables (names only - never values)
# --------------------------------------------------------------------------

NAME = r"([A-Za-z_][A-Za-z0-9_]*)"
Q = r"[\"']"
ENV_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # (pattern, form): "get" forms may carry a default, "index" forms cannot
    (re.compile(rf"os\.environ\.get\(\s*{Q}{NAME}{Q}\s*(,)?"), "get"),
    (re.compile(rf"os\.getenv\(\s*{Q}{NAME}{Q}\s*(,)?"), "get"),
    (re.compile(rf"os\.environ\[\s*{Q}{NAME}{Q}\s*\]()"), "index"),
    (re.compile(rf"process\.env\.{NAME}\b(\s*(?:\|\||\?\?))?"), "js"),
    (re.compile(rf"process\.env\[\s*{Q}{NAME}{Q}\s*\](\s*(?:\|\||\?\?))?"), "js"),
    (re.compile(rf"\bENV\.fetch\(\s*{Q}{NAME}{Q}\s*(,)?"), "get"),
    (re.compile(rf"\bENV\[\s*{Q}{NAME}{Q}\s*\]()"), "index"),
    (re.compile(rf"env::var(?:_os)?\(\s*\"{NAME}\"\s*\)(\s*\.unwrap_or\w*)?"), "js"),
    (re.compile(rf"os\.(?:Getenv|LookupEnv)\(\s*\"{NAME}\"\s*\)()"), "index"),
]
ENV_FILES = re.compile(r"^\.env(\.(example|sample|template|dist|defaults))$|^\.env$", re.I)


def _env_names_from_file(text: str) -> set[str]:
    names: set[str] = set()
    for line in text.split("\n"):
        m = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
        if m:
            names.add(m.group(1))
    return names


def _env_names_from_yaml(text: str, keys: tuple[str, ...]) -> set[str]:
    names: set[str] = set()
    for key in keys:
        for child in _blocks(text, key):
            if not child:
                continue
            level = min(_indent(l) for l in child)
            for line in child:
                if _indent(line) != level:
                    continue
                body = line.strip()
                item = re.match(rf"^-\s*{NAME}\s*(?:=|$)", body) or \
                    re.match(rf"^{NAME}\s*:", body)
                if item:
                    names.add(item.group(1))
    return names


def env_page(repo: Path, files: list[str]) -> str:
    declared: dict[str, set[str]] = {}
    used: dict[str, set[str]] = {}
    default: dict[str, bool] = {}
    seen_forms: dict[str, set[str]] = {}

    def declare(names: set[str], rel: str) -> None:
        for n in names:
            declared.setdefault(n, set()).add(rel)

    for rel in files:
        name = Path(rel).name
        lower = name.lower()
        suffix = Path(rel).suffix.lower()
        if ENV_FILES.match(name):
            declare(_env_names_from_file(_text(repo / rel)), rel)
        elif re.match(r"^(docker-)?compose(\.[\w-]+)?\.ya?ml$", lower):
            declare(_env_names_from_yaml(_text(repo / rel), ("environment",)), rel)
        elif (rel.startswith(".github/workflows/") and lower.endswith((".yml", ".yaml"))) \
                or name == ".gitlab-ci.yml" or rel == ".circleci/config.yml":
            declare(_env_names_from_yaml(_text(repo / rel), ("env", "variables", "environment")), rel)
        if suffix in CODE_EXT and not rel.startswith("docs/wiki/"):
            text = _text(repo / rel)
            if "env" not in text.lower():
                continue
            for pattern, form in ENV_PATTERNS:
                for m in pattern.finditer(text):
                    var = m.group(1)
                    used.setdefault(var, set()).add(rel)
                    seen_forms.setdefault(var, set()).add(form)
                    if m.group(2):
                        default[var] = True

    every = sorted(set(declared) | set(used))
    rows = []
    for var in every:
        if default.get(var):
            has = "yes"
        elif seen_forms.get(var, set()) & {"index"}:
            has = "no"
        else:
            has = "unknown"
        files_used = sorted(used.get(var, ()))
        rows.append([
            f"`{var}`",
            _first(sorted(declared.get(var, ()))) if var in declared else "not declared",
            _first(files_used) if files_used else "not referenced in code",
            has,
            "yes" if SECRET_NAME.search(var.upper()) else "no",
        ])
    lines = ["Names only - a value is never recorded here, even when an example file holds one.",
             ""]
    lines += table(["Variable", "Declared in", "Used in", "Has default?", "Looks secret?"], rows)
    return "\n".join(lines)


# --------------------------------------------------------------------------
# 3. Repositories and providers
# --------------------------------------------------------------------------

def sanitize_url(url: str) -> str:
    """The remote with userinfo, query and fragment removed."""
    url = url.strip()
    m = re.match(r"^([a-zA-Z][a-zA-Z0-9+.-]*://)(?:[^/@]*@)?(.*)$", url)
    if m:
        url = m.group(1) + m.group(2)
    else:
        m = re.match(r"^(?:[^@/:]+@)?([^:/]+):(.*)$", url)  # scp style
        if m:
            url = f"{m.group(1)}:{m.group(2)}"
    return re.split(r"[?#]", url, maxsplit=1)[0]


def host_of(url: str) -> str:
    m = re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:]+)", url) or re.match(r"^([^:/]+):", url)
    return m.group(1).lower() if m else ""


def _on_domain(host: str, domain: str) -> bool:
    """True when host is the domain or one of its subdomains (never a substring match)."""
    return host == domain or host.endswith("." + domain)


def provider_of(host: str) -> str:
    # ClawAI Coding Agent divergence: match by domain suffix, not substring
    # (code scanning py/incomplete-url-substring-sanitization, 2026-11-28).
    host = host.lower().rstrip(".")
    if _on_domain(host, "github.com"):
        return "github"
    if _on_domain(host, "gitlab.com"):
        return "gitlab"
    if _on_domain(host, "bitbucket.org"):
        return "bitbucket"
    if _on_domain(host, "dev.azure.com") or _on_domain(host, "visualstudio.com"):
        return "azure"
    return "other" if host else "unknown"


def _git_dir(repo: Path) -> Path | None:
    git = repo / ".git"
    return git if git.is_dir() else None


def _remotes(git: Path) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    name = ""
    for line in _text(git / "config").split("\n"):
        head = re.match(r'^\s*\[(.+?)\]\s*$', line)
        if head:
            m = re.match(r'^remote\s+"([^"]+)"$', head.group(1))
            name = m.group(1) if m else ""
            continue
        kv = re.match(r"^\s*url\s*=\s*(.+?)\s*$", line)
        if name and kv:
            out.append((name, sanitize_url(kv.group(1))))
    return sorted(set(out))


def _default_branch(git: Path) -> tuple[str, str]:
    origin = _text(git / "refs/remotes/origin/HEAD").strip()
    m = re.match(r"ref:\s*refs/remotes/origin/(.+)$", origin)
    if m:
        return m.group(1), ".git/refs/remotes/origin/HEAD"
    head = _text(git / "HEAD").strip()
    m = re.match(r"ref:\s*refs/heads/(.+)$", head)
    if m:
        return m.group(1), ".git/HEAD (checked-out branch; origin default unknown)"
    return "", ""


CI_FILES = (
    (".gitlab-ci.yml", "GitLab CI"), (".circleci/config.yml", "CircleCI"),
    ("Jenkinsfile", "Jenkins"), ("azure-pipelines.yml", "Azure Pipelines"),
    (".travis.yml", "Travis CI"), ("bitbucket-pipelines.yml", "Bitbucket Pipelines"),
)
GITHUB_FILES = (
    "dependabot.yml", "dependabot.yaml", "pull_request_template.md", "CODEOWNERS",
    "FUNDING.yml", "SECURITY.md", "CONTRIBUTING.md",
)


def repos_page(repo: Path, files: list[str]) -> str:
    fileset = set(files)
    out: list[str] = []

    # Remotes and the default branch live in `.git`, which differs between a
    # clone, a fork and CI. A page generated from them would disagree with
    # itself on every machine, so they are never generated - the curated
    # section records them once.
    out += ["### Hosting", "",
            "Remote URL and default branch are machine-local and are not "
            "generated; they are recorded in the curated section."]

    out += ["", "### CI provider", ""]
    ci: list[list[str]] = []
    workflows = sorted(f for f in files if f.startswith(".github/workflows/")
                       and f.lower().endswith((".yml", ".yaml")))
    if workflows:
        ci.append(["GitHub Actions", _first(workflows)])
    for path, label in CI_FILES:
        if path in fileset:
            ci.append([label, f"`{path}`"])
    out += table(["Provider", "File"], ci)

    out += ["", "### Code owners", ""]
    owners: dict[str, set[str]] = {}
    for path in ("CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"):
        if path in fileset:
            for line in _text(repo / path).split("\n"):
                line = line.split("#", 1)[0]
                for tok in line.split()[1:]:
                    if tok.startswith("@") or re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", tok):
                        owners.setdefault(tok, set()).add(path)
    out += table(["Owner", "Where"], [[f"`{o}`", _first(sorted(owners[o]))] for o in sorted(owners)])

    out += ["", "### .github", ""]
    gh = [f for f in files if f.startswith(".github/") and not f.startswith(".github/workflows/")
          and (Path(f).name in GITHUB_FILES or "/ISSUE_TEMPLATE/" in f)]
    out += table(["File"], [[f"`{f}`"] for f in sorted(gh)])

    out += ["", "### Submodules", ""]
    subs: list[list[str]] = []
    if ".gitmodules" in fileset:
        path = ""
        for line in _text(repo / ".gitmodules").split("\n"):
            p = re.match(r"^\s*path\s*=\s*(.+?)\s*$", line)
            u = re.match(r"^\s*url\s*=\s*(.+?)\s*$", line)
            if p:
                path = p.group(1)
            elif u:
                subs.append([f"`{path or '?'}`", _c(sanitize_url(u.group(1))), "`.gitmodules`"])
    out += table(["Path", "URL (credentials stripped)", "Where"], sorted(subs))

    out += ["", "### Monorepo workspaces", ""]
    ws: list[list[str]] = []
    for rel in files:
        name = Path(rel).name
        text = ""
        if name == "package.json" and "node_modules" not in rel:
            try:
                data = json.loads(_text(repo / rel))
            except ValueError:
                data = {}
            spaces = data.get("workspaces") if isinstance(data, dict) else None
            if isinstance(spaces, dict):
                spaces = spaces.get("packages")
            for s in spaces or []:
                ws.append([f"`{s}`", f"`{rel}`"])
        elif name == "pnpm-workspace.yaml":
            for s in re.findall(r"^\s*-\s*['\"]?([^'\"\n#]+?)['\"]?\s*$", _text(repo / rel), re.M):
                ws.append([f"`{s}`", f"`{rel}`"])
        elif name == "Cargo.toml":
            text = _text(repo / rel)
            m = re.search(r"^\[workspace\].*?^members\s*=\s*\[(.*?)\]", text, re.M | re.S)
            for s in re.findall(r"['\"]([^'\"]+)['\"]", m.group(1)) if m else []:
                ws.append([f"`{s}`", f"`{rel}`"])
        elif name in ("lerna.json", "nx.json", "turbo.json", "go.work"):
            ws.append([f"`{name}` present", f"`{rel}`"])
    out += table(["Workspace", "Where"], sorted(ws))
    return "\n".join(out)


# --------------------------------------------------------------------------
# 4. Installation
# --------------------------------------------------------------------------

LOCKFILES = (
    ("package-lock.json", "npm", "npm ci"),
    ("pnpm-lock.yaml", "pnpm", "pnpm install --frozen-lockfile"),
    ("yarn.lock", "yarn", "yarn install --frozen-lockfile"),
    ("bun.lockb", "bun", "bun install --frozen-lockfile"),
    ("bun.lock", "bun", "bun install --frozen-lockfile"),
    ("uv.lock", "uv", "uv sync"),
    ("poetry.lock", "poetry", "poetry install"),
    ("Pipfile.lock", "pipenv", "pipenv install --deploy"),
    ("requirements.txt", "pip", "pip install -r requirements.txt"),
    ("Cargo.lock", "cargo", "cargo build"),
    ("go.sum", "go", "go mod download"),
    ("go.mod", "go", "go mod download"),
    ("Gemfile.lock", "bundler", "bundle install"),
    ("composer.lock", "composer", "composer install"),
)
README_HEADING = re.compile(
    r"install|set[- ]?up|getting started|quick ?start|prerequisite|requirement|"
    r"development|build|run(ning)?\b", re.I)


def readme_sections(repo: Path, files: list[str]) -> list[tuple[str, int, str]]:
    out: list[tuple[str, int, str]] = []
    for rel in files:
        if "/" in rel or not re.match(r"^README(\.\w+)?$", rel, re.I):
            continue
        fence = False
        for number, line in enumerate(_text(repo / rel).split("\n"), 1):
            if line.lstrip().startswith(("```", "~~~")):
                fence = not fence
                continue
            m = re.match(r"^#{1,6}\s+(.+?)\s*#*\s*$", line)
            if m and not fence and README_HEADING.search(m.group(1)):
                out.append((rel, number, m.group(1)))
    return out


def _versions(repo: Path, files: list[str]) -> list[tuple[str, str, str]]:
    out: list[tuple[str, str, str]] = []
    fileset = set(files)
    for rel in files:
        name = Path(rel).name
        text = _text(repo / rel) if name in (
            ".nvmrc", ".node-version", ".python-version", ".tool-versions", "pyproject.toml",
            "go.mod", "package.json", "rust-toolchain") else ""
        if not text:
            continue
        if name in (".nvmrc", ".node-version"):
            out.append(("node", text.strip().split("\n")[0], rel))
        elif name == ".python-version":
            out.append(("python", text.strip().split("\n")[0], rel))
        elif name == ".tool-versions":
            for line in text.split("\n"):
                parts = line.split("#")[0].split()
                if len(parts) >= 2:
                    out.append((parts[0], " ".join(parts[1:]), rel))
        elif name == "pyproject.toml":
            m = re.search(r"^requires-python\s*=\s*[\"']([^\"']+)[\"']", text, re.M)
            if m:
                out.append(("python", m.group(1), rel))
        elif name == "go.mod":
            m = re.search(r"^go\s+(\S+)", text, re.M)
            if m:
                out.append(("go", m.group(1), rel))
        elif name == "package.json":
            try:
                engines = json.loads(text).get("engines")
            except (ValueError, AttributeError):
                engines = None
            if isinstance(engines, dict):
                for k in sorted(engines):
                    out.append((k, str(engines[k]), rel))
        elif name == "rust-toolchain":
            out.append(("rust", text.strip().split("\n")[0], rel))
    _ = fileset
    return sorted(set(out), key=lambda r: (r[2], r[0], r[1]))


def install_page(repo: Path, files: list[str]) -> str:
    fileset = set(files)
    out: list[str] = ["### Install commands", ""]
    rows: list[list[str]] = []
    seen_eco: set[str] = set()
    for lock, manager, command in LOCKFILES:
        if lock in fileset and manager not in seen_eco:
            seen_eco.add(manager)
            rows.append([f"`{manager}`", _c(command), f"`{lock}`"])
    if "pyproject.toml" in fileset and not {"uv", "poetry", "pip", "pipenv"} & seen_eco:
        rows.append(["`pip`", _c("pip install -e ."), "`pyproject.toml`"])
    if "package.json" in fileset and not {"npm", "pnpm", "yarn", "bun"} & seen_eco:
        rows.append(["`npm`", _c("npm install"), "`package.json`"])
    if "Cargo.toml" in fileset and "cargo" not in seen_eco:
        rows.append(["`cargo`", _c("cargo build"), "`Cargo.toml`"])
    out += table(["Package manager", "Command", "Detected from"], rows)

    out += ["", "### Run and test commands", ""]
    cmds: list[list[str]] = []
    manager = next((m for l, m, _c0 in LOCKFILES[:5] if l in fileset), "npm")
    try:
        scripts = json.loads(_text(repo / "package.json")).get("scripts") or {}
    except (ValueError, AttributeError):
        scripts = {}
    for key in ("start", "dev", "build", "test"):
        if key in scripts:
            run = f"{manager} test" if key == "test" else f"{manager} run {key}"
            cmds.append([_c(run), key, "`package.json`"])
    if any(f in fileset for f in ("pytest.ini", "tox.ini", "conftest.py")) or any(
            f.startswith("tests/") and f.endswith(".py") for f in files):
        cmds.append([_c("python -m pytest"), "test", "`tests/`"])
    if "Cargo.toml" in fileset:
        cmds.append([_c("cargo test"), "test", "`Cargo.toml`"])
    if "go.mod" in fileset:
        cmds.append([_c("go test ./..."), "test", "`go.mod`"])
    if "Makefile" in fileset:
        cmds.append([_c("make help"), "see the Makefile targets", "`Makefile`"])
    out += table(["Command", "Purpose", "Detected from"], sorted(cmds))

    out += ["", "### Runtime versions", ""]
    out += table(["Runtime", "Version", "Where"],
                 [[f"`{r}`", _c(v), f"`{p}`"] for r, v, p in _versions(repo, files)])

    out += ["", "### Prerequisites", ""]
    pre: dict[str, str] = {}
    for runtime, _v, where in _versions(repo, files):
        pre.setdefault(runtime, where)
    for lock, manager2, _cmd in LOCKFILES:
        if lock in fileset:
            pre.setdefault(manager2, lock)
    for rel in files:
        if re.match(r"^(docker-)?compose(\.[\w-]+)?\.ya?ml$", Path(rel).name.lower()) \
                or Path(rel).name.lower() == "dockerfile":
            pre.setdefault("docker", rel)
    out += table(["Prerequisite", "Implied by"], [[f"`{k}`", f"`{pre[k]}`"] for k in sorted(pre)])

    out += ["", "### Docker", ""]
    docker: list[list[str]] = []
    for rel in files:
        lower = Path(rel).name.lower()
        if re.match(r"^(docker-)?compose(\.[\w-]+)?\.ya?ml$", lower):
            docker.append([_c(f"docker compose -f {rel} up"), f"`{rel}`"])
        elif lower == "dockerfile":
            d = Path(rel).parent.as_posix()
            docker.append([_c(f"docker build {d}"), f"`{rel}`"])
    out += table(["Command", "Detected from"], sorted(docker))

    out += ["", "### Manual already written (adopted, not duplicated)", ""]
    sections = readme_sections(repo, files)
    out += table(["Section", "Where"],
                 [[_cell(h, 80), f"[{rel}:{n}]({_UP}{rel}#L{n})"] for rel, n, h in sections])
    return "\n".join(out)


# --------------------------------------------------------------------------
# Pages, merging and the CLI
# --------------------------------------------------------------------------

PAGES = (
    ("tools-and-commands.md", "Tools and commands", tools_page,
     ("Notes on tools and commands",)),
    ("environment-variables.md", "Environment variables", env_page,
     ("What each variable means and who owns its value",)),
    ("repositories.md", "Repositories and providers", repos_page,
     ("Repository ownership, access and branch policy",)),
    ("installation.md", "Installation", install_page,
     ("Manual steps the tree cannot show",)),
)


def _wrap(body: str) -> str:
    return "\n".join([
        BEGIN,
        "<!-- Facts extracted from the tree. This block is rewritten on every run;",
        "     write outside it. -->",
        body,
        "",
        f"Regenerate with: `{REGENERATE}`",
        END,
    ])


def _new_page(title: str, block: str, sections: tuple[str, ...]) -> str:
    parts = [f"# {title}", "", block, ""]
    for section in sections:
        parts += [f"## {section}", "", GAP, ""]
    return "\n".join(parts)


def plan(repo: Path, wiki: str = DEFAULT_WIKI) -> tuple[dict[Path, str], list[str]]:
    global _UP
    _UP = "../" * (len(Path(wiki).parts) + 1)
    files = _walk(repo)
    changes: dict[Path, str] = {}
    errors: list[str] = []
    for filename, title, build, sections in PAGES:
        block = _wrap(build(repo, files))
        path = repo / wiki / "infra" / filename
        current = el._read(path)
        try:
            desired = el.merge(current, title, block, _new_page(title, block, sections))
        except el.BrokenBlock as exc:
            errors.append(f"{_rel(repo, path)}: {exc}")
            continue
        if not el._same(current, desired):
            changes[path] = desired
    return changes, errors


def _rel(repo: Path, path: Path) -> str:
    try:
        return path.relative_to(repo).as_posix()
    except ValueError:
        return path.as_posix()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="extract_operations")
    parser.add_argument("root", nargs="?", default=".")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    parser.add_argument("--wiki", default=DEFAULT_WIKI,
                        help=f"wiki directory, relative to root (default {DEFAULT_WIKI})")
    args = parser.parse_args(argv)

    repo = Path(args.root).resolve()
    if not repo.is_dir():
        print(f"not a directory: {args.root}", file=sys.stderr)
        return 2
    changes, errors = plan(repo, args.wiki)
    for error in errors:
        print(f"broken generated block - fix by hand: {error}", file=sys.stderr)

    if args.write:
        for path, content in sorted(changes.items()):
            existed = path.is_file()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content.encode("utf-8"))
            print(f"{'updated' if existed else 'created'} {_rel(repo, path)}")
        if not changes:
            print(f"{args.wiki}/infra operations pages already up to date")
        return 2 if errors else 0

    for path in sorted(changes):
        print(f"{'stale' if path.is_file() else 'missing'}: {_rel(repo, path)}")
    if not changes and not errors:
        print(f"{args.wiki}/infra operations pages match the tree.")
        return 0
    if changes:
        print(f"Fix with: {REGENERATE}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
