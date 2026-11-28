#!/usr/bin/env python3
"""Generate the history wiki page from the records the repository already keeps.

`docs/wiki/history/README.md` opens with a generated block that answers "what
happened here, and in what order" without anyone retyping it:

    Versions        the version each manifest declares, and where
    Releases        every CHANGELOG.md heading with its first summary line
    Change records  every docs/changes/*.md, newest first
    Decisions       every docs/adr/NNNN-*.md with its status line
    Ledger          record counts per type, and the requirement and drift
                    titles with their status

No git calls and no clock: the page is a pure function of the files, so the
same tree always yields the same bytes. A section with nothing behind it says
`Nothing detected.` rather than inventing history.

The generated block is rewritten on every run; everything outside the markers
is preserved byte for byte (CRLF included). A missing page is created with a
title, the block, and one curated stub holding the gap marker.

Travels into host repositories: run it from the host repository root.
Standard library only; deterministic (sorted, no clock, no absolute paths).

Usage:
    python skills/akinator/scripts/extract_history.py [root]            # dry run, exit 1 if it would change
    python skills/akinator/scripts/extract_history.py [root] --write    # write the page
    python skills/akinator/scripts/extract_history.py [root] --check    # exit 1 on drift

Exit codes:
    0  page matches the tree (or --write succeeded)
    1  drift detected
    2  the tool could not run, or the page has a broken generated block
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import extract_libraries as el  # noqa: E402

PAGE = "docs/wiki/history/README.md"
TITLE = "History"
BEGIN, END, GAP = el.BEGIN, el.END, el.GAP
REGENERATE = "python skills/akinator/scripts/extract_history.py --write"
NOTHING = "Nothing detected."
LEDGER_DIR = ".ai/ledger"
LISTED_TYPES = ("requirement", "drift")
SUMMARY_MAX = 200

VERSION_MANIFESTS = (
    ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json",
    ".codex-plugin/plugin.json", "package.json",
    "pyproject.toml", "Cargo.toml", "VERSION",
)
RELEASE = re.compile(r"^##[ \t]+\[([^\]\r\n]+)\](?:[ \t]*-[ \t]*(\S+))?", re.MULTILINE)
H1 = re.compile(r"^#[ \t]+(.+?)[ \t]*$", re.MULTILINE)
DATED = re.compile(r"^(\d{4}-\d{2}-\d{2})-")
ADR_FILE = re.compile(r"^\d{4}-.+\.md$")
STATUS_LINE = re.compile(r"^[ \t]*(?:[-*][ \t]+)?\**Status:?\**:?[ \t]*(\S.*?)[ \t]*$",
                         re.IGNORECASE | re.MULTILINE)
SECTION_STATUS = re.compile(r"^##[ \t]+Status[ \t]*\n+[ \t]*([^\n#][^\n]*)", re.MULTILINE)
FRONT_TITLE = re.compile(r"^title:[ \t]*(.+?)[ \t]*$", re.MULTILINE)
FRONT_STATUS = re.compile(r"^status:[ \t]*(.+?)[ \t]*$", re.MULTILINE)
TOML_VERSION = re.compile(r"^version[ \t]*=[ \t]*[\"']([^\"']+)[\"']", re.MULTILINE)


def _text(path: Path) -> str:
    try:
        return path.read_bytes().decode("utf-8", errors="replace").replace("\r\n", "\n")
    except OSError:
        return ""


def _cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ").strip()


def _table(header: tuple[str, ...], rows: list[tuple[str, ...]]) -> list[str]:
    if not rows:
        return [NOTHING]
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    out += ["| " + " | ".join(_cell(c) for c in row) + " |" for row in rows]
    return out


# --------------------------------------------------------------------------
# Readers
# --------------------------------------------------------------------------

def versions(repo: Path) -> list[tuple[str, str]]:
    """(manifest path, version) for each root manifest that declares one."""
    out: list[tuple[str, str]] = []
    for rel in VERSION_MANIFESTS:
        path = repo / rel
        if not path.is_file():
            continue
        text = _text(path)
        version = ""
        if rel.endswith(".json"):
            try:
                data = json.loads(text)
                version = str(data.get("version", "")) if isinstance(data, dict) else ""
                if not version and isinstance(data, dict):
                    for plugin in data.get("plugins") or []:
                        if isinstance(plugin, dict) and plugin.get("version"):
                            version = str(plugin["version"])
                            break
            except ValueError:
                version = ""
        elif rel == "VERSION":
            version = text.strip().splitlines()[0].strip() if text.strip() else ""
        elif rel == "Cargo.toml":
            section = re.search(r"^\[package\]\s*\n(.*?)(?=^\[|\Z)", text, re.M | re.S)
            match = TOML_VERSION.search(section.group(1)) if section else None
            version = match.group(1) if match else ""
        else:  # pyproject.toml - [project] or [tool.poetry]
            section = re.search(r"^\[(?:project|tool\.poetry)\]\s*\n(.*?)(?=^\[|\Z)",
                                text, re.M | re.S)
            match = TOML_VERSION.search(section.group(1)) if section else None
            version = match.group(1) if match else ""
        if version:
            out.append((rel, version))
    return out


def releases(repo: Path) -> list[tuple[str, str, str]]:
    """(version, date, summary) per `## [x.y.z] - date` heading, in file order."""
    text = _text(repo / "CHANGELOG.md")
    heads = list(RELEASE.finditer(text))
    out: list[tuple[str, str, str]] = []
    for i, head in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        summary = ""
        for line in text[head.end():end].splitlines()[1:]:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            summary = re.sub(r"^[-*][ \t]+", "", stripped)
            break
        if len(summary) > SUMMARY_MAX:
            summary = summary[:SUMMARY_MAX].rstrip() + "..."
        out.append((head.group(1), head.group(2) or "-", summary or "-"))
    return out


def change_records(repo: Path) -> list[tuple[str, str, str]]:
    """(date, title, path), newest first; undated records follow, by name."""
    directory = repo / "docs" / "changes"
    dated: list[tuple[str, str, str]] = []
    undated: list[tuple[str, str, str]] = []
    if directory.is_dir():
        for path in sorted(directory.glob("*.md")):
            if path.name.lower() == "readme.md":
                continue
            heading = H1.search(_text(path))
            title = heading.group(1) if heading else path.stem
            match = DATED.match(path.name)
            row = (match.group(1) if match else "-", title,
                   path.relative_to(repo).as_posix())
            (dated if match else undated).append(row)
    dated.sort(key=lambda r: (r[0], r[2]), reverse=True)
    return dated + sorted(undated, key=lambda r: r[2])


def decisions(repo: Path) -> list[tuple[str, str, str]]:
    """(path, title, status) for every NNNN-*.md under docs/adr."""
    directory = repo / "docs" / "adr"
    out: list[tuple[str, str, str]] = []
    if directory.is_dir():
        for path in sorted(directory.glob("*.md")):
            if not ADR_FILE.match(path.name):
                continue
            text = _text(path)
            heading = H1.search(text)
            status = STATUS_LINE.search(text) or SECTION_STATUS.search(text)
            out.append((path.relative_to(repo).as_posix(),
                        heading.group(1) if heading else path.stem,
                        status.group(1) if status else "unknown"))
    return out


def ledger(repo: Path) -> tuple[list[tuple[str, int]], dict[str, list[tuple[str, str, str]]]]:
    """(counts per record type, listed type -> [(title, status, path)])."""
    base = repo / LEDGER_DIR
    counts: list[tuple[str, int]] = []
    listed: dict[str, list[tuple[str, str, str]]] = {t: [] for t in LISTED_TYPES}
    if not base.is_dir():
        return counts, listed
    for directory in sorted(p for p in base.iterdir() if p.is_dir()):
        records = sorted(directory.glob("*.md"))
        counts.append((directory.name, len(records)))
        if directory.name not in listed:
            continue
        for path in records:
            text = _text(path)
            title = FRONT_TITLE.search(text) or H1.search(text)
            status = SECTION_STATUS.search(text) or FRONT_STATUS.search(text)
            listed[directory.name].append((
                title.group(1).strip("\"'") if title else path.stem,
                status.group(1).strip() if status else "unknown",
                path.relative_to(repo).as_posix()))
    return counts, listed


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

def render_block(repo: Path) -> str:
    vers = versions(repo)
    rels = releases(repo)
    lines = [
        BEGIN,
        "<!-- Facts read from manifests, CHANGELOG.md, docs/changes, docs/adr and",
        "     .ai/ledger. Rewritten on every run; write outside this block. -->",
        "",
        "## Versions",
        "",
    ]
    lines += _table(("Manifest", "Version"), [(f"`{p}`", f"`{v}`") for p, v in vers])
    if len({v for _p, v in vers}) > 1:
        lines += ["", "Manifests disagree on the version - reconcile before releasing."]
    if vers and rels:
        newest = rels[0][0]
        if any(v != newest for _p, v in vers):
            lines += ["", f"Newest changelog release is `{newest}`; at least one manifest differs."]
    lines += ["", "## Releases", ""]
    lines += _table(("Version", "Date", "Summary"), [(f"`{v}`", d, s) for v, d, s in rels])
    lines += ["", "## Change records", ""]
    lines += _table(("Date", "Change", "Path"),
                    [(d, t, f"`{p}`") for d, t, p in change_records(repo)])
    lines += ["", "## Decisions", ""]
    lines += _table(("Decision", "Status", "Path"),
                    [(t, s, f"`{p}`") for p, t, s in decisions(repo)])
    counts, listed = ledger(repo)
    lines += ["", "## Ledger", ""]
    lines += _table(("Record type", "Records"), [(t, str(n)) for t, n in counts])
    for record_type in LISTED_TYPES:
        rows = listed[record_type]
        if not rows:
            continue
        lines += ["", f"### {record_type.capitalize()} records", ""]
        lines += _table(("Title", "Status", "Path"), [(t, s, f"`{p}`") for t, s, p in rows])
    lines += ["", f"Regenerate with: `{REGENERATE}`", END]
    return "\n".join(lines)


def plan(repo: Path) -> tuple[dict[Path, str], list[str]]:
    path = repo / PAGE
    block = render_block(repo)
    current = path.read_bytes().decode("utf-8", errors="replace") if path.is_file() else None
    new_file = f"# {TITLE}\n\n{block}\n\n## Owner notes\n\n{GAP}\n"
    try:
        desired = el.merge(current, TITLE, block, new_file)
    except el.BrokenBlock as exc:
        return {}, [f"{PAGE}: {exc}"]
    return ({} if el._same(current, desired) else {path: desired}), []


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="extract_history")
    parser.add_argument("root", nargs="?", default=".")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)

    repo = Path(args.root).resolve()
    if not repo.is_dir():
        print(f"not a directory: {args.root}", file=sys.stderr)
        return 2

    changes, errors = plan(repo)
    for error in errors:
        print(f"broken generated block - fix by hand: {error}", file=sys.stderr)

    if args.write:
        for path, content in sorted(changes.items()):
            existed = path.is_file()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content.encode("utf-8"))
            print(f"{'updated' if existed else 'created'} {path.relative_to(repo).as_posix()}")
        if not changes:
            print(f"{PAGE} already up to date")
        return 2 if errors else 0

    for path in sorted(changes):
        print(f"{'stale' if path.is_file() else 'missing'}: {path.relative_to(repo).as_posix()}")
    if not changes and not errors:
        print(f"{PAGE} matches the tree.")
        return 0
    if changes:
        print(f"Fix with: {REGENERATE}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
