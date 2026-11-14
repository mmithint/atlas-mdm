#!/usr/bin/env python3
r"""
gen_ref46_seed.py  (APP-1, Python 3, standard library only)

Reads the numbered text extract of the client's workbook REF-46
(ATLAS Security, Routing and Business Rule Intake) and writes the security
and routing seed files:

    db/seed/0101_roles.sql        16 roles with 10 permission flags
    db/seed/0102_groups.sql       19 groups
    db/seed/0103_routes.sql       13 approval routes + their class lists
    db/seed/0104_assignments.sql  12 group assignments + their profit-centre scopes
    db/seed/0105_role_alias.sql   route role names the client never defined

Usage (from the repository root):

    python tools/gen_ref46_seed.py --extract "C:\Users\gayatri.mangire\Documents\Oxy\OxyProject -Info\09_reference_docs\extracts\REF-46_ATLAS_Security_Routing_and_Business_Rule_Intake.txt"

    --out DIR   where to write (default: db/seed next to this tool's repository)

The extract is only ever read.

PRIVACY. Two parts of the workbook hold real people's e-mail addresses: the
USER rows of "Principal Role Assignments" and the whole "Group Memberships"
sheet. This tool never parses those cells: a USER row is counted and dropped
after its first column is read, and Group Memberships is counted per group key
from column A only. No e-mail address is read into a data structure, printed
or written. The output is deterministic (no dates, no paths), so running it
twice gives identical files.
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

# --------------------------------------------------------------------------
# Reading the extract
# --------------------------------------------------------------------------

SHEET_MARK = re.compile(r'^L(\d{4})\s+===\s*SHEET:\s*(.+?)\s*===')
ROW_LINE = re.compile(r'^L(\d{4})\s+R(\d+):\s?(.*)$')
CELL_SPLIT = re.compile(r' \| (?=[A-Z]{1,2}=)')
CELL = re.compile(r'^([A-Z]{1,2})=(.*)$', re.S)
FIRST_CELL = re.compile(r'^A=(.*?)(?= \| [A-Z]{1,2}=|$)')

WANTED = (
    'Role Definitions',
    'Approval Routes',
    'Principal Role Assignments',
    'Group Memberships',
    'Group Definitions',
    'DROP DOWNS',
)

EXPECTED_HEADERS = {
    'Role Definitions': {
        'A': 'role_name', 'B': 'description', 'C': 'can_view',
        'D': 'can_submit_requests', 'E': 'can_request_edit_business_rules',
        'F': 'can_publish_business_rules', 'G': 'can_request_edit_evidence_guidance',
        'H': 'can_publish_evidence_guidance', 'I': 'can_responsible_approve',
        'J': 'can_accountable_approve', 'K': 'can_manage_admin', 'L': 'is_active',
    },
    'Approval Routes': {
        'A': 'route_key_optional', 'B': 'entity_type', 'C': 'request_action',
        'D': 'field_or_characteristic', 'E': 'class_code_optional', 'F': 'scope_type',
        'G': 'scope_value', 'H': 'responsible_role', 'I': 'accountable_role',
        'J': 'is_active',
    },
    'Principal Role Assignments': {
        'A': 'principal_type', 'B': 'principal_key', 'C': 'principal_display_name',
        'D': 'role_name', 'E': 'scope_type', 'F': 'scope_value',
        'G': 'Planner_Group_Description_optional', 'H': 'is_active',
    },
    'Group Definitions': {
        'A': 'group_key', 'B': 'display_name', 'C': 'group_source',
        'D': 'entra_object_id_optional', 'E': 'is_active',
    },
}

# What the seeds are expected to contain (checked; a mismatch means the client
# file changed and a person must look at it).
EXPECTED = {
    'roles': 16, 'groups': 19, 'routes': 13, 'route_classes': 100,
    'group_assignments': 12, 'all_orcm_assignments': 3, 'list_assignments': 9,
    'scope_rows': 30, 'aliases': 1, 'profit_centres': 10,
    'user_rows_skipped': 2, 'membership_rows': 8,
}


class Row:
    __slots__ = ('lineno', 'rownum', 'cells')

    def __init__(self, lineno: int, rownum: int, cells: dict[str, str]):
        self.lineno, self.rownum, self.cells = lineno, rownum, cells

    def get(self, col: str) -> str | None:
        v = self.cells.get(col)
        if v is None:
            return None
        v = v.strip()
        return v if v else None

    @property
    def src(self) -> str:
        return f'R{self.rownum} [REF-46:L{self.lineno:04d}]'


def parse_cells(body: str) -> dict[str, str]:
    cells: dict[str, str] = {}
    for part in CELL_SPLIT.split(body):
        m = CELL.match(part)
        if m:
            cells[m.group(1)] = m.group(2).strip()
    return cells


def read_extract(path: Path):
    sheets: dict[str, list[Row]] = {name: [] for name in WANTED}
    stats = {'user_rows_skipped': 0, 'membership_by_group': Counter(), 'membership_unreadable': 0}
    current = None
    with open(path, encoding='utf-8') as fh:
        for raw in fh:
            line = raw.rstrip('\r\n')
            m = SHEET_MARK.match(line)
            if m:
                current = m.group(2) if m.group(2) in WANTED else None
                continue
            if current is None:
                continue
            m = ROW_LINE.match(line)
            if not m:
                continue
            lineno, rownum, body = int(m.group(1)), int(m.group(2)), m.group(3)

            if current == 'Group Memberships':
                if rownum == 1:
                    continue
                fm = FIRST_CELL.match(body)          # column A only: never B (the e-mail)
                if fm and fm.group(1).strip():
                    stats['membership_by_group'][fm.group(1).strip()] += 1
                else:
                    stats['membership_unreadable'] += 1
                continue

            if current == 'Principal Role Assignments' and rownum > 1:
                fm = FIRST_CELL.match(body)
                if fm and fm.group(1).strip().upper() == 'USER':
                    stats['user_rows_skipped'] += 1   # counted, then dropped unread
                    continue

            sheets[current].append(Row(lineno, rownum, parse_cells(body)))
    return sheets, stats


def check_header(sheet: str, rows: list[Row]) -> list[Row]:
    if not rows or rows[0].rownum != 1:
        die(f'sheet "{sheet}" has no header row in the extract')
    expected = EXPECTED_HEADERS.get(sheet)
    if expected:
        got = {k: v for k, v in rows[0].cells.items() if v}
        if got != expected:
            die(f'header of "{sheet}" is not what the generator expects.\n  expected {expected}\n  found    {got}')
    return [r for r in rows if r.rownum >= 2]


def die(msg: str):
    print(f'ERROR: {msg}', file=sys.stderr)
    sys.exit(1)


def yes_no(row: Row, col: str, default: int | None = None) -> int:
    v = row.get(col)
    if v is None:
        if default is None:
            die(f'{row.src}: column {col} is blank and has no default')
        return default
    u = v.upper()
    if u in ('YES', 'Y', 'TRUE', '1'):
        return 1
    if u in ('NO', 'N', 'FALSE', '0'):
        return 0
    die(f'{row.src}: column {col} is "{v}", expected YES or NO')
    return 0


# --------------------------------------------------------------------------
# The data model of the seeds
# --------------------------------------------------------------------------

ROLE_FLAGS = [
    ('C', 'can_view'), ('D', 'can_submit_requests'),
    ('E', 'can_request_edit_business_rules'), ('F', 'can_publish_business_rules'),
    ('G', 'can_request_edit_evidence_guidance'), ('H', 'can_publish_evidence_guidance'),
    ('I', 'can_responsible_approve'), ('J', 'can_accountable_approve'),
    ('K', 'can_manage_admin'), ('L', 'is_active'),
]
ENTITY_MAP = {'EQUIPMENT': 'EQUIPMENT', 'FUNCTIONAL LOCATION': 'FLOC'}


def build_roles(rows):
    out = []
    for r in rows:
        name = r.get('A')
        if not name:
            die(f'{r.src}: role without a name')
        flags = [yes_no(r, col) for col, _ in ROLE_FLAGS]
        out.append((r, [name, r.get('B')] + flags))
    return out


def build_groups(rows):
    out = []
    for r in rows:
        key = r.get('A')
        if not key:
            die(f'{r.src}: group without a key')
        out.append((r, [key, r.get('B') or key, r.get('C'), r.get('D'), yes_no(r, 'E', default=1)]))
    return out


def split_list(value: str | None) -> list[str]:
    if not value:
        return []
    seen, out = set(), []
    for part in value.split(','):
        p = part.strip()
        if p and p not in seen:
            seen.add(p)
            out.append(p)
    return out


def build_routes(rows):
    out = []
    for r in rows:
        if r.get('A') is not None or r.get('G') is not None:
            die(f'{r.src}: route_key_optional or scope_value is filled; the app.approval_route table has no column '
                f'for scope_value and the key was blank in the file we analysed. Look at it before loading.')
        entity = ENTITY_MAP.get((r.get('B') or '').upper())
        if not entity:
            die(f'{r.src}: unknown entity "{r.get("B")}"')
        action = (r.get('C') or '').upper()
        if action not in ('CREATE', 'UPDATE'):
            die(f'{r.src}: unknown action "{r.get("C")}"')
        field = r.get('D') or '*'
        classes_raw = r.get('E') or '*'
        classes = [] if classes_raw == '*' else split_list(classes_raw)
        scope_type = r.get('F') or die(f'{r.src}: route without scope_type')
        resp, acc = r.get('H'), r.get('I')
        if not resp or not acc:
            die(f'{r.src}: route without responsible or accountable role')
        out.append({
            'row': r, 'entity': entity, 'action': action, 'field': field,
            'class_scope': 'ANY' if classes_raw == '*' else 'LIST', 'classes': classes,
            'scope_type': scope_type, 'responsible': resp, 'accountable': acc,
            'active': yes_no(r, 'J', default=1),
        })
    return out


def build_assignments(rows, profit_centres, role_names):
    out = []
    for r in rows:
        ptype = (r.get('A') or '').upper()
        if ptype != 'GROUP':
            die(f'{r.src}: principal_type "{ptype}" reached the builder (USER rows should have been skipped)')
        key, role = r.get('B'), r.get('D')
        if not key or not role:
            die(f'{r.src}: assignment without principal_key or role_name')
        if role not in role_names:
            die(f'{r.src}: role "{role}" is not defined in Role Definitions')
        scope_value = r.get('F')
        scope_type = r.get('E')
        if scope_type is None:
            if not scope_value:
                die(f'{r.src}: neither scope_type nor scope_value given')
            scope_type = 'PROFIT_CENTER_LIST'
        elif scope_type not in ('ALL_ORCM', 'PROFIT_CENTER_LIST'):
            die(f'{r.src}: unknown scope_type "{scope_type}"')
        scopes = split_list(scope_value) if scope_type == 'PROFIT_CENTER_LIST' else []
        if scope_type == 'ALL_ORCM' and scope_value:
            die(f'{r.src}: ALL_ORCM with a scope list; look at it before loading')
        for s in scopes:
            if s not in profit_centres:
                die(f'{r.src}: scope "{s}" is not one of the ten profit centres in DROP DOWNS')
        out.append({
            'row': r, 'type': 'GROUP', 'key': key, 'display': r.get('C'), 'role': role,
            'scope_type': scope_type, 'scope_value': scope_value if scope_type == 'PROFIT_CENTER_LIST' else None,
            'scopes': scopes, 'planner': r.get('G'), 'active': yes_no(r, 'H', default=1),
        })
    return out


def build_aliases(routes, role_names):
    used: dict[str, list[str]] = {}
    for rt in routes:
        for which, name in (('responsible', rt['responsible']), ('accountable', rt['accountable'])):
            if name not in role_names:
                used.setdefault(name, []).append(f'{which} on {rt["row"].src}')
    out = []
    for alias, where in sorted(used.items()):
        target = alias.split(' - ')[0].strip() if ' - ' in alias else None
        if not target or target not in role_names:
            die(f'cannot resolve route role "{alias}" (used as {where[0]}) to a defined role; '
                f'decide the mapping before loading')
        out.append({'alias': alias, 'role': target, 'where': where})
    return out


# --------------------------------------------------------------------------
# SQL writing
# --------------------------------------------------------------------------

SOURCE_NAME = 'REF-46_ATLAS_Security_Routing_and_Business_Rule_Intake.txt'


def q(v) -> str:
    if v is None:
        return 'NULL'
    return "N'" + str(v).replace("'", "''") + "'"


def guard(tag: str, tables: list[str], migration: str) -> str:
    lines = [
        "IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11",
        "   OR @@VERSION LIKE N'%Data Warehouse%'",
        "   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'",
        "BEGIN",
        f"    PRINT 'FAIL {tag}.0 wrong editor: connected to \"' + DB_NAME() + '\" on engine ' + ISNULL(CAST(SERVERPROPERTY('EngineEdition') AS varchar(20)), '?') + ' (11 = the warehouse-style engine, which the SQL analytics endpoint uses). Open the item named ATLAS_SQL_DB whose type is SQL database and run this from New query there. Nothing was changed.';",
        "    RETURN;",
        "END",
    ]
    for i, t in enumerate(tables, start=1):
        lines += [
            f"IF OBJECT_ID(N'{t}', N'U') IS NULL",
            "BEGIN",
            f"    PRINT 'FAIL {tag}.{i} table {t} not found: run migration {migration} first. Nothing was changed.';",
            "    RETURN;",
            "END",
        ]
    return '\n'.join(lines)


def header(file_name: str, what: str, source: str, target: str, notes: list[str]) -> str:
    body = [
        '/* =====================================================================',
        f'   {file_name}',
        f'   Loads     : {what}',
        f'   Source    : {source}',
        f'   Writes to : {target}',
        '   Database  : the ATLAS Fabric SQL database (item of type SQL database)',
        '   Re-runnable: yes (see the notes below)',
    ]
    for n in notes:
        body.append(f'   {n}')
    body += [
        '',
        f'   GENERATED by tools/gen_ref46_seed.py from {SOURCE_NAME}.',
        '   Do not edit by hand: change the generator and run it again.',
        "   Contains no person's e-mail address (those go only in db/seed/local/).",
        '   ===================================================================== */',
    ]
    return '\n'.join(body)


def lines_of(rows: list[Row]) -> str:
    """Line range of a sheet, header included."""
    return f'L{rows[0].lineno:04d}-L{rows[-1].lineno:04d}'


def keyed_seed(file_id, file_name, what, source, table, key_col, cols, data, migration, label):
    """cols: [(name, sqltype)]; data: [(Row, [values])]; key_col is the first column."""
    names = [c for c, _ in cols]
    decl = ',\n'.join(
        f'        {c} {t} NOT NULL' + (' PRIMARY KEY' if c == key_col else '')
        if not t.endswith('NULL') else f'        {c} {t}'
        for c, t in cols
    )
    values = []
    for i, (row, vals) in enumerate(data):
        rendered = ', '.join(('NULL' if v is None else (str(v) if isinstance(v, int) else q(v))) for v in vals)
        last = i == len(data) - 1
        values.append(f'        ({rendered}){";" if last else ","}   -- {row.src}')
    non_key = [c for c in names if c != key_col]
    set_clause = ',\n            '.join(f't.{c} = s.{c}' for c in non_key)
    s_cols = ', '.join(f's.{c}' for c in non_key)
    t_cols = ', '.join(f't.{c}' for c in non_key)
    insert_cols = ', '.join(names)
    select_cols = ', '.join(f's.{c}' for c in names)

    return '\n'.join([
        header(file_name, what, source, table,
               ['Existing rows with the same key are updated to the values below; missing rows are added;',
                'nothing is deleted.']),
        'SET NOCOUNT ON;',
        '',
        guard(file_id, [table], migration),
        '',
        'BEGIN TRY',
        '    DECLARE @src TABLE',
        '    (',
        decl,
        '    );',
        f'    INSERT INTO @src ({insert_cols}) VALUES',
        '\n'.join(values),
        '',
        '    DECLARE @n_updated int = 0, @n_new int = 0, @n_source int = (SELECT COUNT(*) FROM @src);',
        '',
        '    BEGIN TRANSACTION;',
        f'    UPDATE t SET',
        f'            {set_clause}',
        f'    FROM {table} AS t',
        f'    JOIN @src AS s ON s.{key_col} = t.{key_col}',
        f'    WHERE EXISTS (SELECT {s_cols} EXCEPT SELECT {t_cols});',
        '    SET @n_updated = @@ROWCOUNT;',
        '',
        f'    INSERT INTO {table} ({insert_cols})',
        f'    SELECT {select_cols}',
        '    FROM @src AS s',
        f'    WHERE NOT EXISTS (SELECT 1 FROM {table} AS t WHERE t.{key_col} = s.{key_col});',
        '    SET @n_new = @@ROWCOUNT;',
        '    COMMIT TRANSACTION;',
        '',
        f"    PRINT 'OK  {file_id} loaded: ' + CAST(@n_source AS varchar(12)) + ' {label} (' + CAST(@n_new AS varchar(12)) + ' new, ' + CAST(@n_updated AS varchar(12)) + ' updated)';",
        'END TRY',
        'BEGIN CATCH',
        '    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;',
        f"    PRINT 'FAIL {file_id}.9 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();",
        'END CATCH;',
        '',
    ])


def sql_roles(rows, data):
    cols = [('role_name', 'nvarchar(64)'), ('description', 'nvarchar(400) NULL')] + \
           [(n, 'bit') for _, n in ROLE_FLAGS]
    return keyed_seed('0101', '0101_roles.sql', '16 roles with 10 permission flags',
                      f'REF-46 sheet "Role Definitions" [REF-46:{lines_of(rows)}]',
                      'app.role', 'role_name', cols, data, '0003_security.sql', 'roles')


def sql_groups(rows, data):
    cols = [('group_key', 'nvarchar(64)'), ('display_name', 'nvarchar(100)'),
            ('group_source', 'nvarchar(30) NULL'), ('entra_object_id', 'nvarchar(64) NULL'),
            ('is_active', 'bit')]
    return keyed_seed('0102', '0102_groups.sql', '19 approver and user groups',
                      f'REF-46 sheet "Group Definitions" [REF-46:{lines_of(rows)}]; '
                      'is_active is blank in the file and loaded as 1',
                      'app.security_group', 'group_key', cols, data, '0003_security.sql', 'groups')


def sql_aliases(rows, aliases):
    cols = [('alias_name', 'nvarchar(64)'), ('role_name', 'nvarchar(64)'), ('is_assumption', 'bit'),
            ('related_question', 'nvarchar(40) NULL'), ('note', 'nvarchar(400) NULL')]
    data = []
    for a in aliases:
        where = '; '.join(a['where'])
        note = (f'Working assumption WA-02 [INFERRED]: the client file uses "{a["alias"]}" in approval routes '
                f'({where}) but defines no such role in Role Definitions; read as "{a["role"]}". '
                f'Awaiting the client answer to Q-496.')
        if len(note) > 400:
            die(f'alias note for "{a["alias"]}" is longer than 400 characters')
        first_src = a['where'][0].split(' on ', 1)[-1]
        label = _Label(f'{len(a["where"])} uses in routes, first {first_src}')
        data.append((label, [a['alias'], a['role'], 1, 'Q-496', note]))
    return keyed_seed('0105', '0105_role_alias.sql',
                      'route role names that the client file does not define (working assumption WA-02)',
                      f'derived from the responsible / accountable roles of the REF-46 sheet "Approval Routes" '
                      f'[REF-46:{lines_of(rows)}]',
                      'app.role_alias', 'alias_name', cols, data, '0003_security.sql', 'aliases')


class _Label:
    """Carries only the text of the per-row source comment."""
    def __init__(self, src: str):
        self.src = src


def sql_routes(rows, routes, aliases_by_name):
    parts = [
        header('0103_routes.sql', '13 approval routes (who approves what) and their class lists',
               f'REF-46 sheet "Approval Routes" [REF-46:{lines_of(rows)}]',
               'app.approval_route, app.approval_route_class',
               ['Loads only when app.approval_route is empty (route ids are identity values, so a second',
                'load would duplicate every route). To change a route later, use a new seed file.',
                'Precedence between routes (field-specific, then class-specific, then wildcard) is decided',
                'by app.usp_route_resolve, not here [INFERRED: REF-46 analysis 4.2].']),
        'SET NOCOUNT ON;',
        '',
        guard('0103', ['app.approval_route', 'app.approval_route_class'], '0003_security.sql'),
        '',
        'BEGIN TRY',
        '    DECLARE @existing int = (SELECT COUNT(*) FROM app.approval_route);',
        '    IF @existing > 0',
        "        PRINT 'INFO 0103 app.approval_route already holds ' + CAST(@existing AS varchar(12)) + ' rows: routes are not loaded twice, skipped.';",
        '    ELSE',
        '    BEGIN',
        '        DECLARE @r int;',
        '        BEGIN TRANSACTION;',
    ]
    for rt in routes:
        r = rt['row']
        alias_note = ''
        for which in ('responsible', 'accountable'):
            if rt[which] in aliases_by_name:
                alias_note += f' [{which} role "{rt[which]}" is an alias, see 0105]'
        classes_txt = '*' if rt['class_scope'] == 'ANY' else f'a list of {len(rt["classes"])}'
        parts += [
            '',
            f'        -- {r.src}  {rt["entity"]} {rt["action"]}, field {rt["field"]}, classes {classes_txt}: '
            f'{rt["responsible"]} -> {rt["accountable"]}{alias_note}',
            '        INSERT INTO app.approval_route',
            '            (route_key, entity_type, request_action, field_or_characteristic, class_scope, scope_type, responsible_role, accountable_role, is_active)',
            f'        VALUES (NULL, {q(rt["entity"])}, {q(rt["action"])}, {q(rt["field"])}, {q(rt["class_scope"])}, {q(rt["scope_type"])}, {q(rt["responsible"])}, {q(rt["accountable"])}, {rt["active"]});',
        ]
        if rt['classes']:
            parts += [
                '        SET @r = SCOPE_IDENTITY();',
                '        INSERT INTO app.approval_route_class (route_id, class_code) VALUES',
                ',\n'.join(f'            (@r, {q(c)})' for c in rt['classes']) + ';',
            ]
    n_routes = len(routes)
    n_classes = sum(len(rt['classes']) for rt in routes)
    parts += [
        '',
        '        COMMIT TRANSACTION;',
        '        DECLARE @n_routes int = (SELECT COUNT(*) FROM app.approval_route);',
        '        DECLARE @n_classes int = (SELECT COUNT(*) FROM app.approval_route_class);',
        f"        PRINT 'OK  0103 loaded: ' + CAST(@n_routes AS varchar(12)) + ' routes, ' + CAST(@n_classes AS varchar(12)) + ' route-class rows (expected {n_routes} and {n_classes})';",
        '    END',
        'END TRY',
        'BEGIN CATCH',
        '    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;',
        "    PRINT 'FAIL 0103.9 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();",
        'END CATCH;',
        '',
    ]
    return '\n'.join(parts)


def sql_assignments(rows, assignments, group_keys, skipped_users):
    key_lines: dict[str, list[str]] = {}
    for a in assignments:
        key_lines.setdefault(a['key'], []).append(f'L{a["row"].lineno:04d}')

    parts = [
        header('0104_assignments.sql', '12 group role assignments with their profit-centre scopes',
               f'REF-46 sheet "Principal Role Assignments" [REF-46:{lines_of(rows)}] (GROUP rows only)',
               'app.principal_role_assignment, app.principal_role_assignment_scope',
               ['Loads only when no GROUP assignment exists yet (assignment ids are identity values).',
                f'The {skipped_users} USER rows of the client file name two people as Admin; they are NOT in this file.',
                'People go only in db/seed/local/pov_members.sql (git-ignored).',
                'A blank scope_type with a list is loaded as PROFIT_CENTER_LIST (the client leaves it blank).']),
        'SET NOCOUNT ON;',
        '',
        guard('0104', ['app.principal_role_assignment', 'app.principal_role_assignment_scope', 'app.role'],
              '0003_security.sql'),
        '',
        'BEGIN TRY',
        "    DECLARE @existing int = (SELECT COUNT(*) FROM app.principal_role_assignment WHERE principal_type = N'GROUP');",
        '    IF @existing > 0',
        "        PRINT 'INFO 0104 ' + CAST(@existing AS varchar(12)) + ' GROUP assignments already exist: not loaded twice, skipped.';",
        '    ELSE IF NOT EXISTS (SELECT 1 FROM app.role)',
        "        PRINT 'FAIL 0104.4 app.role is empty: run 0101_roles.sql first. Nothing was changed.';",
        '    ELSE',
        '    BEGIN',
        '        DECLARE @a int;',
        '        BEGIN TRANSACTION;',
    ]
    for a in assignments:
        r = a['row']
        notes = []
        if a['key'] not in group_keys:
            notes.append(f'[VERIFY: principal "{a["key"]}" is not defined in Group Definitions '
                         f'(REF-46 analysis 4.3); loaded as received, so no one can be made a member of it]')
        if len(key_lines[a['key']]) > 1:
            notes.append(f'[VERIFY: principal_key "{a["key"]}" appears on {" and ".join(key_lines[a["key"]])} '
                         f'with different scopes; loaded as received]')
        scope_txt = 'ALL_ORCM' if a['scope_type'] == 'ALL_ORCM' else f'scope list of {len(a["scopes"])}'
        parts += [
            '',
            f'        -- {r.src}  {a["key"]} -> {a["role"]}, {scope_txt}',
        ]
        for n in notes:
            parts.append(f'        -- {n}')
        parts += [
            '        INSERT INTO app.principal_role_assignment',
            '            (principal_type, principal_key, principal_display_name, role_name, scope_type, scope_value, planner_group_description, is_active)',
            f'        VALUES ({q(a["type"])}, {q(a["key"])}, {q(a["display"])}, {q(a["role"])}, {q(a["scope_type"])}, {q(a["scope_value"])}, {q(a["planner"])}, {a["active"]});',
        ]
        if a['scopes']:
            parts += [
                '        SET @a = SCOPE_IDENTITY();',
                '        INSERT INTO app.principal_role_assignment_scope (assignment_id, profit_center_name) VALUES',
                ',\n'.join(f'            (@a, {q(s)})' for s in a['scopes']) + ';',
            ]
    n_assign = len(assignments)
    n_scope = sum(len(a['scopes']) for a in assignments)
    parts += [
        '',
        '        COMMIT TRANSACTION;',
        "        DECLARE @n_assign int = (SELECT COUNT(*) FROM app.principal_role_assignment WHERE principal_type = N'GROUP');",
        "        DECLARE @n_scope int = (SELECT COUNT(*) FROM app.principal_role_assignment_scope AS s JOIN app.principal_role_assignment AS a ON a.assignment_id = s.assignment_id WHERE a.principal_type = N'GROUP');",
        f"        PRINT 'OK  0104 loaded: ' + CAST(@n_assign AS varchar(12)) + ' group assignments, ' + CAST(@n_scope AS varchar(12)) + ' scope rows (expected {n_assign} and {n_scope})';",
        '    END',
        'END TRY',
        'BEGIN CATCH',
        '    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;',
        "    PRINT 'FAIL 0104.9 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();",
        'END CATCH;',
        '',
    ]
    return '\n'.join(parts)


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def write(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(text)


def main():
    default_out = Path(__file__).resolve().parent.parent / 'db' / 'seed'
    ap = argparse.ArgumentParser(description='Generate the REF-46 security and routing seeds.')
    ap.add_argument('--extract', required=True, type=Path, help='path to the REF-46 extract .txt')
    ap.add_argument('--out', type=Path, default=default_out, help=f'output folder (default {default_out})')
    args = ap.parse_args()
    if not args.extract.is_file():
        die(f'extract not found: {args.extract}')

    sheets, stats = read_extract(args.extract)
    role_rows = check_header('Role Definitions', sheets['Role Definitions'])
    group_rows = check_header('Group Definitions', sheets['Group Definitions'])
    route_rows = check_header('Approval Routes', sheets['Approval Routes'])
    assign_rows = check_header('Principal Role Assignments', sheets['Principal Role Assignments'])
    drop_rows = [r for r in sheets['DROP DOWNS'] if r.rownum >= 1]

    profit_centres = [v for v in (r.get('A') for r in drop_rows)
                      if v and v != 'ALL_ORCM' and ',' not in v]
    roles = build_roles(role_rows)
    groups = build_groups(group_rows)
    routes = build_routes(route_rows)
    role_names = {vals[0] for _, vals in roles}
    group_keys = {vals[0] for _, vals in groups}
    assignments = build_assignments(assign_rows, set(profit_centres), role_names)
    aliases = build_aliases(routes, role_names)

    # sheets with their header row: lines_of() reports the range from the header on
    role_all, group_all = sheets['Role Definitions'], sheets['Group Definitions']
    route_all, assign_all = sheets['Approval Routes'], sheets['Principal Role Assignments']

    out = args.out
    write(out / '0101_roles.sql', sql_roles(role_all, roles))
    write(out / '0102_groups.sql', sql_groups(group_all, groups))
    write(out / '0103_routes.sql', sql_routes(route_all, routes, {a['alias'] for a in aliases}))
    write(out / '0104_assignments.sql',
          sql_assignments(assign_all, assignments, group_keys, stats['user_rows_skipped']))
    write(out / '0105_role_alias.sql', sql_aliases(route_all, aliases))

    summary = {
        'roles': len(roles), 'groups': len(groups), 'routes': len(routes),
        'route_classes': sum(len(r['classes']) for r in routes),
        'group_assignments': len(assignments),
        'all_orcm_assignments': sum(1 for a in assignments if a['scope_type'] == 'ALL_ORCM'),
        'list_assignments': sum(1 for a in assignments if a['scope_type'] == 'PROFIT_CENTER_LIST'),
        'scope_rows': sum(len(a['scopes']) for a in assignments),
        'aliases': len(aliases), 'profit_centres': len(set(profit_centres)),
        'user_rows_skipped': stats['user_rows_skipped'],
        'membership_rows': sum(stats['membership_by_group'].values()),
    }
    print('REF-46 seed generation')
    for k, v in summary.items():
        flag = '' if EXPECTED.get(k) == v else f'   <-- expected {EXPECTED.get(k)}'
        print(f'  {k:22s} {v}{flag}')
    print('  membership rows by group key (counts only):')
    for k, v in sorted(stats['membership_by_group'].items()):
        print(f'    {k}: {v}')
    if stats['membership_unreadable']:
        print(f'  membership rows without a readable group key: {stats["membership_unreadable"]}')
    print(f'  written to {out}')
    if any(EXPECTED.get(k) != v for k, v in summary.items()):
        print('WARNING: the counts differ from what the APP-1 plan expects; check the client file before loading.',
              file=sys.stderr)
        sys.exit(2)


if __name__ == '__main__':
    main()
