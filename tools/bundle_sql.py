#!/usr/bin/env python3
"""Bundle the APP-1 SQL files into a few scripts you can paste into the Fabric editor.

Why: the source of truth stays one file per object (db/migrations, db/seed, db/procs,
db/views, db/dev, db/tests). Pasting about 25 files one by one is slow, and the Fabric
SQL editor's support for `GO` is not confirmed. So each source file is wrapped in its
own EXEC(N'...') inside one bundle: every file keeps its own batch (its own DECLAREs,
its own "CREATE ... must be the first statement" rule) and the Messages tab shows one
labelled block per file.

  python tools/bundle_sql.py            write db/dist/*.sql
  python tools/bundle_sql.py --check    exit 1 when db/dist is out of date

db/dist/ is GENERATED and committed so that you can open and paste a bundle without
running anything. Never edit it: change the source file and run this tool again.
db/seed/local/ is never bundled (it holds people).

Safety nets: refuses a source file that has a `GO` line, or that contains an e-mail
address (a domain ending in .test is allowed: those are the synthetic test people).
Standard library only.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "db" / "dist"

# stage file -> (title, source files relative to the repo root, in run order)
def files(folder: str, pattern: str) -> list[str]:
    return [p.relative_to(ROOT).as_posix() for p in sorted((ROOT / folder).glob(pattern))]


STAGES: dict[str, tuple[str, list[str]]] = {
    "app1_1_migrations": ("APP-1 stage 1: tables (migrations 0001-0007)", files("db/migrations", "000*.sql")),
    # 0101-0107 only: seeds added by later phases get their own stage, so a finished
    # phase's bundle never changes.
    "app1_2_seeds": ("APP-1 stage 2: configuration seeds (0101-0107)", files("db/seed", "010[1-7]_*.sql")),
    # Explicit list, not a glob: later phases add views that need the gold stub (stage 4),
    # so they must not slip into this stage. They get their own stage below.
    "app1_3_procs_views": (
        "APP-1 stage 3: functions, procedures and views",
        [
            "db/procs/fn_group_for_role.sql",
            "db/procs/usp_identity_resolve.sql",
            "db/procs/usp_principal_profile.sql",
            "db/procs/usp_route_resolve.sql",
            "db/views/vw_group_member_count.sql",
            "db/views/vw_route_check.sql",
        ],
    ),
    "app1_4_gold_stub": (
        "APP-1 stage 4: synthetic gold stub and merge stub",
        ["db/dev/gold_stub.sql", "db/dev/merge_stub.sql"],
    ),
    "app1_5_tests": (
        "APP-1 stage 5: tests",
        [
            "db/tests/t_app_schema.sql",
            "db/tests/t_security_seed.sql",
            "db/tests/t_identity_resolve.sql",
            "db/tests/t_route_resolve.sql",
            "db/tests/t_gold_contract.sql",
        ],
    ),
    # APP-2: views for the search and detail screens, then their tests. One stage: the
    # views come first in the list, so one paste creates them and then checks them.
    "app2_1_views_tests": (
        "APP-2 stage 1: field-ownership and equipment-search views, then their tests",
        [
            "db/views/vw_field_ownership.sql",
            "db/views/vw_equipment_search.sql",
            "db/tests/t_field_ownership.sql",
            "db/tests/t_equipment_search.sql",
        ],
    ),
    # APP-2, read path C (decided 15 Nov, D-17): the two read procedures behind the search and
    # detail functions, then their test. Needs stage app2_1 (the views) and the gold stub.
    "app2_2_read_procs_tests": (
        "APP-2 stage 2: equipment search and detail read procedures, then their test",
        [
            "db/procs/usp_equipment_search.sql",
            "db/procs/usp_equipment_detail.sql",
            "db/tests/t_equipment_read.sql",
        ],
    ),
    # APP-3 stage 0 (decided 16 Nov, D-18): the equipment status list the request checks use.
    # Needs app1_2 (seed 0106). Run it before the APP-3 procedures and tests.
    # 0109 (added 16 Nov, while building APP-3, before this stage was run) joins it: the list of fields
    # only an admin may request. The stage name stays so the run lists that name it stay true.
    "app3_0_seed_status": (
        "APP-3 stage 0: seeds (equipment status allowed values AVFS, NOPE, OPER, DECM; admin-only fields)",
        ["db/seed/0108_equipment_status_values.sql", "db/seed/0109_admin_only_fields.sql"],
    ),
    # APP-3 stage 1: everything the request write path is made of, in dependency order. Helper functions
    # first (the checks function uses two of them), the notification helper, the procedures (the bulk
    # procedure calls decide), then the four request views (the detail view reads the queue view).
    # Needs app1 (tables, route procedure), the gold stub or the real gold, and app3_0.
    "app3_1_request_objects": (
        "APP-3 stage 1: request helper functions, procedures and views",
        [
            "db/procs/fn_requester_rights.sql",
            "db/procs/fn_stage_eligibility.sql",
            "db/procs/fn_value_check.sql",
            "db/procs/fn_request_checks.sql",
            "db/procs/usp_notification_enqueue.sql",
            "db/procs/usp_request_create.sql",
            "db/procs/usp_request_checks.sql",
            "db/procs/usp_request_decide.sql",
            "db/procs/usp_request_bulk_decide.sql",
            "db/procs/usp_request_resubmit.sql",
            "db/procs/usp_request_cancel.sql",
            "db/procs/usp_request_record_merge.sql",
            "db/procs/usp_request_mark_exported.sql",
            "db/procs/usp_request_evidence.sql",
            "db/views/vw_request_queue.sql",
            "db/views/vw_request_event.sql",
            "db/views/vw_equipment_request.sql",
            "db/views/vw_request_detail.sql",
        ],
    ),
    # APP-3 stages 2 and 3: the tests, apart from the objects so that a compile error in a test never
    # hides whether the objects themselves compiled, and apart from each other because the lifecycle
    # test is long (about 100 KB pasted). Both roll back everything they write.
    "app3_2_request_views_test": (
        "APP-3 stage 2: request views test",
        ["db/tests/t_request_views.sql"],
    ),
    "app3_3_request_lifecycle_test": (
        "APP-3 stage 3: request lifecycle test (16 scenarios and 2 extras)",
        ["db/tests/t_request_lifecycle.sql"],
    ),
}

GO_LINE = re.compile(r"^\s*GO\s*;?\s*$", re.I | re.M)
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}")


# Engine rules that a laptop cannot see by running SQL but CAN see in the text (FINAL PLAN/01 section 5).
# Both were found the hard way: Msg 1046 on 14 Nov (APP-1) and again on 15 Nov, Msg 102 on 15 Nov (APP-2).
# One left-to-right pass drops comments and the contents of string literals, so a word inside either
# can neither hide a problem nor raise a false one.
CODE_NOISE = re.compile(r"/\*.*?\*/|--[^\n]*|N?'(?:[^']|'')*'", re.S)
PRINT_STATEMENT = re.compile(r"\bPRINT\b[^;\n]*(?:\n[ \t]*\+[^;\n]*)*", re.I)
EXEC_STATEMENT = re.compile(r"\bEXEC(?:UTE)?[ \t]+(?!\()[A-Za-z_@][\w.@]*[^;]*;", re.I | re.S)
EXEC_ARGUMENT = re.compile(r"(@\w+)[ \t\r\n]*=[ \t\r\n]*([^,;]+)")
PLAIN_ARGUMENT = re.compile(r"(?:@\w+|-?\d+(?:\.\d+)?|NULL|DEFAULT|'')(?:\s+(?:OUTPUT|OUT))?", re.I)


def code_only(text: str) -> str:
    """The SQL with comments removed and every string literal reduced to ''."""
    return CODE_NOISE.sub(lambda m: "''" if "'" in m.group(0)[:2] else " ", text)


def engine_rule_problems(text: str) -> list[str]:
    code = code_only(text)
    problems: list[str] = []
    for m in PRINT_STATEMENT.finditer(code):
        if re.search(r"\(\s*SELECT\b", m.group(0), re.I):
            problems.append(f"PRINT with a subquery (Msg 1046): put it into a variable first: {m.group(0).strip()[:70]}")
    for m in EXEC_STATEMENT.finditer(code):
        for name, value in EXEC_ARGUMENT.findall(m.group(0)):
            if not PLAIN_ARGUMENT.fullmatch(value.strip()):
                problems.append(f"EXEC argument {name} is an expression (Msg 102): use a variable or a constant: {name} = {value.strip()[:50]}")
    return problems


def read_source(rel: str) -> str:
    path = ROOT / rel
    if not path.is_file():
        raise ValueError(f"{rel}: file not found")
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
    if GO_LINE.search(text):
        raise ValueError(f"{rel}: contains a GO line; the bundler wraps files in EXEC, so GO must not be used")
    found = engine_rule_problems(text)
    if found:
        raise ValueError(f"{rel}: breaks a Fabric SQL engine rule (FINAL PLAN/01 section 5): " + "; ".join(found))
    for m in EMAIL.finditer(text):
        if not m.group(0).lower().endswith(".test"):
            raise ValueError(f"{rel}: contains an e-mail address ({m.group(0)[:3]}...); e-mails belong only in db/seed/local/")
    return text.rstrip("\n") + "\n"


def sql_literal(text: str) -> str:
    return "N'" + text.replace("'", "''") + "'"


def build(stage: str, title: str, sources: list[str]) -> str:
    if not sources:
        raise ValueError(f"{stage}: no source files found")
    out = [
        "/* =====================================================================",
        f"   {stage}.sql   {title}",
        "   GENERATED by tools/bundle_sql.py from the files listed below. Do not edit:",
        "   change the source file and run `python tools/bundle_sql.py` again.",
        "   Paste the whole file into New query of the ATLAS_SQL_DB item (type SQL database),",
        "   run it once, and copy the Messages tab. Each file runs in its own batch.",
        "   Files, in run order:",
    ]
    out += [f"     {s}" for s in sources]
    out += [
        "   ===================================================================== */",
        "SET NOCOUNT ON;",
        f"PRINT N'=== {stage}: {len(sources)} file(s) ===';",
        "",
    ]
    for rel in sources:
        out.append(f"PRINT N'--- {rel}';")
        out.append(f"EXEC ({sql_literal(read_source(rel))});")
        out.append("")
    out.append(f"PRINT N'=== end of {stage} ===';")
    return "\n".join(out) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="do not write; exit 1 if db/dist is out of date")
    args = ap.parse_args()

    stale: list[str] = []
    try:
        for stage, (title, sources) in STAGES.items():
            text = build(stage, title, sources)
            target = DIST / f"{stage}.sql"
            if args.check:
                current = target.read_text(encoding="utf-8") if target.is_file() else None
                if current != text:
                    stale.append(target.relative_to(ROOT).as_posix())
            else:
                DIST.mkdir(parents=True, exist_ok=True)
                with open(target, "w", encoding="utf-8", newline="\n") as fh:
                    fh.write(text)
                print(f"wrote {target.relative_to(ROOT).as_posix()}: {len(sources)} file(s), {len(text.encode('utf-8')) // 1024} KB")
    except ValueError as err:
        print(f"ERROR {err}")
        return 2

    if args.check:
        if stale:
            print("out of date (run: python tools/bundle_sql.py):")
            for s in stale:
                print("  - " + s)
            return 1
        print("OK: db/dist is up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
