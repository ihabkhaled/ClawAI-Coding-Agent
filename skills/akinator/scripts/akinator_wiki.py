#!/usr/bin/env python3
"""The living wiki - the repository as its own Confluence.

A fresh agent should be able to read one index and know where every kind of
knowledge lives: product goals, business rules and their drift, requirements
(current, changed, missing), market, architecture, libraries, stack, infra,
testing and acceptance, UX, project status, decisions, changes, terms, and how
to get productive. This tool keeps that index honest.

Three laws, each enforced here rather than hoped for:

**Adopt, never impose.** Before a category gets a page under the wiki's default
home, the tool looks for the home the repository already uses - an existing
product folder, an ADR folder, an architecture document, an ops folder, a
changelog, a README section. When one exists the index links to it. A parallel
home is how one fact gets two owners and then two answers.

**Never overwrite what a human wrote.** The only text this tool owns is the
block between the two generated markers in the wiki index:

    <!-- akinator:generated:begin -->   ...   <!-- akinator:generated:end -->

Everything outside them is preserved byte for byte, line endings included.
`init` never replaces an existing file.

**Honest gaps, never filler.** A fact nobody knows is written as the gap
marker - one line, exactly:

    _Unknown - ask the owner and record the answer._

so it can be counted, and `gaps` turns every one of them - and every category
with no home - into a concrete question for the owner. An unknown written down
is a question waiting for its answer; an unknown papered over with plausible
prose is a lie the next agent will trust.

Deterministic: sorted iteration, no clock, no absolute paths. Standard library
only, Windows and Linux.

Usage (from the repository root; `<skill>` is this skill's own folder):
    python skills/akinator/scripts/akinator_wiki.py init     # create the index and missing homes
    python skills/akinator/scripts/akinator_wiki.py index    # rewrite the generated block
    python skills/akinator/scripts/akinator_wiki.py gaps     # every unknown, as a question
    python skills/akinator/scripts/akinator_wiki.py check    # exit 1 if the index is stale
    python skills/akinator/scripts/akinator_wiki.py interview [--limit N] [--json]
    python skills/akinator/scripts/akinator_wiki.py answer --page P --line L --text T [--source S]
    python skills/akinator/scripts/akinator_wiki.py --root path/to/repo gaps --json

Exit codes:
    0  success (`gaps` always exits 0 - an unknown is a question, not a failure)
    1  `check` found the generated block stale or missing
    2  the tool could not run (not a directory, malformed markers), or `answer`
       refused (the line is not exactly the gap marker, the page is outside the
       repository, or the text is empty or carries a generated/gap marker)

`interview` turns the gaps into one ranked, grouped battery of questions - each
with a stable id (Q1, Q2, ... in the order shown), its target page and line, and
a RECOMMENDED DEFAULT the owner can accept with one word. The battery is capped
at `--limit` (default: `interrupt_budget` in `.ai/config.json`, else 15), so the
owner is interrupted once, within budget. `answer` then writes one answer over
one marker line and touches nothing else (line endings are kept byte for byte;
no clock data is written).

Ledger choice for `answer`: akinator_ledger.py sits in the same folder, so it is
imported and a `question` record (asked = the gap question, answer = the text,
answered by = --source or "owner") is written through `Ledger.write`, which
redacts. The page text is redacted with the same `redact()` before it is
written, so a pasted credential lands in neither place. If the import or the
write fails the answer still lands on the page, and the exact
`akinator_ledger.py add question ...` command is printed to run - the record is
never silently skipped.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

BEGIN = "<!-- akinator:generated:begin -->"
END = "<!-- akinator:generated:end -->"
GAP_MARKER = "_Unknown - ask the owner and record the answer._"

WIKI_DIR = "docs/wiki"
INDEX = f"{WIKI_DIR}/index.md"
TOOL = "skills/akinator/scripts/akinator_wiki.py"

SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build",
    ".next", "target", "vendor", ".pytest_cache", ".mypy_cache", ".tox",
    # ClawAI Coding Agent divergence: local VS Code downloads, lab output and session worktrees.
    ".vscode-test", ".clawai-lab", ".claude", "coverage", "test-results", "playwright-report", "builds",
}

HEADING = re.compile(r"^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")


# --------------------------------------------------------------------------
# The taxonomy - one entry per kind of knowledge the wiki must answer
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Category:
    id: str
    title: str
    home: str                 # the default home, used only when none exists
    kind: str                 # "dir" or "file" - the shape of the default home
    answers: str              # the purpose line: what this category answers
    question: str             # the one question to ask when it is unknown
    candidates: tuple[str, ...] = ()   # existing homes to adopt; "x/" is a dir
    sections: tuple[str, ...] = ()     # README headings that can serve as home


CATEGORIES: tuple[Category, ...] = (
    Category(
        "product", "Product", f"{WIKI_DIR}/product", "dir",
        "goals, users and personas, journeys, features, acceptance criteria",
        "who are the primary users, and what problem does this solve for them?",
        ("docs/product/", "docs/product.md", "docs/prd/", "PRODUCT.md"),
        ("product", "features"),
    ),
    Category(
        "business", "Business", f"{WIKI_DIR}/business", "dir",
        "business rules, pricing, entitlements, impact analysis",
        "which business rules must never break - pricing, entitlements, limits "
        "- and who owns each one?",
        ("docs/business/", "docs/business.md", "docs/domain/"),
    ),
    Category(
        "market", "Market", f"{WIKI_DIR}/market", "dir",
        "market, competitors, positioning, marketing",
        "who is this sold to, who are the main competitors, and how is it "
        "positioned against them?",
        ("docs/market/", "docs/marketing/", "docs/market.md", "docs/marketing.md"),
    ),
    Category(
        "requirements", "Requirements", f"{WIKI_DIR}/requirements", "dir",
        "the requirements register - current, changed, missing",
        "what are the current requirements, which changed recently, and which "
        "are known to be missing?",
        ("docs/requirements/", "docs/requirements.md", "docs/specs/",
         "requirements/", "specs/"),
        ("requirements",),
    ),
    Category(
        "drift", "Drift", f"{WIKI_DIR}/drift", "dir",
        "the business, product and scope drift log",
        "where has the product or business intent drifted from what was "
        "originally specified, and was each drift accepted?",
        ("docs/drift/", "docs/drift.md"),
    ),
    Category(
        "roadmap", "Roadmap", f"{WIKI_DIR}/roadmap", "dir",
        "what is planned, in what order, and why",
        "what is planned next, in what order, and why that order?",
        ("docs/roadmap/", "docs/roadmap.md", "ROADMAP.md",),
        ("roadmap",),
    ),
    Category(
        "architecture", "Architecture", f"{WIKI_DIR}/architecture", "dir",
        "the system, its modules, data and integrations",
        "what are the main components, how does data flow between them, and "
        "which external systems does it integrate with?",
        ("docs/architecture/", "docs/architecture.md", "ARCHITECTURE.md",
         "architecture/"),
        ("architecture",),
    ),
    Category(
        "services", "Services", f"{WIKI_DIR}/services", "dir",
        "frontend and backend services, entrypoints, modules",
        "which services and modules exist, what are their entrypoints, and who owns each?",
        ("docs/services/", "docs/services.md", "docs/modules/", "docs/modules.md", "docs/components.md",),
        ("services", "modules", "components"),
    ),
    Category(
        "data", "Data", f"{WIKI_DIR}/data", "dir",
        "databases, caches, queues",
        "which databases, caches and queues exist, what lives in each, and how is it migrated and backed up?",
        ("docs/data/", "docs/database/", "docs/db/", "docs/data.md", "docs/data-model.md", "docs/schema.md",),
        ("database", "data model"),
    ),
    Category(
        "integrations", "Integrations", f"{WIKI_DIR}/integrations", "dir",
        "external systems and vendors",
        "which external systems and vendors does this depend on, and what happens when each is down?",
        ("docs/integrations/", "docs/integrations.md", "docs/vendors.md", "docs/external-systems.md",),
        ("integrations",),
    ),
    Category(
        "libraries", "Libraries", f"{WIKI_DIR}/libraries", "dir",
        "one page per dependency - why it was chosen and what it did to us "
        "(generated by the libraries extractor, "
        "`python skills/akinator/scripts/extract_libraries.py`)",
        "which dependencies are critical, why were they chosen over the "
        "alternatives, and which have caused incidents?",
        ("docs/libraries/", "docs/dependencies/", "docs/dependencies.md"),
    ),
    Category(
        "stack", "Stack", f"{WIKI_DIR}/stack", "dir",
        "languages, frameworks, runtime, versions",
        "which languages, frameworks, runtimes and versions does this run on, "
        "and which versions are pinned deliberately?",
        ("docs/stack/", "docs/stack.md", "docs/tech-stack.md", "context/stack.md"),
        ("stack", "tech stack", "built with"),
    ),
    Category(
        "standards", "Standards", f"{WIKI_DIR}/standards", "dir",
        "languages, code standards, lint, hooks, imports, QA gates",
        "which code standards, lint rules, hooks, import rules and QA gates apply, and which are enforced by a tool?",
        ("docs/standards/", "docs/standards.md", "docs/coding-standards.md", "docs/conventions.md", "docs/style-guide.md", "STYLE.md", "CODE_STYLE.md",),
        ("coding standards", "code style", "conventions", "standards"),
    ),
    Category(
        "infra", "Infra", f"{WIKI_DIR}/infra", "dir",
        "environments, deploy, install, runbooks",
        "which environments exist, how is it deployed and rolled back, and "
        "where are the runbooks?",
        ("docs/ops/", "docs/infra/", "docs/infrastructure/", "docs/deploy/",
         "docs/deployment/", "docs/runbooks/", "docs/deployment.md",
         "docs/install.md", "INSTALL.md", "ops/", "infra/", "runbooks/"),
        ("deployment", "deploy", "installation", "install", "operations",
         "runbooks"),
    ),
    Category(
        "observability", "Observability", f"{WIKI_DIR}/observability", "dir",
        "logs, metrics, traces, alerts",
        "what is logged, measured, traced and alerted on, and where does someone look first in an incident?",
        ("docs/observability/", "docs/monitoring/", "docs/logging/", "docs/observability.md", "docs/monitoring.md",),
        ("observability", "monitoring", "logging"),
    ),
    Category(
        "security", "Security", f"{WIKI_DIR}/security", "dir",
        "secret handling, auth, threat model",
        "how are secrets handled, how do users and services authenticate, and what is the threat model?",
        ("docs/security/", "docs/security.md", "SECURITY.md", "docs/threat-model.md",),
        ("security",),
    ),
    Category(
        "testing", "Testing", f"{WIKI_DIR}/testing", "dir",
        "test strategy, coverage, user acceptance (UAT)",
        "what is the test strategy, what coverage is expected, and who signs "
        "off user acceptance?",
        ("docs/testing/", "docs/testing.md", "docs/qa/", "docs/uat/",
         "docs/test-plan.md", "TESTING.md"),
        ("testing", "tests", "running tests"),
    ),
    Category(
        "ux", "UX", f"{WIKI_DIR}/ux", "dir",
        "design system, UX decisions, accessibility",
        "is there a design system, which UX decisions are settled, and which "
        "accessibility standard applies?",
        ("docs/ux/", "docs/design-system/", "docs/design/", "docs/ux.md",
         "docs/design.md", "docs/accessibility.md"),
    ),
    Category(
        "project", "Project", f"{WIKI_DIR}/project", "dir",
        "milestones, status, delivery",
        "which milestone is next, what is the current status, and what is "
        "blocking delivery?",
        ("docs/project/", "docs/planning/"),
        ("status",),
    ),
    Category(
        "risks", "Risks", f"{WIKI_DIR}/risks", "dir",
        "open risks, owner, mitigation",
        "which risks are open, who owns each, and what is the mitigation?",
        ("docs/risks/", "docs/risks.md", "RISKS.md", "docs/risk-register.md",),
        ("risks",),
    ),
    Category(
        "decisions", "Decisions", f"{WIKI_DIR}/decisions", "dir",
        "the decision log - business and technical decisions, the ADR index",
        "which significant business and technical decisions have been made, "
        "which alternatives were rejected, and when should each be revisited?",
        ("docs/adr/", "docs/adrs/", "docs/decisions/",
         "docs/architecture/decisions/", "adr/", "decisions/"),
    ),
    Category(
        "changes", "Changes", f"{WIKI_DIR}/changes", "dir",
        "one change record per meaningful change - before, change, now, why",
        "what changed recently, why, and what did each change break or enable?",
        ("docs/changes/", "docs/changelog/", "CHANGELOG.md", "docs/CHANGELOG.md",
         "CHANGES.md", "HISTORY.md"),
        ("changelog", "changes", "release notes"),
    ),
    Category(
        "history", "History", f"{WIKI_DIR}/history", "dir",
        "every version and revision, what shipped when",
        "which versions and revisions exist, and what shipped in each?",
        ("docs/history/", "docs/history.md", "docs/releases/", "docs/releases.md", "RELEASES.md",),
        ("history", "releases", "version history"),
    ),
    Category(
        "glossary", "Glossary", f"{WIKI_DIR}/glossary.md", "file",
        "terms - the domain words a newcomer meets, and what each means here",
        "which domain terms does a newcomer need, and what does each mean here?",
        ("docs/glossary.md", "docs/glossary/", "GLOSSARY.md"),
        ("glossary", "terminology", "terms"),
    ),
    Category(
        "onboarding", "Onboarding", f"{WIKI_DIR}/onboarding.md", "file",
        "how a newcomer, or a fresh agent, gets productive",
        "how does a newcomer, or a fresh agent, get from clone to a verified "
        "first change?",
        ("docs/onboarding.md", "docs/onboarding/", "ONBOARDING.md",
         "docs/getting-started.md"),
        ("getting started", "quick start", "quickstart", "onboarding",
         "development", "contributing"),
    ),
)

# The router and knowledge entry points a reader should also know about.
ENTRY_POINTS: tuple[tuple[str, str], ...] = (
    ("README.md", "what this project is, and how to run it"),
    ("CLAUDE.md", "router for Claude Code"),
    ("AGENTS.md", "router for Codex and other AGENTS.md readers"),
    ("CODEX.md", "router for Codex"),
    ("GEMINI.md", "router for Gemini"),
    ("GLM.md", "router for GLM"),
    ("KIMI.md", "router for Kimi"),
    ("QWEN.md", "router for Qwen"),
    ("MISTRAL.md", "router for Mistral"),
    ("DEEPSEEK.md", "router for DeepSeek"),
    (".cursorrules", "legacy router for Cursor"),
    (".cursor/rules/", "routers for Cursor"),
    (".github/copilot-instructions.md", "router for GitHub Copilot"),
    ("CONTRIBUTING.md", "how to contribute"),
    ("rules/", "constraints that must not break, each with its enforcement"),
    ("context/", "structural facts and generated maps"),
    ("memory/", "durable decisions and surprises"),
    (".ai/BRIEF.md", "what a new session reads first"),
    ("docs/", "the documentation root"),
)


# --------------------------------------------------------------------------
# Locating homes - deterministic, case-insensitive, reports on-disk names
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Location:
    path: str                 # repo-relative, posix, on-disk spelling
    kind: str                 # "dir", "file" or "section"
    heading: str = ""         # for a section: the README heading text
    anchor: str = ""          # for a section: the heading's slug
    first: int = 0            # for a section: its first and last line
    last: int = 0


@dataclass(frozen=True)
class Gap:
    category: str | None      # category id, or None for an uncategorised page
    kind: str                 # "no-home", "empty-home" or "page"
    question: str
    path: str | None = None
    line: int | None = None
    heading: str | None = None

    def as_dict(self) -> dict:
        return {"category": self.category, "kind": self.kind,
                "question": self.question, "path": self.path,
                "line": self.line, "heading": self.heading}


@dataclass
class Resolved:
    category: Category
    locations: list[Location] = field(default_factory=list)
    pages: list[str] = field(default_factory=list)

    @property
    def home(self) -> Location | None:
        return self.locations[0] if self.locations else None

    @property
    def adopted(self) -> bool:
        """True when the primary home is one the repository already had."""
        home = self.home
        return home is not None and home.path.lower() != self.category.home.lower()


def _listdir(path: Path) -> list[str]:
    try:
        return sorted(os.listdir(path))
    except OSError:
        return []


def locate(root: Path, rel: str) -> str | None:
    """The on-disk spelling of `rel` under `root`, matched case-insensitively.

    Case matters in both directions. On Windows `Path.exists()` would accept
    `changelog.md` for `CHANGELOG.md` while Linux would not, so the same tree
    would resolve differently per OS. Matching by listing each directory gives
    one answer everywhere, and reports the name the reader will actually see.
    An exact match wins over a case-folded one; ties break alphabetically.
    """
    current = root
    found: list[str] = []
    for part in [p for p in rel.strip("/").split("/") if p]:
        names = _listdir(current)
        if part in names:
            match = part
        else:
            folded = [n for n in names if n.lower() == part.lower()]
            if not folded:
                return None
            match = folded[0]
        found.append(match)
        current = current / match
    return "/".join(found) if found else None


def _norm_heading(text: str) -> str:
    return re.sub(r"^[\W_]+|[\W_]+$", "", text.strip().lower())


def slug(heading: str) -> str:
    """GitHub's heading anchor: lowercase, punctuation dropped, spaces to -."""
    text = re.sub(r"[^\w\- ]", "", heading.strip().lower())
    return text.replace(" ", "-")


