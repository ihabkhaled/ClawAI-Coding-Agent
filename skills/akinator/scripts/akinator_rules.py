#!/usr/bin/env python3
"""Harden - rule evolution and conflict detection.

Stage 3 of the v2 pipeline. Rules are not static text: they acquire scars.

The mechanism this exists for: when rule A's **enforcement** is implicated in a
new failure B, the system holds both records - the constraint A protects, and
the failure A caused. It can then synthesize **A'** satisfying both, mark A
superseded, and link the chain forward.

**The chain is the value.** It is how the third agent understands why a rule is
shaped strangely: the strange shape is the scar tissue from B. A rule is never
deleted, only superseded, because deleting it deletes the reason.

Conflicts are **reported, never auto-resolved.** Two rules whose scopes overlap
and whose mandates disagree need a human decision recorded as an ADR. Silently
picking a winner between two constraints produces a system nobody trusts, and
the picking would be invisible in the exact place it matters most.

Optional frontmatter, absent on every v1 rule and required on none:

    id: 11
    introduced_by: failure/checker-silent-false-negative
    supersedes: [04]
    caused: [failure/migration-blocked-by-lint]
    scope: "src/billing/**"

Usage:
    python skills/akinator/scripts/akinator_rules.py graph
    python skills/akinator/scripts/akinator_rules.py conflicts
    python skills/akinator/scripts/akinator_rules.py caused <rule-id> <failure-fingerprint>
    python skills/akinator/scripts/akinator_rules.py evolve <rule-id>

Exit codes:
    0  nothing unresolved
    1  a conflict, or a rule awaiting evolution
    2  the tool could not run
"""

from __future__ import annotations

import argparse
import fnmatch
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import akinator_ledger as led  # noqa: E402

RULES_DIR = "rules"
FRONTMATTER = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)


@dataclass
class Rule:
    path: Path
    number: str
    title: str
    meta: dict[str, object] = field(default_factory=dict)
    body: str = ""

    @property
    def rid(self) -> str:
        return str(self.meta.get("id", self.number))

    @property
    def scope(self) -> str:
        return str(self.meta.get("scope", "")).strip().strip('"').strip("'")

    @property
    def supersedes(self) -> list[str]:
        return [str(v) for v in self.meta.get("supersedes", []) or []]

    @property
    def caused(self) -> list[str]:
        return [str(v) for v in self.meta.get("caused", []) or []]

    @property
    def superseded(self) -> bool:
        return bool(self.meta.get("superseded_by"))

    def mandates(self) -> list[str]:
        """The numbered propositions under 'Mandatory rules'."""
        match = re.search(
            r"^## Mandatory rules\s*\n(.*?)(?=\n## |\Z)", self.body,
            re.DOTALL | re.MULTILINE,
        )
        if not match:
            return []
        return [
            line.strip()
            for line in match.group(1).splitlines()
            if re.match(r"^\s*\d+\.\s+\S", line)
        ]


def _parse_meta(block: str) -> dict[str, object]:
    meta: dict[str, object] = {}
    for line in block.splitlines():
        if not line.strip() or line.strip().startswith("#"):
            continue
        key, _, value = line.partition(":")
        key, value = key.strip(), value.strip()
        if not key:
            continue
        if value.startswith("[") and value.endswith("]"):
            inner = value[1:-1].strip()
            meta[key] = [v.strip() for v in inner.split(",") if v.strip()]
        else:
            meta[key] = value
    return meta


def load_rules(repo: Path) -> list[Rule]:
    out: list[Rule] = []
    base = repo / RULES_DIR
    if not base.is_dir():
        return out
    for path in sorted(base.glob("*.md")):
        if path.name.lower() in ("readme.md", "index.md"):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        match = FRONTMATTER.match(text)
        meta = _parse_meta(match.group(1)) if match else {}
        # Normalized at parse so a round-trip is stable whether or not the
        # rule had frontmatter: without this, adding frontmatter to a v1
        # rule appears to change its body when only leading blank lines
        # moved.
        body = (text[match.end():] if match else text).lstrip("\n")
        number = (re.match(r"^(\d+)", path.name) or [None, path.stem])[1]
        title = re.sub(r"^#\s*", "", body.splitlines()[0]).strip() if body else path.stem
        out.append(Rule(path=path, number=str(number), title=title,
                        meta=meta, body=body))
    return out


