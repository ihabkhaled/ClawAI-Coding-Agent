#!/usr/bin/env python3
"""Compose the context brief - what a new session actually reads.

The problem this solves is the one v1 never named: "document every needle" is a
**write** problem and "a new chat knows everything in seconds" is a **retrieval**
problem, and optimizing the first degrades the second. A corpus large enough to
hold everything is a corpus no session can read.

So the corpus stays unbounded and the brief is hard-capped. Items compete for a
place in it on value, and anything that does not fit is **demoted to a pointer**,
never dropped.

    corpus (unbounded)  ->  value ranking  ->  .ai/BRIEF.md (capped)

Budget tiers, configured in .ai/config.json:

    lean      4,000   small repos, or teams paying per token every session
    standard 12,000   the default - carries constraints and recurring failures
                      as content, not as pointers
    deep     25,000   large multi-service repos where boundaries alone are
                      expensive

The generator **fails rather than emitting an over-budget brief**. A cap that is
allowed to slip is not a cap, and the whole design rests on this one.

Usage:
    python skills/akinator/scripts/build_brief.py            # dry run, report what would change
    python skills/akinator/scripts/build_brief.py --write    # write the brief and the index
    python skills/akinator/scripts/build_brief.py --check    # exit 1 if drifted
    python skills/akinator/scripts/build_brief.py --explain  # show the ranking and what fit

Exit codes:
    0  the brief matches the tree (or --write succeeded)
    1  drift detected
    2  the generator could not run
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))

import akinator_ledger as led  # noqa: E402

BRIEF = ".ai/BRIEF.md"
INDEX = ".ai/index.json"
CONFIG = ".ai/config.json"

TIERS = {"lean": 4_000, "standard": 12_000, "deep": 25_000}
DEFAULT_TIER = "standard"

# Section budgets as a share of the tier. They sum to 1.0; the composer asserts
# it, because a section table that quietly does not add up is a cap that slips.
#
# Requirements and drift were carved out of the other sections rather than added
# on top: the tier did not grow, so every token they carry is a token something
# else no longer does. Failures and constraints still hold the largest shares.
SECTIONS: tuple[tuple[str, str, float], ...] = (
    ("identity", "What this system is", 0.05),
    ("constraints", "Constraints that must not break", 0.19),
    ("failures", "Recurring failures and their fixes", 0.21),
    ("business", "Business rules with numbers", 0.14),
    ("requirements", "Requirements - current, changed and missing", 0.10),
    ("drift", "Business and product drift", 0.07),
    ("questions", "Open questions blocking work", 0.07),
    ("map", "Where to look for what", 0.08),
    ("pointers", "Everything else, by pointer", 0.09),
)


def tokens(text: str) -> int:
    """Token estimate, deliberately crude and deliberately pessimistic.

    Four characters per token is the usual English approximation. The brief is
    budgeted, so an estimate that runs low would let it overflow in the one
    place that must not - better to under-fill than to blow the cap.
    """
    return (len(text) + 3) // 4


# --------------------------------------------------------------------------
# Value scoring
# --------------------------------------------------------------------------

@dataclass
class Item:
    """One candidate for a place in the brief."""

    section: str
    title: str
    body: str
    path: str
    score: float
    tags: list[str] = field(default_factory=list)

    @property
    def cost(self) -> int:
        return tokens(self.render())

    def render(self) -> str:
        return f"- **{self.title}** - {self.body}\n  `{self.path}`\n"

    def pointer(self) -> str:
        return f"- {self.title} - `{self.path}`\n"


def value(rediscovery_cost: float, recurrence: float, blast_radius: float) -> float:
    """value ~= rediscovery_cost x recurrence_probability x blast_radius

    The formula is what keeps the corpus from becoming uniform sludge. It says a
    per-library doc scores near zero - the library has documentation and ours
    would restate it - while the reason we chose that library, and what it did
    to us at 3am, score high.
    """
    return round(rediscovery_cost * recurrence * blast_radius, 3)


# --------------------------------------------------------------------------
# Collectors - each returns candidate items for one section
# --------------------------------------------------------------------------

FRONT = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
FIRST_PARA = re.compile(r"^(?!#|>|\||-|\*|`)(\S.+?)(?:\n\n|\Z)", re.MULTILINE | re.DOTALL)


def _clip(text: str, limit: int) -> str:
    """Truncate with an ellipsis, never mid-sentence with no marker.

    A bare `text[:limit]` looks identical whether it cut nothing or cut a
    sentence in half - the reader has no way to tell short-and-complete from
    short-and-truncated. This is the one place that distinction is made, so
    every caller gets it for free rather than reimplementing it inconsistently.
    """
    return text[:limit].rstrip() + ("..." if len(text) > limit else "")


def _summary(text: str, limit: int = 240) -> str:
    body = FRONT.sub("", text)
    body = re.sub(r"^#.*$", "", body, flags=re.MULTILINE)
    body = re.sub(r"^<!--.*?-->", "", body, flags=re.DOTALL)
    match = FIRST_PARA.search(body)
    para = " ".join((match.group(1) if match else body).split())
    return _clip(para, limit)


def collect_constraints(repo: Path) -> list[Item]:
    """Rules. The highest-value thing a session can be told before it acts."""
    out: list[Item] = []
    rules = repo / "rules"
    if not rules.is_dir():
        return out
    for path in sorted(rules.glob("*.md")):
        if path.name.lower() in ("readme.md", "index.md"):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        title = re.sub(r"^#\s*", "", text.splitlines()[0]).strip()
        # A rule with no live enforcement is worth less: it will be broken.
        enforced = "## Enforcement" in text
        out.append(Item(
            section="constraints",
            title=title,
            body=_summary(text),
            path=path.relative_to(repo).as_posix(),
            score=value(0.9, 0.9 if enforced else 0.6, 1.0),
            tags=["rule"],
        ))
    return out


def collect_failures(repo: Path) -> list[Item]:
    """Recurring failures. The whole point of the ledger reaching the brief."""
    ledger = led.Ledger(repo)
    out: list[Item] = []
    for record in ledger.all("failure"):
        seen = len(record.occurrences)
        if seen < 1:
            continue
        symptom = " ".join(record.fields.get("symptom", "").split())
        fix = " ".join(record.fields.get("fix", "").split())
        out.append(Item(
            section="failures",
            title=f"{record.title} (seen {seen}x)",
            body=f"**Symptom:** {_clip(symptom, 180)} **Fix:** {_clip(fix, 180)}",
            path=f"{led.LEDGER_DIR}/failure/{record.id}.md",
            # Recurrence is the multiplier: a thing that happened three times
            # will happen a fourth, and that is exactly what a session needs
            # warning about before it starts.
            score=value(0.9, min(1.0, 0.35 * seen), 0.95),
            tags=["failure", f"x{seen}"],
        ))
    return out


def collect_business(repo: Path) -> list[Item]:
    """Money and entitlement rules - where guessing is prohibited."""
    out: list[Item] = []
    for directory in ("docs/business", "docs/product"):
        base = repo / directory
        if not base.is_dir():
            continue
        for path in sorted(base.glob("*.md")):
            if path.name.lower() in ("readme.md", "index.md"):
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            out.append(Item(
                section="business",
                title=re.sub(r"^#\s*", "", text.splitlines()[0]).strip(),
                body=_summary(text),
                path=path.relative_to(repo).as_posix(),
                score=value(1.0, 0.8, 1.0 if "business" in directory else 0.8),
                tags=["business"],
            ))
    return out


def collect_questions(repo: Path) -> list[Item]:
    """Open questions, and answered ones - so neither is asked again."""
    ledger = led.Ledger(repo)
    out: list[Item] = []
    for record in ledger.all("question"):
        answer = " ".join(record.fields.get("answer", "").split())
        out.append(Item(
            section="questions",
            title=record.title,
            body=f"**Answered:** {answer[:220]}",
            path=f"{led.LEDGER_DIR}/question/{record.id}.md",
            score=value(0.8, 0.7, 0.7),
            tags=["question", "answered"],
        ))
    return out


# A requirement's place in the brief is decided by its status, and nothing else
# may outrank that order: what is missing blocks work, what changed invalidates
# work already done, what is current is the contract, and what was dropped is
# listed only so it is not rebuilt. Strictly decreasing, so the score sort in
# compose() reproduces the order exactly.
REQUIREMENT_WEIGHT = {
    "missing": value(1.0, 0.9, 0.9),
    "changed": value(0.9, 0.9, 0.9),
    "current": value(0.8, 0.8, 0.8),
    "dropped": value(0.6, 0.6, 0.6),
}
# A status the ledger would reject still reaches the index - never dropped - but
# ranks below every valid one. `akinator_ledger.py verify` is what flags it.
UNKNOWN_REQUIREMENT_WEIGHT = value(0.5, 0.5, 0.5)


def collect_requirements(repo: Path) -> list[Item]:
    """What the product must do - missing first, then changed, then current."""
    ledger = led.Ledger(repo)
    out: list[Item] = []
    for record in ledger.all("requirement"):
        status = record.fields.get("status", "").strip() or "no status"
        statement = " ".join(record.fields.get("statement", "").split())
        source = " ".join(record.fields.get("source", "").split())
        parts = [_clip(statement, 200) or led.MISSING]
        for key in ("acceptance", "priority", "owner"):
            extra = " ".join(record.fields.get(key, "").split())
            if extra:
                parts.append(f"**{key.title()}:** {_clip(extra, 120)}")
        parts.append(f"**Source:** {_clip(source, 100) or led.MISSING}")
        out.append(Item(
            section="requirements",
            title=f"{record.title} ({status})",
            body=" ".join(parts),
            path=f"{led.LEDGER_DIR}/requirement/{record.id}.md",
            score=REQUIREMENT_WEIGHT.get(status, UNKNOWN_REQUIREMENT_WEIGHT),
            tags=["requirement", status.replace(" ", "-")],
        ))
    return out


# Drift that touches money or what is sold does the most damage when a session
# builds on the old fact, so it carries the widest blast radius.
DRIFT_BLAST = {
    "business": 1.0,
    "pricing": 1.0,
    "product": 0.9,
    "requirement": 0.9,
    "scope": 0.9,
    "architecture": 0.85,
}


def collect_drift(repo: Path) -> list[Item]:
    """Facts that moved - so a session does not build on the old one."""
    ledger = led.Ledger(repo)
    out: list[Item] = []
    for record in ledger.all("drift"):
        area = " ".join(record.fields.get("area", "").split()) or "unspecified"
        parts = []
        for key in ("before", "after", "why", "impact"):
            text = _clip(" ".join(record.fields.get(key, "").split()), 140)
            if text or key != "impact":
                parts.append(f"**{key.title()}:** {text or led.MISSING}")
        out.append(Item(
            section="drift",
            title=f"{record.title} ({area})",
            body=" ".join(parts),
            path=f"{led.LEDGER_DIR}/drift/{record.id}.md",
            score=value(0.9, 0.8, DRIFT_BLAST.get(area.lower(), 0.8)),
            tags=["drift", area.lower()],
        ))
    return out


def collect_map(repo: Path) -> list[Item]:
    """Where to look for what - the retrieval hops, not the content."""
    candidates = (
        ("rules/README.md", "Constraints you must not break", 1.0),
        ("docs/skills.md", "How to do things here", 0.95),
        ("docs/agents.md", "Review lenses and what each vetoes", 0.7),
        ("context/README.md", "Structural facts, generated", 0.85),
        ("memory/index.md", "Durable decisions and surprises", 0.85),
        ("docs/README.md", "Architecture, decisions, compatibility", 0.9),
        ("docs/ledger.md", "What happened, and what recurs", 0.9),
        ("templates/README.md", "What gets written into target repos", 0.6),
    )
    out: list[Item] = []
    for rel, what, weight in candidates:
        if not (repo / rel).is_file():
            continue
        out.append(Item(
            section="map", title=what, body="",
            path=rel, score=value(0.7, 1.0, weight), tags=["index"],
        ))
    return out


def identity(repo: Path) -> str:
    """Two paragraphs, from the router contract. Never more."""
    contract = repo / "context" / "router-contract.md"
    if contract.is_file():
        text = contract.read_text(encoding="utf-8", errors="replace")
        match = re.search(r"^## Identity\s*\n(.*?)(?=\n## )", text,
                          re.DOTALL | re.MULTILINE)
        if match:
            return match.group(1).strip()
    readme = repo / "README.md"
    if readme.is_file():
        return _summary(readme.read_text(encoding="utf-8", errors="replace"), 400)
    return "_no identity recorded_"


def current_version(repo: Path) -> str:
    """The version the first manifest that declares one carries, or ''."""
    for rel in (".claude-plugin/plugin.json", ".codex-plugin/plugin.json",
                "package.json", "VERSION", "pyproject.toml"):
        path = repo / rel
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        if rel.endswith(".json"):
            match = re.search(r'"version"\s*:\s*"([^"]+)"', text)
        elif rel == "VERSION":
            match = re.match(r"\s*(\S+)", text)
        else:
            match = re.search(r'^version\s*=\s*"([^"]+)"', text, re.MULTILINE)
        if match:
            return match.group(1)
    return ""


# --------------------------------------------------------------------------
# Composition
# --------------------------------------------------------------------------

def load_config(repo: Path) -> dict:
    path = repo / CONFIG
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def budget_for(repo: Path) -> tuple[str, int]:
    config = load_config(repo)
    tier = config.get("brief_tier", DEFAULT_TIER)
    if tier not in TIERS:
        raise SystemExit(
            f"unknown brief tier '{tier}' in {CONFIG}; "
            f"expected one of: {', '.join(sorted(TIERS))}"
        )
    return tier, int(config.get("brief_budget", TIERS[tier]))


def compose(repo: Path) -> tuple[str, dict]:
    """Build the brief and the retrieval index."""
    assert abs(sum(share for _, _, share in SECTIONS) - 1.0) < 1e-9, (
        "section budgets must sum to 1.0 - a table that does not add up is a "
        "cap that silently slips"
    )

    tier, budget = budget_for(repo)
    version = current_version(repo)
    collectors = {
        "constraints": collect_constraints,
        "failures": collect_failures,
        "business": collect_business,
        "requirements": collect_requirements,
        "drift": collect_drift,
        "questions": collect_questions,
        "map": collect_map,
    }

    items: dict[str, list[Item]] = {}
    for key, collector in collectors.items():
        items[key] = sorted(collector(repo), key=lambda i: (-i.score, i.path))

    head = identity(repo)
    lines: list[str] = [
        "<!--",
        "GENERATED FILE - DO NOT EDIT BY HAND.",
        "Generated by `skills/akinator/scripts/build_brief.py`. Edit the sources, then regenerate.",
        "This is what a new session reads. The corpus behind it is unbounded;",
        "this file is capped, and items compete for a place in it on value.",
        "-->",
        "",
        "# Brief",
        "",
        f"_Budget: {tier} tier, {budget:,} tokens. Anything that did not fit is "
        "listed as a pointer at the end - demoted, not dropped._",
        "",
        "## What this system is",
        "",
        head,
        "",
        *([f"Current version: `{version}`. A shipped change bumps it in every "
           "manifest (`akinator_version.py`)."] if version else []),
        *([""] if version else []),
    ]

    demoted: list[Item] = []
    spent = tokens("\n".join(lines))

    for key, heading, share in SECTIONS:
        if key in ("identity", "pointers"):
            continue
        allowance = int(budget * share)
        chosen: list[Item] = []
        used = 0
        for item in items.get(key, []):
            if used + item.cost <= allowance:
                chosen.append(item)
                used += item.cost
            else:
                demoted.append(item)

        lines.append(f"## {heading}")
        lines.append("")
        if chosen:
            for item in chosen:
                lines.append(item.render().rstrip())
        else:
            lines.append("_nothing recorded yet_")
        lines.append("")
        spent += used

    if demoted:
        # The pointer section is budgeted too. It was not, at first, and the
        # overflow it was meant to absorb blew the cap it was meant to protect -
        # found by a test that forced 40 rules through a 900-token budget.
        #
        # The contract that survives is: **the brief is capped, the index is
        # complete.** A pointer that does not fit is summarized into a count,
        # never lost, because .ai/index.json carries every ranked item with its
        # score and path.
        allowance = int(budget * dict(
            (key, share) for key, _, share in SECTIONS)["pointers"])
        lines.append("## Everything else, by pointer")
        lines.append("")
        lines.append(
            "_Did not fit the budget. Read on demand - the corpus is complete "
            "even when the brief is not._"
        )
        lines.append("")

        ranked = sorted(demoted, key=lambda i: (-i.score, i.path))
        used = 0
        listed = 0
        for item in ranked:
            entry = item.pointer().rstrip()
            cost = tokens(entry)
            if used + cost > allowance:
                break
            lines.append(entry)
            used += cost
            listed += 1

        remaining = len(ranked) - listed
        if remaining:
            lines.append(
                f"- _...and {remaining} more, ranked by value in `{INDEX}`. "
                "The index is complete; this list is not._"
            )
        lines.append("")

    brief = "\n".join(lines) + "\n"

    total = tokens(brief)
    if total > budget:
        raise SystemExit(
            f"brief is {total:,} tokens, over the {tier} budget of {budget:,}.\n"
            "The generator refuses to emit an over-budget brief: a cap that is "
            "allowed to slip is not a cap, and the whole design rests on it.\n"
            "Lower a section share in SECTIONS, or raise the tier in "
            f"{CONFIG}."
        )

    index = {
        "tier": tier,
        "budget": budget,
        "used": total,
        "items": sorted(
            (
                {
                    "section": i.section,
                    "title": i.title,
                    "path": i.path,
                    "score": i.score,
                    "tokens": i.cost,
                    "tags": i.tags,
                    "in_brief": i not in demoted,
                }
                for group in items.values() for i in group
            ),
            key=lambda d: (-d["score"], d["path"]),
        ),
    }
    return brief, index


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def plan(repo: Path) -> dict[str, str]:
    brief, index = compose(repo)
    return {BRIEF: brief, INDEX: json.dumps(index, indent=2, sort_keys=True) + "\n"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="build_brief")
    parser.add_argument("root", nargs="?", default=".")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--explain", action="store_true")
    args = parser.parse_args(argv)

    repo = Path(args.root).resolve()
    if not repo.is_dir():
        print(f"not a directory: {repo}", file=sys.stderr)
        return 2

    if args.explain:
        brief, index = compose(repo)
        tier, budget = budget_for(repo)
        print(f"tier {tier}, budget {budget:,}, used {index['used']:,} "
              f"({100 * index['used'] // budget}%)\n")
        for entry in index["items"]:
            mark = "in " if entry["in_brief"] else "ptr"
            print(f"  {mark} {entry['score']:>5}  {entry['tokens']:>5}t  "
                  f"{entry['section']:<12} {entry['title'][:58]}")
        return 0

    desired = plan(repo)
    drifted = [
        rel for rel, content in desired.items()
        if not (repo / rel).is_file()
        or (repo / rel).read_text(encoding="utf-8") != content
    ]

    if args.write:
        for rel, content in sorted(desired.items()):
            path = repo / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")
        _, index = compose(repo)
        print(f"wrote {BRIEF} and {INDEX} "
              f"({index['used']:,} / {index['budget']:,} tokens)")
        return 0

    for rel in sorted(drifted):
        print(f"drifted {rel}")
    if drifted:
        print("\nFix with: python skills/akinator/scripts/build_brief.py --write")
        return 1

    print("the brief matches the tree.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