def _read(path: Path) -> str:
    # surrogateescape round-trips any byte, so text outside the generated
    # block survives even when the file is not valid UTF-8.
    return path.read_bytes().decode("utf-8", errors="surrogateescape")


@dataclass(frozen=True)
class _Line:
    number: int               # 1-based
    text: str
    in_fence: bool
    heading_level: int        # 0 when the line is not a heading
    heading: str              # the heading text, when it is one


def _scan(text: str) -> list[_Line]:
    out: list[_Line] = []
    fence: str | None = None
    for number, raw in enumerate(text.splitlines(), start=1):
        opener = FENCE.match(raw)
        if fence is None and opener:
            fence = opener.group(1)[0]
            out.append(_Line(number, raw, True, 0, ""))
            continue
        if fence is not None:
            if opener and opener.group(1)[0] == fence:
                fence = None
            out.append(_Line(number, raw, True, 0, ""))
            continue
        match = HEADING.match(raw)
        if match:
            out.append(_Line(number, raw, False, len(match.group(1)),
                             match.group(2).strip()))
        else:
            out.append(_Line(number, raw, False, 0, ""))
    return out


def readme_sections(root: Path) -> list[tuple[str, str, int, int]]:
    """(heading, normalized heading, first line, last line) per README heading."""
    rel = locate(root, "README.md")
    if rel is None or not (root / rel).is_file():
        return []
    lines = _scan(_read(root / rel))
    heads = [ln for ln in lines if ln.heading_level]
    out: list[tuple[str, str, int, int]] = []
    for index, head in enumerate(heads):
        end = len(lines)
        for later in heads[index + 1:]:
            if later.heading_level <= head.heading_level:
                end = later.number - 1
                break
        out.append((head.heading, _norm_heading(head.heading), head.number, end))
    return out