# --------------------------------------------------------------------------
# Conflicts
# --------------------------------------------------------------------------

# Words that flip a mandate's polarity. Two mandates over the same scope where
# one requires what the other forbids is the shape of a real conflict.
FORBID = re.compile(r"\b(never|no|not|must not|may not|forbidden|prohibited)\b",
                    re.IGNORECASE)


@dataclass
class Conflict:
    left: Rule
    right: Rule
    scope: str
    detail: str


def scopes_overlap(a: str, b: str) -> bool:
    """Whether two glob scopes can match a common path.

    Deliberately conservative: an unscoped rule applies everywhere, so it
    overlaps everything. Being wrong in that direction produces a reported
    conflict a human dismisses; being wrong the other way hides one.
    """
    if not a or not b:
        return True
    if a == b:
        return True
    return fnmatch.fnmatch(a.rstrip("*/"), b) or fnmatch.fnmatch(b.rstrip("*/"), a)


def _subject(mandate: str) -> set[str]:
    words = re.findall(r"[a-z][a-z_-]{3,}", mandate.lower())
    stop = {"every", "must", "never", "always", "with", "that", "this", "into",
            "from", "them", "than", "then", "when", "which", "rule", "rules"}
    return {w for w in words if w not in stop}


def find_conflicts(repo: Path) -> list[Conflict]:
    """Rules whose scopes overlap and whose mandates disagree.

    Reported, never resolved. Silently picking a winner between two constraints
    is invisible in exactly the place it matters most.
    """
    rules = [r for r in load_rules(repo) if not r.superseded]
    out: list[Conflict] = []

    for index, left in enumerate(rules):
        for right in rules[index + 1:]:
            if not scopes_overlap(left.scope, right.scope):
                continue
            for lm in left.mandates():
                for rm in right.mandates():
                    shared = _subject(lm) & _subject(rm)
                    # Two mandates about the same subject with opposite polarity.
                    if len(shared) < 3:
                        continue
                    if bool(FORBID.search(lm)) == bool(FORBID.search(rm)):
                        continue
                    out.append(Conflict(
                        left=left, right=right,
                        scope=left.scope or right.scope or "(unscoped)",
                        detail=(
                            f"about {', '.join(sorted(shared)[:4])}\n"
                            f"      {left.number}: {lm[:110]}\n"
                            f"      {right.number}: {rm[:110]}"
                        ),
                    ))
    return out


# --------------------------------------------------------------------------
# Evolution
# --------------------------------------------------------------------------

def rules_awaiting_evolution(repo: Path) -> list[Rule]:
    """Rules whose enforcement is recorded as having caused a later failure."""
    return [r for r in load_rules(repo) if r.caused and not r.superseded]


def mark_caused(repo: Path, rule_id: str, fingerprint: str) -> Path:
    """Record that a rule's enforcement produced a failure.

    This is the input to evolution. Nothing happens automatically: the pass
    surfaces it, a human decides the shape of the replacement.
    """
    for rule in load_rules(repo):
        if rule.rid != rule_id and rule.number != rule_id:
            continue
        caused = sorted(set(rule.caused) | {fingerprint})
        rule.meta["caused"] = caused
        rule.meta.setdefault("id", rule.number)
        _write(rule)
        return rule.path
    raise SystemExit(f"no rule with id: {rule_id}")


def _write(rule: Rule) -> None:
    lines = ["---"]
    for key in ("id", "introduced_by", "supersedes", "caused", "scope",
                "superseded_by"):
        if key not in rule.meta:
            continue
        value = rule.meta[key]
        if isinstance(value, list):
            lines.append(f"{key}: [{', '.join(str(v) for v in value)}]")
        else:
            lines.append(f"{key}: {value}")
    for key, value in rule.meta.items():
        if key in ("id", "introduced_by", "supersedes", "caused", "scope",
                   "superseded_by"):
            continue
        lines.append(f"{key}: {value}")
    lines.append("---")
    lines.append("")
    # The body goes back byte-for-byte. Frontmatter is ours; the prose a human
    # wrote is not, and a generator that quietly reflows it will be distrusted
    # the first time someone notices.
    rule.path.write_text(
        "\n".join(lines) + "\n" + rule.body, encoding="utf-8", newline="\n"
    )


