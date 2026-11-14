#!/usr/bin/env python3
"""Check db/migrations against the data dictionary, and write db/tests/t_app_schema.sql.

The data dictionary (FINAL PLAN/09_Data_Dictionary.md in the project folder
"OxyProject -Info") is the single reference for every column of the `app` schema.
This tool reads its tables, reads the CREATE TABLE blocks of the migrations, and
reports every difference in column name, type, nullability or identity.

Offline: no database, standard library only.

  python tools/schema_check.py --dictionary "<path to 09_Data_Dictionary.md>"
  python tools/schema_check.py --dictionary "<path>" --emit-test db/tests/t_app_schema.sql

Exit code 0 = migrations match the dictionary; 1 = differences (listed);
2 = a file could not be read or parsed.

Conventions this tool relies on (also written in db/README.md):
  - one column per line inside CREATE TABLE app.<name> ( ... );
  - the closing line of the block is a line holding only `);`
  - a computed column is written `name AS ... CONVERT(<type>, ...)`; its type is
    taken from that CONVERT.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import NamedTuple


class Col(NamedTuple):
    name: str
    type: str          # normalised, e.g. nvarchar(64), decimal(5,4), rowversion
    nullable: bool
    identity: bool


# --------------------------------------------------------------------------
# dictionary
# --------------------------------------------------------------------------
HEADING = re.compile(r"^###\s+[\d.]+\s+`(app\.[a-z_0-9]+)`")


def split_top_level(text: str) -> list[str]:
    """Split on commas that are not inside parentheses."""
    parts, depth, cur = [], 0, []
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    tail = "".join(cur).strip()
    if tail:
        parts.append(tail)
    return parts


def norm_type(raw: str) -> tuple[str, bool]:
    """('int identity') -> ('int', True); ('nvarchar(64)') -> ('nvarchar(64)', False)."""
    t = raw.strip().lower()
    identity = False
    if t.endswith(" identity"):
        identity = True
        t = t[: -len(" identity")].strip()
    return re.sub(r"\s+", "", t), identity


def parse_dictionary(path: Path) -> dict[str, list[Col]]:
    tables: dict[str, list[Col]] = {}
    lines = path.read_text(encoding="utf-8").splitlines()
    i = 0
    while i < len(lines):
        m = HEADING.match(lines[i])
        if not m:
            i += 1
            continue
        table = m.group(1)
        i += 1
        # first table row block after the heading, stop at the next heading
        while i < len(lines) and not lines[i].lstrip().startswith("| Column"):
            if lines[i].startswith("#"):
                break
            i += 1
        if i >= len(lines) or not lines[i].lstrip().startswith("| Column"):
            raise ValueError(f"{table}: no column table found")
        i += 2  # header + separator
        cols: list[Col] = []
        while i < len(lines) and lines[i].startswith("|"):
            cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
            # a cell can hold a '|' only inside backticks; the dictionary does not do this in cells 0-2
            names = re.findall(r"`([a-z_0-9]+)`", cells[0])
            types = split_top_level(cells[1])
            nulls = [n.strip().lower() for n in cells[2].split("/")]
            if not names:
                raise ValueError(f"{table}: cannot read column names from: {lines[i]}")
            if len(types) == 1:
                types = types * len(names)
            if len(nulls) == 1:
                nulls = nulls * len(names)
            if not (len(names) == len(types) == len(nulls)):
                raise ValueError(f"{table}: names/types/null counts differ in: {lines[i]}")
            for n, t, nu in zip(names, types, nulls):
                typ, ident = norm_type(t)
                if nu not in ("yes", "no"):
                    raise ValueError(f"{table}.{n}: Null must be yes or no, got '{nu}'")
                cols.append(Col(n, typ, nu == "yes", ident))
            i += 1
        tables[table] = cols
    return tables


# --------------------------------------------------------------------------
# migrations
# --------------------------------------------------------------------------
CREATE = re.compile(r"CREATE TABLE\s+(app\.[a-z_0-9]+)\s*\(\s*\n(.*?)\n\s*\);", re.S | re.I)
SKIP = ("constraint", "primary", "unique", "check", "foreign")


def parse_migrations(folder: Path) -> dict[str, list[Col]]:
    tables: dict[str, list[Col]] = {}
    for f in sorted(folder.glob("*.sql")):
        text = f.read_text(encoding="utf-8")
        for m in CREATE.finditer(text):
            table, body = m.group(1).lower(), m.group(2)
            cols: list[Col] = []
            for raw in body.splitlines():
                line = raw.strip().rstrip(",")
                if not line or line.startswith("--"):
                    continue
                if line.lower().startswith(SKIP):
                    continue
                name = line.split()[0]
                rest = line[len(name):].strip()
                if rest.upper().startswith("AS "):
                    cm = re.search(r"CONVERT\(\s*([a-z0-9_]+(?:\(\s*[\w, ]+\))?)\s*,", rest, re.I)
                    if not cm:
                        raise ValueError(f"{f.name} {table}.{name}: computed column needs CONVERT(<type>, ...)")
                    typ = re.sub(r"\s+", "", cm.group(1).lower())
                    cols.append(Col(name, typ, "not null" not in rest.lower() and "isnull(" not in rest.lower(), False))
                    continue
                tm = re.match(r"([a-z0-9_]+(?:\(\s*[\w, ]+\))?)", rest, re.I)
                if not tm:
                    raise ValueError(f"{f.name} {table}.{name}: cannot read the type from: {line}")
                typ = re.sub(r"\s+", "", tm.group(1).lower())
                upper = rest.upper()
                identity = "IDENTITY(" in upper
                if typ == "rowversion" or identity or "NOT NULL" in upper:
                    nullable = False
                else:
                    nullable = True
                cols.append(Col(name, typ, nullable, identity))
            if table in tables:
                raise ValueError(f"{f.name}: {table} is created twice")
            tables[table] = cols
    return tables


# --------------------------------------------------------------------------
# compare
# --------------------------------------------------------------------------
def compare(dic: dict[str, list[Col]], mig: dict[str, list[Col]]) -> list[str]:
    problems: list[str] = []
    for table, dcols in dic.items():
        if table not in mig:
            problems.append(f"{table}: in the dictionary but no CREATE TABLE in db/migrations")
            continue
        mcols = {c.name: c for c in mig[table]}
        for d in dcols:
            m = mcols.pop(d.name, None)
            if m is None:
                problems.append(f"{table}.{d.name}: in the dictionary, missing in the migration")
                continue
            if m.type != d.type:
                problems.append(f"{table}.{d.name}: type {m.type} in the migration, {d.type} in the dictionary")
            if m.nullable != d.nullable:
                problems.append(
                    f"{table}.{d.name}: {'NULL' if m.nullable else 'NOT NULL'} in the migration, "
                    f"{'yes' if d.nullable else 'no'} (null) in the dictionary")
            if m.identity != d.identity:
                problems.append(f"{table}.{d.name}: identity is {m.identity} in the migration, {d.identity} in the dictionary")
        for extra in mcols:
            problems.append(f"{table}.{extra}: in the migration, not in the dictionary")
        order_d = [c.name for c in dcols]
        order_m = [c.name for c in mig[table] if c.name in order_d]
        if order_d != order_m:
            problems.append(f"{table}: column order differs from the dictionary")
    for table in mig:
        if table not in dic:
            problems.append(f"{table}: created by a migration but not in the dictionary (a table listed there only as 'not built' or DE-owned is fine; anything else needs a dictionary entry)")
    return problems


# --------------------------------------------------------------------------
# emit the SQL test
# --------------------------------------------------------------------------
def q(s: str) -> str:
    return "N'" + s.replace("'", "''") + "'"


def emit_test(dic: dict[str, list[Col]], dictionary_name: str) -> str:
    rows = []
    for table, cols in dic.items():
        for pos, c in enumerate(cols, start=1):
            rows.append(f"    ({q(table)}, {q(c.name)}, {pos}, {q(c.type)}, {0 if not c.nullable else 1}, {1 if c.identity else 0})")
    values = ",\n".join(rows)
    n_tables = len(dic)
    return f"""/* =====================================================================
   t_app_schema.sql          APP-1 test: the tables match the data dictionary
   GENERATED by tools/schema_check.py from {dictionary_name}. Do not edit by hand;
   change the dictionary, run `python tools/schema_check.py --dictionary ... --emit-test db/tests/t_app_schema.sql`.

   For each of the {n_tables} `app` tables in the dictionary: the table exists, has a
   primary key, and every column has the dictionary's type, nullability and
   identity; no column is missing or extra. Prints OK / FAIL lines and a final
   `t_app_schema RESULT: ...` line. Read-only; changes nothing.
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL t_app_schema wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was run.';
    RETURN;
END

DECLARE @failed int = 0, @tables int = 0;

CREATE TABLE #expected
(
    table_name  nvarchar(128) NOT NULL,
    column_name nvarchar(128) NOT NULL,
    ordinal     int           NOT NULL,
    type_name   nvarchar(40)  NOT NULL,
    is_nullable bit           NOT NULL,
    is_identity bit           NOT NULL
);

INSERT INTO #expected (table_name, column_name, ordinal, type_name, is_nullable, is_identity) VALUES
{values};

CREATE TABLE #actual
(
    table_name  nvarchar(128) NOT NULL,
    column_name nvarchar(128) NOT NULL,
    type_name   nvarchar(40)  NOT NULL,
    is_nullable bit           NOT NULL,
    is_identity bit           NOT NULL
);

INSERT INTO #actual (table_name, column_name, type_name, is_nullable, is_identity)
SELECT s.name + N'.' + o.name,
       c.name,
       CASE WHEN t.name IN (N'nvarchar', N'nchar') THEN t.name + N'(' + CASE WHEN c.max_length = -1 THEN N'max' ELSE CAST(c.max_length / 2 AS nvarchar(10)) END + N')'
            WHEN t.name IN (N'varchar', N'char', N'varbinary', N'binary') THEN t.name + N'(' + CASE WHEN c.max_length = -1 THEN N'max' ELSE CAST(c.max_length AS nvarchar(10)) END + N')'
            WHEN t.name IN (N'decimal', N'numeric') THEN t.name + N'(' + CAST(c.precision AS nvarchar(10)) + N',' + CAST(c.scale AS nvarchar(10)) + N')'
            WHEN t.name IN (N'datetime2', N'time', N'datetimeoffset') THEN t.name + N'(' + CAST(c.scale AS nvarchar(10)) + N')'
            WHEN t.name = N'timestamp' THEN N'rowversion'
            ELSE t.name END,
       c.is_nullable,
       c.is_identity
FROM sys.columns c
JOIN sys.objects o ON o.object_id = c.object_id AND o.type = N'U'
JOIN sys.schemas s ON s.schema_id = o.schema_id AND s.name = N'app'
JOIN sys.types t ON t.user_type_id = c.user_type_id;

DECLARE @table nvarchar(128), @detail nvarchar(2000), @mismatch int;

DECLARE table_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT DISTINCT table_name FROM #expected ORDER BY table_name;
OPEN table_cursor;
FETCH NEXT FROM table_cursor INTO @table;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @tables += 1;
    SET @mismatch = 0;

    IF OBJECT_ID(@table, N'U') IS NULL
    BEGIN
        PRINT 'FAIL t_app_schema ' + @table + ' does not exist (run the migrations first)';
        SET @failed += 1;
    END
    ELSE
    BEGIN
        IF OBJECTPROPERTY(OBJECT_ID(@table), N'TableHasPrimaryKey') <> 1
        BEGIN
            PRINT 'FAIL t_app_schema ' + @table + ' has no primary key (the connector needs a declared key)';
            SET @mismatch += 1;
        END

        -- missing or different columns
        DECLARE @col nvarchar(128), @want nvarchar(40), @got nvarchar(40), @wn bit, @gn bit, @wi bit, @gi bit, @have bit;
        DECLARE col_cursor CURSOR LOCAL FAST_FORWARD FOR
            SELECT e.column_name, e.type_name, e.is_nullable, e.is_identity,
                   a.type_name, a.is_nullable, a.is_identity,
                   CASE WHEN a.column_name IS NULL THEN 0 ELSE 1 END
            FROM #expected e
            LEFT JOIN #actual a ON a.table_name = e.table_name AND a.column_name = e.column_name
            WHERE e.table_name = @table
            ORDER BY e.ordinal;
        OPEN col_cursor;
        FETCH NEXT FROM col_cursor INTO @col, @want, @wn, @wi, @got, @gn, @gi, @have;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            IF @have = 0
            BEGIN
                PRINT 'FAIL t_app_schema ' + @table + '.' + @col + ' is missing (dictionary: ' + @want + ')';
                SET @mismatch += 1;
            END
            ELSE
            BEGIN
                IF @got <> @want
                BEGIN
                    PRINT 'FAIL t_app_schema ' + @table + '.' + @col + ' type is ' + @got + ', dictionary says ' + @want;
                    SET @mismatch += 1;
                END
                IF @gn <> @wn
                BEGIN
                    PRINT 'FAIL t_app_schema ' + @table + '.' + @col + ' is ' + CASE WHEN @gn = 1 THEN 'NULL' ELSE 'NOT NULL' END + ', dictionary says ' + CASE WHEN @wn = 1 THEN 'yes (may be empty)' ELSE 'no (required)' END;
                    SET @mismatch += 1;
                END
                IF @gi <> @wi
                BEGIN
                    PRINT 'FAIL t_app_schema ' + @table + '.' + @col + ' identity is ' + CAST(@gi AS varchar(1)) + ', dictionary says ' + CAST(@wi AS varchar(1));
                    SET @mismatch += 1;
                END
            END
            FETCH NEXT FROM col_cursor INTO @col, @want, @wn, @wi, @got, @gn, @gi, @have;
        END
        CLOSE col_cursor;
        DEALLOCATE col_cursor;

        -- extra columns
        SET @detail = NULL;
        SELECT @detail = ISNULL(@detail + N', ', N'') + a.column_name
        FROM #actual a
        WHERE a.table_name = @table
          AND NOT EXISTS (SELECT 1 FROM #expected e WHERE e.table_name = a.table_name AND e.column_name = a.column_name);
        IF @detail IS NOT NULL
        BEGIN
            PRINT 'FAIL t_app_schema ' + @table + ' has columns the dictionary does not list: ' + @detail;
            SET @mismatch += 1;
        END

        IF @mismatch = 0
            PRINT 'OK  t_app_schema ' + @table + ': ' + CAST((SELECT COUNT(*) FROM #expected WHERE table_name = @table) AS varchar(10)) + ' columns match';
        ELSE
            SET @failed += 1;
    END

    FETCH NEXT FROM table_cursor INTO @table;
END
CLOSE table_cursor;
DEALLOCATE table_cursor;

DROP TABLE #actual;
DROP TABLE #expected;

IF @failed = 0
    PRINT 't_app_schema RESULT: ALL ' + CAST(@tables AS varchar(10)) + ' TABLES MATCH THE DATA DICTIONARY';
ELSE
    PRINT 't_app_schema RESULT: ' + CAST(@failed AS varchar(10)) + ' OF ' + CAST(@tables AS varchar(10)) + ' TABLE(S) DIFFER FROM THE DATA DICTIONARY';
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dictionary", required=True, type=Path, help="path to 09_Data_Dictionary.md")
    ap.add_argument("--migrations", type=Path, default=Path("db/migrations"))
    ap.add_argument("--emit-test", type=Path, help="write the generated SQL test here")
    args = ap.parse_args()

    try:
        dic = parse_dictionary(args.dictionary)
        mig = parse_migrations(args.migrations)
    except (OSError, ValueError) as err:
        print(f"ERROR {err}")
        return 2

    n_cols = sum(len(c) for c in dic.values())
    print(f"dictionary: {len(dic)} tables, {n_cols} columns; migrations: {len(mig)} tables, {sum(len(c) for c in mig.values())} columns")
    problems = compare(dic, mig)

    if args.emit_test:
        args.emit_test.parent.mkdir(parents=True, exist_ok=True)
        # newline='\n' keeps the generated file byte-identical across machines
        with open(args.emit_test, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(emit_test(dic, args.dictionary.name))
        print(f"wrote {args.emit_test}")

    if problems:
        print(f"{len(problems)} difference(s):")
        for p in problems:
            print("  - " + p)
        return 1
    print("OK: every migration table matches the data dictionary (names, types, null, identity, order)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