def _pages_under(root: Path, rel: str) -> list[str]:
    base = root / rel
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for name in sorted(filenames):
            if name.lower().endswith(".md"):
                out.append((Path(dirpath) / name).relative_to(root).as_posix())
    return sorted(out)


def _pages_of(root: Path, location: Location) -> list[str]:
    if location.kind == "dir":
        return _pages_under(root, location.path)
    if location.kind == "section":
        return [f"{location.path}#{location.anchor}"]
    return [location.path]


def resolve(root: Path) -> list[Resolved]:
    """Every category with its homes: adopted ones first, the default last.

    The first location is the primary home. Every other existing location is
    kept and linked too - when a repository already has two homes for one kind
    of fact, hiding one of them is how it stays duplicated.
    """
    sections = readme_sections(root)
    readme = locate(root, "README.md")
    out: list[Resolved] = []
    for category in CATEGORIES:
        locations: list[Location] = []
        seen: set[str] = set()

        def add(location: Location) -> None:
            key = f"{location.path}#{location.anchor}"
            if key not in seen:
                seen.add(key)
                locations.append(location)

        for candidate in category.candidates:
            want_dir = candidate.endswith("/")
            rel = locate(root, candidate)
            if rel is None:
                continue
            target = root / rel
            if want_dir and target.is_dir():
                add(Location(rel, "dir"))
            elif not want_dir and target.is_file():
                add(Location(rel, "file"))

        if readme is not None:
            for heading, normalized, first, last in sections:
                if normalized in category.sections:
                    add(Location(readme, "section", heading, slug(heading),
                                 first, last))

        default = locate(root, category.home)
        if default is not None:
            target = root / default
            if category.kind == "dir" and target.is_dir():
                add(Location(default, "dir"))
            elif category.kind == "file" and target.is_file():
                add(Location(default, "file"))

        pages: list[str] = []
        for location in locations:
            pages += [p for p in _pages_of(root, location) if p not in pages]
        out.append(Resolved(category, locations, sorted(pages)))
    return out