def evolution_brief(repo: Path, rule: Rule) -> str:
    """What a replacement rule has to satisfy - both sides, stated together."""
    ledger = led.Ledger(repo)
    caused = [
        r for r in ledger.all("failure")
        if any(r.id in c or c in r.id for c in rule.caused)
    ]

    lines = [
        f"## {rule.title}",
        "",
        f"Scope: `{rule.scope or '(unscoped)'}`",
        "",
        "### What it protects",
        "",
    ]
    lines += [f"- {m}" for m in rule.mandates()] or ["- _no mandates parsed_"]
    lines += ["", "### What its enforcement caused", ""]

    if caused:
        for record in caused:
            lines += [
                f"- **{record.title}** (seen {len(record.occurrences)}x)",
                f"  - symptom:    {' '.join(record.fields.get('symptom', '').split())[:180]}",
                # The root cause is what a replacement has to design around;
                # symptom and fix alone describe the incident, not the tension.
                f"  - root cause: {' '.join(record.fields.get('root_cause', '').split())[:220]}",
                f"  - fix:        {' '.join(record.fields.get('fix', '').split())[:180]}",
            ]
    else:
        lines += [f"- _{', '.join(rule.caused)} - no ledger record found_"]

    lines += [
        "",
        "### The replacement must satisfy both",
        "",
        "A rule that only fixes the second failure reintroduces the first, and",
        "a rule that only keeps the first is what caused the second. Write A'",
        "to hold both, then:",
        "",
        "```bash",
        f"# in the new rule's frontmatter:  supersedes: [{rule.number}]",
        f"# in rules/{rule.path.name}:      superseded_by: <new number>",
        "```",
        "",
        "The superseded rule stays. Deleting it deletes the reason the",
        "replacement is shaped the way it is, which is the only part a future",
        "reader cannot reconstruct.",
        "",
    ]
    return "\n".join(lines)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="akinator_rules")
    parser.add_argument("--root", default=".")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("graph", help="rules, scopes and supersession chains")
    sub.add_parser("conflicts", help="overlapping scopes with opposed mandates")

    caused = sub.add_parser("caused", help="record that a rule caused a failure")
    caused.add_argument("rule_id")
    caused.add_argument("fingerprint")

    evolve = sub.add_parser("evolve", help="brief for a replacement rule")
    evolve.add_argument("rule_id", nargs="?", default="")

    args = parser.parse_args(argv)
    repo = Path(args.root).resolve()

    if args.command == "graph":
        rules = load_rules(repo)
        for rule in rules:
            marks = []
            if rule.supersedes:
                marks.append(f"supersedes {', '.join(rule.supersedes)}")
            if rule.caused:
                marks.append(f"caused {', '.join(rule.caused)}")
            if rule.superseded:
                marks.append(f"SUPERSEDED by {rule.meta['superseded_by']}")
            suffix = f"  [{'; '.join(marks)}]" if marks else ""
            scope = rule.scope or "-"
            print(f"{rule.number:>3}  {scope:<24} {rule.title[:56]}{suffix}")
        print(f"\n{len(rules)} rule(s)")
        return 0

    if args.command == "conflicts":
        conflicts = find_conflicts(repo)
        for conflict in conflicts:
            print(f"CONFLICT  rules {conflict.left.number} and "
                  f"{conflict.right.number} over `{conflict.scope}`")
            print(f"      {conflict.detail}\n")
        if conflicts:
            print(
                f"{len(conflicts)} conflict(s). These are reported, never "
                "auto-resolved - record the resolution as an ADR, then narrow "
                "a scope or synthesize a replacement."
            )
            return 1
        print("no rules conflict.")
        return 0

    if args.command == "caused":
        path = mark_caused(repo, args.rule_id, args.fingerprint)
        print(f"recorded in {path.relative_to(repo).as_posix()}")
        print(f"draft the replacement with: "
              f"python skills/akinator/scripts/akinator_rules.py evolve {args.rule_id}")
        return 0

    if args.command == "evolve":
        pending = rules_awaiting_evolution(repo)
        if args.rule_id:
            pending = [r for r in pending
                       if r.rid == args.rule_id or r.number == args.rule_id]
        if not pending:
            print("no rule is recorded as having caused a failure.")
            return 0
        for rule in pending:
            print(evolution_brief(repo, rule))
        return 1

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