# --------------------------------------------------------------------------
# Gaps - every unknown, turned into a question
# --------------------------------------------------------------------------

def _category_question(category: Category) -> str:
    return f"{category.title}: {category.question}"


def _page_question(page: str, heading: str | None) -> str:
    if heading and heading.rstrip().endswith("?"):
        return f"{page}: {heading.strip()}"
    if heading:
        return f"{page}: {heading.strip()} is unknown - what is it?"
    return f"{page}: {Path(page).stem} is unknown - what is it?"


def page_gaps(root: Path, page: str, category: str | None,
              first: int = 1, last: int | None = None) -> list[Gap]:
    """Gap markers in one page (or one line range of it), outside fences.

    The marker must be the whole line. A page that *describes* the marker in
    backticks, or shows it inside a fenced example, is not a gap.
    """
    path = root / page
    if not path.is_file():
        return []
    gaps: list[Gap] = []
    heading: str | None = None
    for line in _scan(_read(path)):
        if line.in_fence:
            continue
        if line.heading_level:
            heading = line.heading
            continue
        if line.number < first or (last is not None and line.number > last):
            continue
        if line.text.strip() == GAP_MARKER:
            gaps.append(Gap(category, "page", _page_question(page, heading),
                            page, line.number, heading))
    return gaps


def other_wiki_pages(root: Path, resolved: list[Resolved]) -> list[str]:
    """Pages under the wiki folder that belong to no category."""
    wiki = locate(root, WIKI_DIR)
    if wiki is None or not (root / wiki).is_dir():
        return []
    index = locate(root, INDEX)
    claimed = {p for r in resolved for p in r.pages}
    return [p for p in _pages_under(root, wiki)
            if p not in claimed and p != index]


def collect_gaps(root: Path, resolved: list[Resolved] | None = None) -> list[Gap]:
    """Every open gap, in taxonomy order, each page line counted once."""
    resolved = resolve(root) if resolved is None else resolved
    gaps: list[Gap] = []
    seen: set[tuple[str, int]] = set()

    def keep(found: list[Gap]) -> None:
        for gap in found:
            key = (gap.path or "", gap.line or 0)
            if key not in seen:
                seen.add(key)
                gaps.append(gap)

    for entry in resolved:
        category = entry.category
        if not entry.locations:
            gaps.append(Gap(category.id, "no-home", _category_question(category)))
            continue
        if not entry.pages:
            # Only a folder can be a home with nothing in it - a file or a
            # README section is itself a page.
            gaps.append(Gap(category.id, "empty-home",
                            _category_question(category), entry.home.path))
        for location in entry.locations:
            if location.kind == "section":
                keep(page_gaps(root, location.path, category.id,
                               location.first, location.last))
            else:
                for page in _pages_of(root, location):
                    keep(page_gaps(root, page, category.id))

    for page in other_wiki_pages(root, resolved):
        keep(page_gaps(root, page, None))
    return gaps


# --------------------------------------------------------------------------
# Rendering the index
# --------------------------------------------------------------------------

def _link(target: str, *, is_dir: bool = False, anchor: str = "") -> str:
    """A link target for `target` that resolves from the wiki index's folder."""
    start = [p for p in WIKI_DIR.split("/") if p]
    parts = [p for p in target.split("/") if p]
    common = 0
    while (common < len(start) and common < len(parts)
           and start[common] == parts[common]):
        common += 1
    rel = "/".join([".."] * (len(start) - common) + parts[common:])
    if is_dir:
        rel += "/"
    rel = f"{rel}#{anchor}" if anchor else rel
    # CommonMark's angle-bracket form keeps a path with a space one link.
    return f"<{rel}>" if " " in rel else rel


def _cell(text: str) -> str:
    return text.replace("|", "\\|")


def _describe(location: Location) -> str:
    if location.kind == "section":
        label = f"{location.path} (section: {location.heading})"
        return f"[{_cell(label)}]({_link(location.path, anchor=location.anchor)})"
    if location.kind == "dir":
        return f"[{location.path}/]({_link(location.path, is_dir=True)})"
    return f"[{location.path}]({_link(location.path)})"


def render_block(root: Path) -> str:
    """The generated block's body - the only text in the index this tool owns."""
    resolved = resolve(root)
    gaps = collect_gaps(root, resolved)
    per_category: dict[str, int] = {}
    for gap in gaps:
        key = gap.category or ""
        per_category[key] = per_category.get(key, 0) + 1

    lines = [
        "## Categories",
        "",
        "Each category has one canonical home. **adopted** means the repository",
        "already had a home for it and the wiki links there instead of creating a",
        "parallel one.",
        "",
        "| Category | What it answers | Home | Pages | Open gaps |",
        "|---|---|---|---:|---:|",
    ]
    for entry in resolved:
        category = entry.category
        if entry.locations:
            home = _describe(entry.locations[0])
            if entry.adopted:
                home += " (adopted)"
            if len(entry.locations) > 1:
                home += "; also " + ", ".join(
                    _describe(loc) for loc in entry.locations[1:])
        else:
            home = f"none yet - run `python {TOOL} init`"
        lines.append(
            f"| {category.title} | {_cell(category.answers)} | {home} | "
            f"{len(entry.pages)} | {per_category.get(category.id, 0)} |"
        )

    others = other_wiki_pages(root, resolved)
    lines += [
        "",
        f"**Open gaps: {len(gaps)}.** A category with no home, or with a home",
        "that holds no page, counts as one gap; so does every line that is",
        "exactly the gap marker. List them as questions for the owner with",
        f"`python {TOOL} gaps`.",
        "",
    ]

    if others:
        lines += [f"## Other wiki pages ({len(others)})", ""]
        lines += [f"- [{page}]({_link(page)})" for page in others]
        lines.append("")

    lines += ["## Where the rest lives", ""]
    present = 0
    for rel, purpose in ENTRY_POINTS:
        is_dir = rel.endswith("/")
        found = locate(root, rel)
        if found is None:
            continue
        target = root / found
        if (is_dir and not target.is_dir()) or (not is_dir and not target.is_file()):
            continue
        present += 1
        label = f"{found}/" if is_dir else found
        lines.append(f"- [{label}]({_link(found, is_dir=is_dir)}) - {purpose}")
    if not present:
        lines.append("_No router or knowledge entry point exists yet._")
    lines += [
        "",
        f"Regenerate this block with `python {TOOL} index`; "
        f"`python {TOOL} check` exits 1 when it is stale.",
    ]
    return "\n".join(lines)


INDEX_HEADER = (
    "# Project wiki\n"
    "\n"
    "This repository is its own wiki. Every kind of knowledge - product,\n"
    "business, market, requirements, drift, roadmap, architecture, services,\n"
    "data, integrations, libraries, stack, standards, infra, observability,\n"
    "security, testing, UX, project, risks, decisions, changes, history,\n"
    "glossary, onboarding - has\n"
    "one canonical home, listed below. Where the repository already had a home,\n"
    "the wiki links to it; it never keeps a parallel copy.\n"
    "\n"
    "A fact nobody knows yet is written as the gap marker, a line that reads\n"
    "exactly `" + GAP_MARKER + "` - so it can be counted\n"
    "and asked, never papered over.\n"
    "\n"
    "Everything outside the generated markers below is yours to edit and is\n"
    "preserved. The block between them is regenerated.\n"
    "\n"
)


def _stub(category: Category, page: str) -> str:
    # The link back is relative to the stub's own folder, not the wiki root.
    depth = len(Path(page).parent.as_posix().split("/")) - len(WIKI_DIR.split("/"))
    index_link = "/".join([".."] * depth + ["index.md"]) if depth else "index.md"
    question = category.question[0].upper() + category.question[1:]
    return (
        f"# {category.title}\n"
        "\n"
        f"What this answers: {category.answers}.\n"
        "\n"
        f"Part of the [project wiki]({index_link}). One canonical home per fact -\n"
        "link to it, never copy it. Current truth, history and future intent are\n"
        "kept apart and labelled.\n"
        "\n"
        f"## {question}\n"
        "\n"
        f"{GAP_MARKER}\n"
    )


def _markers(text: str) -> tuple[int, int] | None | bool:
    """(begin, end) offsets of a well-formed block; None when there is no
    block; False when the markers are malformed - anything but exactly one
    begin followed by exactly one end. A malformed block is never guessed at:
    the guess would decide which human text gets overwritten."""
    begins, ends = text.count(BEGIN), text.count(END)
    if begins == 0 and ends == 0:
        return None
    begin, end = text.find(BEGIN), text.find(END)
    if begins != 1 or ends != 1 or end < begin:
        return False
    return begin, end


def _splice(text: str, body: str) -> str | None:
    """The text with the block's body replaced - or the block appended when
    there is none - or None when the markers are malformed. Nothing outside
    the markers moves, and the file's own line ending is kept."""
    newline = "\r\n" if "\r\n" in text else "\n"
    rendered = body.replace("\n", newline)
    found = _markers(text)
    if found is False:
        return None
    if found is None:
        sep = "" if text.endswith(("\n", "\r")) or not text else newline
        return (f"{text}{sep}{newline if text else ''}{BEGIN}{newline}"
                f"{rendered}{newline}{END}{newline}")
    begin, end = found
    return text[: begin + len(BEGIN)] + newline + rendered + newline + text[end:]


def current_block(text: str) -> str | None:
    """The body currently between the markers, newlines normalised; None when
    there is no well-formed block."""
    found = _markers(text)
    if not found:
        return None
    begin, end = found
    inner = text[begin + len(BEGIN): end].replace("\r\n", "\n")
    return inner.strip("\n")


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------

def _write_new(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "x", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


def _create_index(root: Path, rel: str) -> None:
    # The folder is created BEFORE rendering: creating it changes the tree the
    # block describes (the docs root appears), and a block rendered first
    # would be stale the moment it was written.
    (root / rel).parent.mkdir(parents=True, exist_ok=True)
    _write_new(root / rel, INDEX_HEADER + f"{BEGIN}\n{render_block(root)}\n{END}\n")


def init(root: Path) -> dict:
    """Create the missing homes and the index. Never touches an existing file."""
    created: list[str] = []
    adopted: dict[str, str] = {}
    for entry in resolve(root):
        category = entry.category
        if entry.locations and entry.adopted:
            home = entry.home
            adopted[category.id] = (f"{home.path}#{home.anchor}"
                                    if home.kind == "section" else home.path)
        # A category gets a page when nothing exists for it, or when its
        # default folder exists but is empty. An adopted home - even an empty
        # one - stays the host's to fill: `gaps` asks the question instead.
        if entry.locations and (entry.adopted or entry.pages):
            continue
        page = (f"{category.home}/README.md" if category.kind == "dir"
                else category.home)
        target = root / page
        if locate(root, page) is not None:
            continue
        _write_new(target, _stub(category, page))
        created.append(page)

    if locate(root, INDEX) is None:
        _create_index(root, INDEX)
        created.append(INDEX)
    return {"created": created, "adopted": dict(sorted(adopted.items()))}


def index(root: Path) -> tuple[int, str]:
    """(exit code, message) after rewriting the generated block."""
    rel = locate(root, INDEX) or INDEX
    path = root / rel
    if not path.is_file():
        _create_index(root, rel)
        return 0, f"wrote {rel}"
    text = _read(path)
    updated = _splice(text, render_block(root))
    if updated is None:
        return 2, (f"{rel}: the generated markers are malformed - expected one "
                   f"'{BEGIN}' followed by one '{END}'. Fix them by hand; "
                   "nothing was written.")
    if updated == text:
        return 0, f"{rel} already up to date"
    path.write_bytes(updated.encode("utf-8", errors="surrogateescape"))
    return 0, f"wrote {rel}"


def check(root: Path) -> tuple[int, str]:
    rel = locate(root, INDEX) or INDEX
    path = root / rel
    fix = f"Fix with: python {TOOL} index"
    if not path.is_file():
        return 1, f"{rel} is missing. {fix}"
    block = current_block(_read(path))
    if block is None:
        return 1, f"{rel} has no well-formed generated block. {fix}"
    if block != render_block(root):
        return 1, f"{rel} is stale - the generated block does not match the tree. {fix}"
    return 0, f"{rel} matches the tree."


# --------------------------------------------------------------------------
# interview - the grouped question battery
# --------------------------------------------------------------------------

DEFAULT_LIMIT = 15

RECOMMENDED_DEFAULT = (
    "Recommended: draft from the README and the code, and mark every line you "
    "cannot verify with the gap marker.")

# One recommended default per category: what to do when the owner has no time.
# Data, not logic - a default is a suggestion the owner accepts or overrides.
RECOMMENDED: dict[str, str] = {
    "product": "Recommended: draft the users and the problem from the README, "
               "and mark unverified lines with the gap marker.",
    "business": "Recommended: list only the rules the code enforces today "
                "(limits, prices, entitlements), each with the file that "
                "enforces it, and mark the owner unknown.",
    "market": "Recommended: write 'not applicable - internal tool' if nothing "
              "is sold; otherwise leave the gap marker rather than guess.",
    "requirements": "Recommended: derive the current requirements from the "
                    "tests and the README, status 'current'; record anything "
                    "unclear as 'missing'.",
    "drift": "Recommended: start empty - record a drift only when a fact is "
             "seen to move, with before, after and why.",
    "roadmap": "Recommended: take the open issues and the changelog's "
               "unreleased section as the order; mark dates unknown.",
    "architecture": "Recommended: draft from the generated component map and "
                    "the directory layout; mark the data flow unverified.",
    "services": "Recommended: list each entrypoint found in the manifests and "
                "the source tree, one line each.",
    "data": "Recommended: draft from the migrations and the schema files; "
            "mark backups and retention unknown.",
    "integrations": "Recommended: list every external host or SDK the code "
                    "calls, and mark the outage behaviour unknown.",
    "libraries": "Recommended: run the libraries extractor, then fill the "
                 "'why' only for the dependencies you chose deliberately.",
    "stack": "Recommended: run the stack extractor; it reads the manifests.",
    "standards": "Recommended: describe what the linter, formatter and hooks "
                 "already enforce; add nothing aspirational.",
    "infra": "Recommended: draft from the CI files and the install scripts; "
             "mark rollback unknown.",
    "observability": "Recommended: list the logging and metrics calls the "
                     "code makes today; mark alerting unknown.",
    "security": "Recommended: describe how secrets are loaded (never their "
                "values) and how auth works today; mark the threat model "
                "unknown.",
    "testing": "Recommended: draft from the test folder and the CI test step; "
               "mark the coverage target unknown.",
    "ux": "Recommended: write 'no design system' if none exists, rather than "
          "inventing one.",
    "project": "Recommended: state the current status in one line and mark "
               "blockers unknown.",
    "risks": "Recommended: list the risks already noted in the ledger and "
             "memory, each with an owner of 'unassigned'.",
    "decisions": "Recommended: index the existing ADRs; record business "
                 "decisions that live only in code as new records.",
    "changes": "Recommended: adopt the changelog; write change records from "
               "now on only.",
    "history": "Recommended: derive versions from the tags and the "
               "changelog; mark undated releases unknown.",
    "glossary": "Recommended: collect the capitalised domain terms from the "
                "README and the tests, one line each.",
    "onboarding": "Recommended: write the shortest path from clone to a "
                  "passing test run, and verify it by running it.",
}

# Business knowledge is the most expensive to get wrong, so it is asked first.
_FIRST = ("requirements", "business")


def recommended_for(category: str | None) -> str:
    return RECOMMENDED.get(category or "", RECOMMENDED_DEFAULT)


def interrupt_budget(root: Path) -> int:
    """`interrupt_budget` from .ai/config.json, else DEFAULT_LIMIT."""
    try:
        data = json.loads((root / ".ai" / "config.json").read_text("utf-8"))
        value = data.get("interrupt_budget")
    except (OSError, ValueError, AttributeError):
        return DEFAULT_LIMIT
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return DEFAULT_LIMIT


def _default_page(category: Category) -> str:
    return (f"{category.home}/README.md" if category.kind == "dir"
            else category.home)


def build_interview(root: Path, limit: int) -> dict:
    """The ranked, grouped, capped battery. Deterministic: no clock."""
    order = {c.id: i for i, c in enumerate(CATEGORIES)}
    by_id = {c.id: c for c in CATEGORIES}
    gaps = collect_gaps(root)

    def rank(gap: Gap) -> tuple:
        if gap.category in _FIRST:
            tier = 0
        elif gap.kind in ("no-home", "empty-home"):
            tier = 1
        elif gap.category is not None:
            tier = 2
        else:
            tier = 3
        return (tier, order.get(gap.category or "", len(order)),
                0 if gap.kind != "page" else 1, gap.path or "", gap.line or 0)

    chosen = sorted(gaps, key=rank)[:max(limit, 0)]
    # Group: categories appear in the order of their best-ranked question.
    seen: list[str] = []
    for gap in chosen:
        key = gap.category or ""
        if key not in seen:
            seen.append(key)
    chosen = sorted(chosen, key=lambda g: (seen.index(g.category or ""), rank(g)))

    questions = []
    for number, gap in enumerate(chosen, start=1):
        category = by_id.get(gap.category or "")
        path = gap.path
        if gap.kind == "no-home" and category is not None:
            path = _default_page(category)
        questions.append({
            "id": f"Q{number}",
            "category": gap.category,
            "title": category.title if category else "Other wiki pages",
            "kind": gap.kind,
            "question": gap.question,
            "path": path,
            "line": gap.line,
            "needs_init": gap.kind == "no-home",
            "recommended": recommended_for(gap.category),
        })
    return {"total": len(gaps), "shown": len(questions), "limit": limit,
            "questions": questions}


def render_interview(battery: dict) -> str:
    lines = ["# Owner interview", ""]
    if not battery["questions"]:
        return "\n".join(lines + ["No open gaps - nothing to ask."])
    lines += [
        f"{battery['shown']} of {battery['total']} open question(s), most "
        "important first. Answer by id; reply `default` to accept every "
        "recommendation.", ""]
    current = object()
    for q in battery["questions"]:
        if q["category"] != current:
            current = q["category"]
            if lines[-1] != "":
                lines.append("")
            lines += [f"## {q['title']}", ""]
        if q["line"]:
            target = f"`{q['path']}` line {q['line']}"
        elif q["needs_init"]:
            target = f"`{q['path']}` (create it first: `python {TOOL} init`)"
        else:
            target = f"`{q['path']}` (the folder holds no page yet)"
        lines += [f"- **{q['id']}** {q['question']}",
                  f"  - Target: {target}",
                  f"  - {q['recommended']}"]
    hidden = battery["total"] - battery["shown"]
    lines += [
        "",
        (f"{hidden} more not shown (limit {battery['limit']}); re-run after "
         "these are answered.") if hidden else "That is every open question.",
        "",
        f"Record an answer with: `python {TOOL} answer --page <page> "
        "--line <line> --text \"<answer>\"`",
    ]
    return "\n".join(lines)


# --------------------------------------------------------------------------
# answer - one answer over one marker line
# --------------------------------------------------------------------------

def _slug_id(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower())[:50].strip("-") or "question"


def answer(root: Path, page: str, line: int, text: str,
           source: str = "") -> tuple[int, str]:
    """Replace the gap marker on `page`:`line` with `text`. (exit code, message).

    Refuses (2) unless that line is exactly the gap marker outside a fence.
    Everything else in the file - every other byte, every line ending - is
    untouched.
    """
    rel = page.replace("\\", "/").strip("/")
    path = (root / rel).resolve()
    try:
        path.relative_to(root.resolve())
    except ValueError:
        return 2, f"{page}: outside the repository"
    if not path.is_file():
        return 2, f"{page}: no such page"
    if not text.strip():
        return 2, "refused: the answer is empty"
    if BEGIN in text or END in text:
        return 2, "refused: an answer may not contain the generated markers"
    if GAP_MARKER in text:
        return 2, "refused: an answer may not be, or contain, the gap marker"

    raw = _read(path)
    parts = raw.splitlines(keepends=True)
    scanned = _scan(raw)
    if line < 1 or line > len(parts):
        return 2, f"{rel}:{line}: no such line"
    here = scanned[line - 1]
    if here.in_fence or here.text.strip() != GAP_MARKER:
        return 2, f"{rel}:{line}: that line is not exactly the gap marker"

    question = next((g.question for g in collect_gaps(root)
                     if g.path == rel and g.line == line),
                    f"{rel}: line {line}")
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import akinator_ledger as led
    except Exception:  # noqa: BLE001 - reported below, never silent
        led = None
    clean = led.redact(text, led.env_values(root)) if led else text

    ending = parts[line - 1][len(here.text):]
    newline = ending or ("\r\n" if "\r\n" in raw else "\n")
    body = clean.strip().replace("\r\n", "\n").replace("\n", newline)
    indent = here.text[: len(here.text) - len(here.text.lstrip())]
    parts[line - 1] = indent + body + ending
    path.write_bytes("".join(parts).encode("utf-8", errors="surrogateescape"))

    owner = source.strip() or "owner"
    command = (f"python skills/akinator/scripts/akinator_ledger.py add question "
               f"--title {json.dumps(question)} "
               f"--field asked={json.dumps(question)} "
               f"--field answer={json.dumps(clean)} "
               f"--field answered_by={json.dumps(owner)}")
    if led is None:
        note = f"ledger tool not importable; run this to record it:\n  {command}"
    else:
        try:
            digest = hashlib.sha1(
                f"{rel}:{line}:{question}".encode("utf-8")).hexdigest()[:8]
            led.Ledger(root).write(led.Record(
                kind="question", id=f"{_slug_id(question)}-{digest}",
                title=question,
                fields={"asked": question, "answer": clean,
                        "answered_by": owner}))
            note = "recorded a question in the ledger"
        except Exception as exc:  # noqa: BLE001
            note = f"ledger write failed ({exc}); run this to record it:\n  {command}"
    return 0, f"answered {rel}:{line}; {note}"


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--root", default=argparse.SUPPRESS,
                        help="repository root (default: .)")
    common.add_argument("--json", action="store_true", default=argparse.SUPPRESS,
                        help="machine-readable output")
    parser = argparse.ArgumentParser(prog="akinator_wiki", parents=[common])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init", parents=[common],
                   help="create the wiki index and every missing category home")
    sub.add_parser("index", parents=[common],
                   help="rewrite the generated block of the wiki index")
    sub.add_parser("gaps", parents=[common],
                   help="every unknown, turned into a question for the owner")
    sub.add_parser("check", parents=[common],
                   help="exit 1 if the wiki index is stale or missing")
    itv = sub.add_parser("interview", parents=[common],
                         help="the grouped, ranked, capped question battery")
    itv.add_argument("--limit", type=int, default=None,
                     help="max questions (default: interrupt_budget, else 15)")
    ans = sub.add_parser("answer", parents=[common],
                         help="replace one gap marker line with an answer")
    ans.add_argument("--page", required=True)
    ans.add_argument("--line", type=int, required=True)
    ans.add_argument("--text", required=True)
    ans.add_argument("--source", default="")
    args = parser.parse_args(argv)

    root = Path(getattr(args, "root", ".")).resolve()
    as_json = getattr(args, "json", False)
    if not root.is_dir():
        print(f"not a directory: {getattr(args, 'root', '.')}", file=sys.stderr)
        return 2

    if args.command == "init":
        result = init(root)
        if as_json:
            print(json.dumps(result, indent=2, sort_keys=True))
            return 0
        for category, home in result["adopted"].items():
            print(f"adopted {home} as the {category} home")
        for page in result["created"]:
            print(f"created {page}")
        if not result["created"]:
            print("nothing to create - every category already has a home, "
                  "and nothing was overwritten.")
        return 0

    if args.command == "index":
        code, message = index(root)
        if as_json:
            print(json.dumps({"exit": code, "message": message}, sort_keys=True))
        else:
            print(message, file=sys.stderr if code else sys.stdout)
        return code

    if args.command == "check":
        code, message = check(root)
        if as_json:
            print(json.dumps({"fresh": code == 0, "message": message},
                             sort_keys=True))
        else:
            print(message)
        return code

    if args.command == "interview":
        limit = args.limit if args.limit is not None else interrupt_budget(root)
        battery = build_interview(root, limit)
        if as_json:
            print(json.dumps(battery, indent=2, sort_keys=True))
        else:
            print(render_interview(battery))
        return 0

    if args.command == "answer":
        code, message = answer(root, args.page, args.line, args.text, args.source)
        print(message, file=sys.stderr if code else sys.stdout)
        return code

    # gaps
    gaps = collect_gaps(root)
    if as_json:
        print(json.dumps({"total": len(gaps),
                          "gaps": [g.as_dict() for g in gaps]},
                         indent=2, sort_keys=True))
        return 0
    if not gaps:
        print("No open gaps - every category has a home and no page carries "
              "the unknown marker.")
        return 0
    print(f"{len(gaps)} open gap(s). Ask them in one grouped message, then write "
          "each answer into its home and delete the marker.\n")
    homeless = [g for g in gaps if g.kind in ("no-home", "empty-home")]
    marked = [g for g in gaps if g.kind == "page"]
    if homeless:
        print("Categories with no home, or a home with no page:")
        for gap in homeless:
            print(f"  - {gap.question}")
    if marked:
        if homeless:
            print()
        print("Pages with an unknown:")
        for gap in marked:
            print(f"  - {gap.question}  (line {gap.line})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
