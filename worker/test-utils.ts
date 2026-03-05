import { vi } from "vitest";
import { Hono } from "hono";
import type { Env, Session } from "./types";

// ---------------------------------------------------------------------------
// MockD1 - In-memory D1Database mock with regex-based SQL parsing
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface D1Meta {
  duration: number;
  changes: number;
  last_row_id: number;
  changed_db: boolean;
  size_after: number;
  rows_read: number;
  rows_written: number;
}

function defaultMeta(changes = 0): D1Meta {
  return {
    duration: 0,
    changes,
    last_row_id: 0,
    changed_db: changes > 0,
    size_after: 0,
    rows_read: 0,
    rows_written: 0,
  };
}

/** Simple LIKE pattern matching (SQL LIKE with % and _) */
function matchLike(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = escaped.replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${regex}$`, "i").test(value);
}

/**
 * Evaluate a simple WHERE clause against a row.
 * Supports: col = ?, col LIKE ?, col IS NULL, col IS NOT NULL,
 * col IN (?, ?, ...), col < ?, col > ?, col <= ?, col >= ?,
 * AND / OR combinators.
 *
 * `params` is consumed left-to-right via a shared index.
 */
function evaluateWhere(
  row: Row,
  whereClause: string,
  params: unknown[],
  paramIndex: { i: number }
): boolean {
  // Split on top-level OR first (lower precedence), then AND
  const orParts = splitTopLevel(whereClause, " OR ");
  if (orParts.length > 1) {
    return orParts.some((part) => {
      // Clone paramIndex for each OR branch attempt -- but since params are
      // positional we need to count how many ?s each branch consumes.
      // We'll use a simpler approach: for OR, evaluate them all with separate
      // clones and pick the first matching one.
      const cloned = { i: paramIndex.i };
      const result = evaluateWhere(row, part, params, cloned);
      if (result) {
        paramIndex.i = cloned.i;
        return true;
      }
      // Still advance paramIndex by the number of ?s in this branch
      paramIndex.i = cloned.i;
      return false;
    });
  }

  const andParts = splitTopLevel(whereClause, " AND ");
  if (andParts.length > 1) {
    return andParts.every((part) => evaluateWhere(row, part, params, paramIndex));
  }

  // Single condition
  const clause = whereClause.trim();

  // Parenthesized group
  if (clause.startsWith("(") && clause.endsWith(")")) {
    return evaluateWhere(row, clause.slice(1, -1), params, paramIndex);
  }

  // col IN (?, ?, ...)
  const inMatch = clause.match(
    /^(\w+)\s+IN\s*\(([^)]+)\)$/i
  );
  if (inMatch) {
    const col = inMatch[1];
    const placeholders = inMatch[2].split(",").map((s) => s.trim());
    const values = placeholders.map(() => params[paramIndex.i++]);
    return values.some((v) => row[col] === v);
  }

  // col IS NOT NULL
  const isNotNullMatch = clause.match(/^(\w+)\s+IS\s+NOT\s+NULL$/i);
  if (isNotNullMatch) {
    return row[isNotNullMatch[1]] != null;
  }

  // col IS NULL
  const isNullMatch = clause.match(/^(\w+)\s+IS\s+NULL$/i);
  if (isNullMatch) {
    return row[isNullMatch[1]] == null;
  }

  // col LIKE ?
  const likeMatch = clause.match(/^(\w+)\s+LIKE\s+\?$/i);
  if (likeMatch) {
    const val = row[likeMatch[1]];
    const pattern = params[paramIndex.i++] as string;
    if (val == null) return false;
    return matchLike(String(val), pattern);
  }

  // col <op> ?  where op is =, !=, <>, <, >, <=, >=
  const cmpMatch = clause.match(/^(\w+)\s*(=|!=|<>|<=|>=|<|>)\s*\?$/);
  if (cmpMatch) {
    const col = cmpMatch[1];
    const op = cmpMatch[2];
    const val = params[paramIndex.i++];
    const rowVal = row[col];
    switch (op) {
      case "=":
        return rowVal === val;
      case "!=":
      case "<>":
        return rowVal !== val;
      case "<":
        return (rowVal as number) < (val as number);
      case ">":
        return (rowVal as number) > (val as number);
      case "<=":
        return (rowVal as number) <= (val as number);
      case ">=":
        return (rowVal as number) >= (val as number);
    }
  }

  // col = 'literal' (for type = 'link' etc.)
  const litMatch = clause.match(/^(\w+)\s*=\s*'([^']*)'$/);
  if (litMatch) {
    return row[litMatch[1]] === litMatch[2];
  }

  // datetime comparisons with literal: col < datetime('now')
  const datetimeMatch = clause.match(
    /^(\w+)\s*(=|<|>|<=|>=)\s*datetime\('now'\)$/i
  );
  if (datetimeMatch) {
    const col = datetimeMatch[1];
    const op = datetimeMatch[2];
    const rowVal = row[col] as string | null;
    if (rowVal == null) return false;
    const rowTime = new Date(rowVal).getTime();
    const nowTime = Date.now();
    switch (op) {
      case "=":
        return rowTime === nowTime;
      case "<":
        return rowTime < nowTime;
      case ">":
        return rowTime > nowTime;
      case "<=":
        return rowTime <= nowTime;
      case ">=":
        return rowTime >= nowTime;
    }
  }

  // hits >= max_hits  (column-to-column comparison)
  const colColMatch = clause.match(/^(\w+)\s*(=|!=|<>|<=|>=|<|>)\s*(\w+)$/);
  if (colColMatch) {
    const left = row[colColMatch[1]];
    const op = colColMatch[2];
    const right = row[colColMatch[3]];
    if (left == null || right == null) return false;
    switch (op) {
      case "=":
        return left === right;
      case "!=":
      case "<>":
        return left !== right;
      case "<":
        return (left as number) < (right as number);
      case ">":
        return (left as number) > (right as number);
      case "<=":
        return (left as number) <= (right as number);
      case ">=":
        return (left as number) >= (right as number);
    }
  }

  // Fallback: unknown clause -- return true (permissive)
  return true;
}

/** Split a string on a delimiter, respecting parentheses depth. */
function splitTopLevel(str: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  const upper = str.toUpperCase();
  const delimUpper = delimiter.toUpperCase();

  for (let i = 0; i < str.length; i++) {
    if (str[i] === "(") depth++;
    if (str[i] === ")") depth--;

    if (depth === 0 && upper.startsWith(delimUpper, i)) {
      parts.push(current.trim());
      current = "";
      i += delimiter.length - 1;
      continue;
    }

    current += str[i];
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Parse basic SQL expressions in SET clauses that contain SQL functions */
function resolveSetValue(
  expr: string,
  row: Row,
  params: unknown[],
  paramIndex: { i: number }
): unknown {
  const trimmed = expr.trim();

  // ? placeholder
  if (trimmed === "?") {
    return params[paramIndex.i++];
  }

  // datetime('now')
  if (/^datetime\('now'\)$/i.test(trimmed)) {
    return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  }

  // col + 1 / col - 1 (e.g., hits = hits + 1)
  const arithMatch = trimmed.match(/^(\w+)\s*(\+|-)\s*(\d+)$/);
  if (arithMatch) {
    const current = (row[arithMatch[1]] as number) || 0;
    const operand = parseInt(arithMatch[3]);
    return arithMatch[2] === "+" ? current + operand : current - operand;
  }

  return trimmed;
}

class MockD1PreparedStatement {
  private sql: string;
  private params: unknown[] = [];
  private db: MockD1Database;

  constructor(db: MockD1Database, sql: string) {
    this.db = db;
    this.sql = sql;
  }

  bind(...params: unknown[]): MockD1PreparedStatement {
    this.params = params;
    return this;
  }

  async first<T = Row>(column?: string): Promise<T | null> {
    const result = this.execute();
    const rows = Array.isArray(result) ? result : [];
    if (rows.length === 0) return null;
    if (column) return rows[0][column] as T;
    return rows[0] as T;
  }

  async all<T = Row>(): Promise<{ results: T[]; success: boolean; meta: D1Meta }> {
    const result = this.execute();
    const rows = Array.isArray(result) ? result : [];
    return { results: rows as T[], success: true, meta: defaultMeta() };
  }

  async run(): Promise<{ success: boolean; meta: D1Meta }> {
    const result = this.execute();
    const changeCount = typeof result === "number" ? result : result.length;
    return { success: true, meta: defaultMeta(changeCount) };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const result = this.execute();
    const rows = Array.isArray(result) ? result : [];
    return rows.map((row: Row) => Object.values(row)) as T[];
  }

  /**
   * Core SQL execution engine. Parses the SQL string with regex and
   * operates on the in-memory table store.
   */
  private execute(): Row[] | number {
    const sql = this.sql.trim();
    const paramIndex = { i: 0 };

    // ---- SELECT ----
    const selectMatch = sql.match(
      /^SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+(\w+))?(?:\s+JOIN\s+(\w+)\s+(\w+)\s+ON\s+(.+?))?(?:\s+WHERE\s+(.+?))?(?:\s+GROUP\s+BY\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(.+?))?(?:\s+OFFSET\s+(.+?))?$/is
    );

    if (selectMatch) {
      const [, columns, table, tableAlias, joinTable, joinAlias, joinOn, where, groupBy, orderBy, limit, offset] = selectMatch;
      return this.executeSelect(
        columns, table, tableAlias || null, joinTable || null, joinAlias || null,
        joinOn || null, where || null, groupBy || null, orderBy || null,
        limit || null, offset || null, paramIndex
      );
    }

    // ---- INSERT ----
    const insertMatch = sql.match(
      /^INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)$/is
    );
    if (insertMatch) {
      const [, table, colStr, valStr] = insertMatch;
      const cols = colStr.split(",").map((c) => c.trim());
      const valPlaceholders = valStr.split(",").map((v) => v.trim());

      const row: Row = {};
      for (let i = 0; i < cols.length; i++) {
        if (valPlaceholders[i] === "?") {
          row[cols[i]] = this.params[paramIndex.i++];
        } else if (/^datetime\('now'\)$/i.test(valPlaceholders[i])) {
          row[cols[i]] = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
        } else {
          // Literal value (strip quotes)
          row[cols[i]] = valPlaceholders[i].replace(/^'|'$/g, "");
        }
      }

      if (!this.db.tables.has(table)) {
        this.db.tables.set(table, []);
      }
      this.db.tables.get(table)!.push(row);
      return 1 as unknown as Row[];
    }

    // ---- UPDATE ----
    const updateMatch = sql.match(
      /^UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/is
    );
    if (updateMatch) {
      const [, table, setClause, where] = updateMatch;
      const rows = this.db.tables.get(table) || [];

      // Parse SET assignments
      const assignments = splitTopLevel(setClause, ",");
      let changes = 0;

      for (const row of rows) {
        // Check WHERE first so paramIndex advances correctly for SET later
        // We need to figure out how many ? are in SET assignments to skip
        // Actually, we process SET params first, then WHERE params.
        // Let's count SET params and WHERE params separately.
        const setParamStart = paramIndex.i;
        let setParamCount = 0;
        for (const assignment of assignments) {
          const eqIdx = assignment.indexOf("=");
          const expr = assignment.slice(eqIdx + 1).trim();
          if (expr === "?") setParamCount++;
        }

        // Evaluate WHERE with params after SET params
        const whereParamStart = setParamStart + setParamCount;
        let matches = true;
        if (where) {
          const whereIdx = { i: whereParamStart };
          matches = evaluateWhere(row, where, this.params, whereIdx);
        }

        if (matches) {
          const localIdx = { i: setParamStart };
          for (const assignment of assignments) {
            const eqIdx = assignment.indexOf("=");
            const col = assignment.slice(0, eqIdx).trim();
            const expr = assignment.slice(eqIdx + 1).trim();
            row[col] = resolveSetValue(expr, row, this.params, localIdx);
          }
          changes++;
        }
      }

      // Advance the shared paramIndex past all consumed params
      // Count total ? in the entire SQL
      const totalParams = (sql.match(/\?/g) || []).length;
      paramIndex.i = totalParams;

      return changes as unknown as Row[];
    }

    // ---- DELETE ----
    const deleteMatch = sql.match(
      /^DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/is
    );
    if (deleteMatch) {
      const [, table, where] = deleteMatch;
      const rows = this.db.tables.get(table) || [];
      const before = rows.length;

      if (where) {
        const remaining: Row[] = [];
        for (const row of rows) {
          const idx = { i: paramIndex.i };
          if (!evaluateWhere(row, where, this.params, idx)) {
            remaining.push(row);
          }
          paramIndex.i = idx.i;
        }
        this.db.tables.set(table, remaining);
        return (before - remaining.length) as unknown as Row[];
      }

      this.db.tables.set(table, []);
      return before as unknown as Row[];
    }

    // Unrecognized SQL — return empty
    return [];
  }

  private executeSelect(
    columnsStr: string,
    table: string,
    tableAlias: string | null,
    joinTable: string | null,
    joinAlias: string | null,
    joinOn: string | null,
    where: string | null,
    groupBy: string | null,
    orderBy: string | null,
    limitStr: string | null,
    offsetStr: string | null,
    paramIndex: { i: number }
  ): Row[] {
    let rows = [...(this.db.tables.get(table) || [])];

    // Handle JOIN
    if (joinTable && joinAlias && joinOn) {
      const joinRows = this.db.tables.get(joinTable) || [];
      // Parse ON clause: alias1.col1 = alias2.col2
      const onMatch = joinOn.match(/(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/);
      if (onMatch) {
        const [, leftAlias, leftCol, rightAlias, rightCol] = onMatch;
        const newRows: Row[] = [];
        for (const row of rows) {
          for (const jRow of joinRows) {
            // Determine which alias refers to which table
            const leftVal = (leftAlias === (tableAlias || table)) ? row[leftCol] : jRow[leftCol];
            const rightVal = (rightAlias === (tableAlias || table)) ? row[rightCol] : jRow[rightCol];
            if (leftVal === rightVal) {
              // Merge rows with alias prefixes for disambiguation
              const merged: Row = {};
              // Copy base table columns
              for (const [k, v] of Object.entries(row)) {
                merged[k] = v;
                if (tableAlias) merged[`${tableAlias}.${k}`] = v;
              }
              // Copy joined table columns with alias prefix
              for (const [k, v] of Object.entries(jRow)) {
                if (joinAlias) merged[`${joinAlias}.${k}`] = v;
                // Only overwrite if not already present in base
                if (!(k in merged)) merged[k] = v;
              }
              newRows.push(merged);
            }
          }
        }
        rows = newRows;
      }
    }

    // Filter by WHERE
    if (where) {
      rows = rows.filter((row) => {
        const idx = { i: paramIndex.i };
        const result = evaluateWhere(row, where, this.params, idx);
        paramIndex.i = idx.i;
        return result;
      });
      // After filtering, paramIndex has been advanced to after the WHERE params
      // But we only advanced for the last row. We need to advance once.
      // Re-do: advance paramIndex correctly by counting ? in WHERE
    }

    // GROUP BY
    if (groupBy) {
      const groupCol = groupBy.trim();
      const groups = new Map<unknown, Row[]>();
      for (const row of rows) {
        const key = row[groupCol];
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      }

      rows = [];
      const cols = parseSelectColumns(columnsStr);
      for (const [groupKey, groupRows] of groups) {
        const resultRow: Row = {};
        for (const col of cols) {
          if (col.expr.toUpperCase().startsWith("COUNT(")) {
            resultRow[col.alias] = groupRows.length;
          } else if (col.expr.toUpperCase().startsWith("SUM(")) {
            const innerCol = col.expr.match(/SUM\((\w+)\)/i)?.[1];
            if (innerCol) {
              resultRow[col.alias] = groupRows.reduce(
                (sum, r) => sum + ((r[innerCol] as number) || 0),
                0
              );
            }
          } else {
            resultRow[col.alias] = groupRows[0]?.[col.expr] ?? groupKey;
          }
        }
        rows.push(resultRow);
      }

      // Return early since we've already projected columns
      return rows;
    }

    // ORDER BY
    if (orderBy) {
      const parts = orderBy.split(",").map((p) => p.trim());
      rows.sort((a, b) => {
        for (const part of parts) {
          const [col, dir] = part.split(/\s+/);
          const desc = dir?.toUpperCase() === "DESC";
          const av = a[col];
          const bv = b[col];
          if (av === bv) continue;
          if (av == null) return desc ? -1 : 1;
          if (bv == null) return desc ? 1 : -1;
          const cmp = av < bv ? -1 : 1;
          return desc ? -cmp : cmp;
        }
        return 0;
      });
    }

    // LIMIT and OFFSET
    let limitVal: number | undefined;
    let offsetVal = 0;

    if (limitStr) {
      if (limitStr.trim() === "?") {
        limitVal = this.params[paramIndex.i++] as number;
      } else {
        limitVal = parseInt(limitStr);
      }
    }
    if (offsetStr) {
      if (offsetStr.trim() === "?") {
        offsetVal = this.params[paramIndex.i++] as number;
      } else {
        offsetVal = parseInt(offsetStr);
      }
    }

    if (offsetVal > 0) {
      rows = rows.slice(offsetVal);
    }
    if (limitVal !== undefined) {
      rows = rows.slice(0, limitVal);
    }

    // Project columns
    const cols = parseSelectColumns(columnsStr);
    if (cols.length === 1 && cols[0].expr === "*") {
      return rows;
    }

    return rows.map((row) => {
      const projected: Row = {};
      for (const col of cols) {
        if (col.expr === "*") {
          Object.assign(projected, row);
        } else if (col.expr.toUpperCase().startsWith("COUNT(")) {
          // COUNT on non-grouped — just count the filtered rows total
          projected[col.alias] = rows.length;
        } else if (col.expr.toUpperCase().startsWith("SUM(")) {
          const innerCol = col.expr.match(/SUM\((\w+)\)/i)?.[1];
          if (innerCol) {
            projected[col.alias] = rows.reduce(
              (sum, r) => sum + ((r[innerCol] as number) || 0),
              0
            );
          }
        } else if (col.expr.toUpperCase().startsWith("MAX(")) {
          const innerCol = col.expr.match(/MAX\((\w+)\)/i)?.[1];
          if (innerCol) {
            const values = rows.map((r) => r[innerCol] as number).filter((v) => v != null);
            projected[col.alias] = values.length > 0 ? Math.max(...values) : null;
          }
        } else {
          // Handle aliased column references with dot notation (from JOINs)
          projected[col.alias] = row[col.expr] ?? row[col.alias] ?? null;
        }
      }
      return projected;
    });
  }
}

interface ParsedColumn {
  expr: string;
  alias: string;
}

function parseSelectColumns(columnsStr: string): ParsedColumn[] {
  if (columnsStr.trim() === "*") return [{ expr: "*", alias: "*" }];

  const cols: ParsedColumn[] = [];
  let depth = 0;
  let current = "";

  for (const ch of columnsStr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      cols.push(parseColumnExpr(current.trim()));
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) cols.push(parseColumnExpr(current.trim()));

  return cols;
}

function parseColumnExpr(expr: string): ParsedColumn {
  // Handle "expr AS alias" or "expr as alias"
  const asMatch = expr.match(/^(.+?)\s+[Aa][Ss]\s+(\w+)$/);
  if (asMatch) {
    return { expr: asMatch[1].trim(), alias: asMatch[2] };
  }

  // Handle table.column syntax
  const dotMatch = expr.match(/^(\w+)\.(\w+)$/);
  if (dotMatch) {
    return { expr: expr, alias: dotMatch[2] };
  }

  return { expr, alias: expr };
}

export class MockD1Database {
  tables: Map<string, Row[]> = new Map();
  calls: Array<{ sql: string; params: unknown[] }> = [];

  constructor() {
    // Initialize all known tables as empty arrays
    const tableNames = [
      "users",
      "passkeys",
      "shares",
      "link_shares",
      "markdown_shares",
      "code_shares",
      "file_shares",
      "gallery_shares",
      "gallery_images",
      "api_keys",
    ];
    for (const name of tableNames) {
      this.tables.set(name, []);
    }
  }

  prepare(sql: string): MockD1PreparedStatement {
    const stmt = new MockD1PreparedStatement(this, sql);
    // Wrap bind to record calls
    const origBind = stmt.bind.bind(stmt);
    stmt.bind = (...params: unknown[]) => {
      this.calls.push({ sql, params });
      return origBind(...params);
    };
    // If no bind is called, still record the call on first/all/run
    const origFirst = stmt.first.bind(stmt);
    const origAll = stmt.all.bind(stmt);
    const origRun = stmt.run.bind(stmt);

    const self = this;
    let bindCalled = false;
    const originalBindTracker = stmt.bind;
    stmt.bind = (...params: unknown[]) => {
      bindCalled = true;
      return originalBindTracker(...params);
    };

    stmt.first = async <T = Row>(column?: string) => {
      if (!bindCalled) self.calls.push({ sql, params: [] });
      return origFirst<T>(column);
    };
    stmt.all = async <T = Row>() => {
      if (!bindCalled) self.calls.push({ sql, params: [] });
      return origAll<T>();
    };
    stmt.run = async () => {
      if (!bindCalled) self.calls.push({ sql, params: [] });
      return origRun();
    };

    return stmt;
  }

  async batch(
    statements: MockD1PreparedStatement[]
  ): Promise<Array<{ results: Row[]; success: boolean; meta: D1Meta }>> {
    const results = [];
    for (const stmt of statements) {
      results.push(await stmt.all());
    }
    return results;
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.calls.push({ sql, params: [] });
    return { count: 0, duration: 0 };
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }

  /** Convenience: insert a row directly into a table (for test seeding). */
  seed(table: string, row: Row): void {
    if (!this.tables.has(table)) {
      this.tables.set(table, []);
    }
    this.tables.get(table)!.push(row);
  }

  /** Convenience: get all rows in a table. */
  getAll(table: string): Row[] {
    return this.tables.get(table) || [];
  }

  /** Reset all tables to empty. */
  reset(): void {
    for (const [, rows] of this.tables) {
      rows.length = 0;
    }
    this.calls.length = 0;
  }
}

// ---------------------------------------------------------------------------
// MockKV - In-memory KVNamespace mock
// ---------------------------------------------------------------------------

interface KVEntry {
  value: string;
  metadata?: unknown;
  expiration?: number; // absolute timestamp in seconds
}

export class MockKVNamespace {
  private store = new Map<string, KVEntry>();
  calls: Array<{ method: string; key: string; args?: unknown[] }> = [];

  async get(key: string, options?: { type?: string }): Promise<string | null> {
    this.calls.push({ method: "get", key });
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiration && entry.expiration < Date.now() / 1000) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async getWithMetadata<T = unknown>(
    key: string
  ): Promise<{ value: string | null; metadata: T | null }> {
    this.calls.push({ method: "getWithMetadata", key });
    const entry = this.store.get(key);
    if (!entry) return { value: null, metadata: null };
    if (entry.expiration && entry.expiration < Date.now() / 1000) {
      this.store.delete(key);
      return { value: null, metadata: null };
    }
    return { value: entry.value, metadata: (entry.metadata as T) ?? null };
  }

  async put(
    key: string,
    value: string,
    opts?: { expirationTtl?: number; expiration?: number; metadata?: unknown }
  ): Promise<void> {
    this.calls.push({ method: "put", key, args: [value, opts] });
    const entry: KVEntry = { value };
    if (opts?.expirationTtl) {
      entry.expiration = Date.now() / 1000 + opts.expirationTtl;
    } else if (opts?.expiration) {
      entry.expiration = opts.expiration;
    }
    if (opts?.metadata) {
      entry.metadata = opts.metadata;
    }
    this.store.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.calls.push({ method: "delete", key });
    this.store.delete(key);
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ keys: Array<{ name: string; expiration?: number; metadata?: unknown }>; list_complete: boolean; cursor: string }> {
    this.calls.push({ method: "list", key: "", args: [options] });
    let keys = Array.from(this.store.entries())
      .filter(([k]) => !options?.prefix || k.startsWith(options.prefix))
      .map(([name, entry]) => ({
        name,
        expiration: entry.expiration,
        metadata: entry.metadata,
      }));

    if (options?.limit) {
      keys = keys.slice(0, options.limit);
    }

    return { keys, list_complete: true, cursor: "" };
  }

  /** Direct access for test assertions. */
  getRaw(key: string): string | undefined {
    return this.store.get(key)?.value;
  }

  /** Reset store. */
  reset(): void {
    this.store.clear();
    this.calls.length = 0;
  }
}

// ---------------------------------------------------------------------------
// MockR2 - In-memory R2Bucket mock
// ---------------------------------------------------------------------------

interface R2StoredObject {
  body: Uint8Array | ReadableStream | ArrayBuffer | string;
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
  size: number;
  key: string;
  version: string;
  uploaded: Date;
  etag: string;
}

class MockR2ObjectBody {
  readonly key: string;
  readonly version: string;
  readonly size: number;
  readonly etag: string;
  readonly httpEtag: string;
  readonly uploaded: Date;
  readonly httpMetadata: Record<string, string>;
  readonly customMetadata: Record<string, string>;
  readonly body: ReadableStream;
  readonly bodyUsed: boolean = false;

  constructor(obj: R2StoredObject) {
    this.key = obj.key;
    this.version = obj.version;
    this.size = obj.size;
    this.etag = obj.etag;
    this.httpEtag = `"${obj.etag}"`;
    this.uploaded = obj.uploaded;
    this.httpMetadata = obj.httpMetadata || {};
    this.customMetadata = obj.customMetadata || {};

    // Convert stored body to ReadableStream
    let bytes: Uint8Array;
    if (obj.body instanceof Uint8Array) {
      bytes = obj.body;
    } else if (typeof obj.body === "string") {
      bytes = new TextEncoder().encode(obj.body);
    } else if (obj.body instanceof ArrayBuffer) {
      bytes = new Uint8Array(obj.body);
    } else {
      // ReadableStream — wrap as-is (shouldn't normally happen)
      bytes = new Uint8Array(0);
    }
    this.body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const reader = this.body.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result.buffer;
  }

  async text(): Promise<string> {
    const buffer = await this.arrayBuffer();
    return new TextDecoder().decode(buffer);
  }

  async json<T>(): Promise<T> {
    const text = await this.text();
    return JSON.parse(text);
  }

  async blob(): Promise<Blob> {
    const buffer = await this.arrayBuffer();
    return new Blob([buffer]);
  }

  writeHttpMetadata(headers: Headers): void {
    for (const [k, v] of Object.entries(this.httpMetadata)) {
      headers.set(k, v);
    }
  }
}

class MockR2MultipartUpload {
  readonly key: string;
  readonly uploadId: string;
  private parts: Array<{ partNumber: number; etag: string; data: unknown }> = [];

  constructor(key: string, uploadId: string) {
    this.key = key;
    this.uploadId = uploadId;
  }

  async uploadPart(
    partNumber: number,
    value: ReadableStream | ArrayBuffer | string
  ): Promise<{ partNumber: number; etag: string }> {
    const etag = `etag-${partNumber}-${crypto.randomUUID().slice(0, 8)}`;
    this.parts.push({ partNumber, etag, data: value });
    return { partNumber, etag };
  }

  async complete(
    uploadedParts: Array<{ partNumber: number; etag: string }>
  ): Promise<MockR2ObjectBody> {
    const obj: R2StoredObject = {
      body: new Uint8Array(0),
      size: 0,
      key: this.key,
      version: crypto.randomUUID(),
      uploaded: new Date(),
      etag: crypto.randomUUID(),
    };
    return new MockR2ObjectBody(obj);
  }

  async abort(): Promise<void> {
    this.parts = [];
  }
}

export class MockR2Bucket {
  private store = new Map<string, R2StoredObject>();
  calls: Array<{ method: string; key: string; args?: unknown[] }> = [];

  async get(key: string): Promise<MockR2ObjectBody | null> {
    this.calls.push({ method: "get", key });
    const obj = this.store.get(key);
    if (!obj) return null;
    return new MockR2ObjectBody(obj);
  }

  async head(key: string): Promise<Omit<MockR2ObjectBody, "body" | "bodyUsed" | "arrayBuffer" | "text" | "json" | "blob"> | null> {
    this.calls.push({ method: "head", key });
    const obj = this.store.get(key);
    if (!obj) return null;
    return new MockR2ObjectBody(obj);
  }

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | string | Uint8Array | null,
    opts?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> }
  ): Promise<MockR2ObjectBody> {
    this.calls.push({ method: "put", key, args: [opts] });

    let body: Uint8Array;
    let size: number;

    if (value instanceof Uint8Array) {
      body = value;
      size = value.length;
    } else if (typeof value === "string") {
      body = new TextEncoder().encode(value);
      size = body.length;
    } else if (value instanceof ArrayBuffer) {
      body = new Uint8Array(value);
      size = body.length;
    } else if (value && typeof (value as ReadableStream).getReader === "function") {
      // ReadableStream — read it fully
      const reader = (value as ReadableStream).getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        chunks.push(chunk);
      }
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      body = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      size = body.length;
    } else {
      body = new Uint8Array(0);
      size = 0;
    }

    const obj: R2StoredObject = {
      body,
      httpMetadata: opts?.httpMetadata,
      customMetadata: opts?.customMetadata,
      size,
      key,
      version: crypto.randomUUID(),
      uploaded: new Date(),
      etag: crypto.randomUUID(),
    };

    this.store.set(key, obj);
    return new MockR2ObjectBody(obj);
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      this.calls.push({ method: "delete", key: k });
      this.store.delete(k);
    }
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    delimiter?: string;
  }): Promise<{
    objects: Array<{ key: string; size: number; etag: string; uploaded: Date }>;
    truncated: boolean;
    cursor?: string;
    delimitedPrefixes: string[];
  }> {
    this.calls.push({ method: "list", key: "", args: [options] });
    let objects = Array.from(this.store.values())
      .filter((obj) => !options?.prefix || obj.key.startsWith(options.prefix))
      .map((obj) => ({
        key: obj.key,
        size: obj.size,
        etag: obj.etag,
        uploaded: obj.uploaded,
      }));

    if (options?.limit) {
      objects = objects.slice(0, options.limit);
    }

    return { objects, truncated: false, delimitedPrefixes: [] };
  }

  createMultipartUpload(
    key: string,
    opts?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> }
  ): MockR2MultipartUpload {
    this.calls.push({ method: "createMultipartUpload", key, args: [opts] });
    const uploadId = crypto.randomUUID();
    return new MockR2MultipartUpload(key, uploadId);
  }

  resumeMultipartUpload(key: string, uploadId: string): MockR2MultipartUpload {
    this.calls.push({ method: "resumeMultipartUpload", key, args: [uploadId] });
    return new MockR2MultipartUpload(key, uploadId);
  }

  /** Check if a key exists without fetching body. */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /** Reset store. */
  reset(): void {
    this.store.clear();
    this.calls.length = 0;
  }
}

// ---------------------------------------------------------------------------
// MockAssets - Simple Fetcher that returns a basic HTML response
// ---------------------------------------------------------------------------

export class MockAssets {
  calls: Array<{ url: string }> = [];

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = input instanceof Request ? input.url : String(input);
    this.calls.push({ url });
    return new Response(
      "<!DOCTYPE html><html><head><title>Mock</title></head><body><div id=\"root\"></div></body></html>",
      {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  }

  reset(): void {
    this.calls.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Environment and App Helpers
// ---------------------------------------------------------------------------

export interface MockEnv extends Env {
  DB: MockD1Database & D1Database;
  KV: MockKVNamespace & KVNamespace;
  R2: MockR2Bucket & R2Bucket;
  ASSETS: MockAssets & Fetcher;
}

/**
 * Create a full mock Env with all bindings.
 * DB, KV, R2, and ASSETS are in-memory mocks. String bindings get sensible defaults.
 */
export function createMockEnv(): MockEnv {
  return {
    DB: new MockD1Database() as MockD1Database & D1Database,
    KV: new MockKVNamespace() as MockKVNamespace & KVNamespace,
    R2: new MockR2Bucket() as MockR2Bucket & R2Bucket,
    ASSETS: new MockAssets() as MockAssets & Fetcher,
    ENVIRONMENT: "test",
    APP_NAME: "OWG Share Test",
    SESSION_SECRET: "test-session-secret-that-is-long-enough",
    RP_ID: "localhost",
    RP_ORIGIN: "http://localhost:3000",
  };
}

/**
 * Create a Hono app instance wired up with mock env.
 * Returns the app, mock env, and a convenience `request` helper that
 * automatically injects the bindings into each request.
 */
export function createTestApp() {
  // Import the real app setup — but we re-create it here so we can
  // use a fresh app per test. Instead of importing from index.ts
  // (which may export a default handler), we build the same route
  // tree ourselves.
  //
  // Note: Tests should call this at the top of each test/describe block
  // so they get isolated state.

  // Lazy import to avoid circular dep issues. The caller should have
  // already imported the routes they want to test. We create a lightweight
  // wrapper here.
  const env = createMockEnv();

  type AppEnv = { Bindings: Env };
  const app = new Hono<AppEnv>();

  /**
   * Helper to make a request against the app with the mock env injected.
   * Supports the same overloads as `app.request`:
   *   request("/api/shares", { method: "GET", headers: {...} })
   *   request(new Request("http://localhost/api/shares"))
   */
  async function request(
    input: string | Request,
    init?: RequestInit
  ): Promise<Response> {
    // app.request needs the env as the second arg for bindings
    if (typeof input === "string") {
      // Ensure full URL
      const url = input.startsWith("http") ? input : `http://localhost${input}`;
      return app.request(url, init, env);
    }
    return app.request(input, undefined, env);
  }

  return { app, env, request };
}

// ---------------------------------------------------------------------------
// Seeding Helpers
// ---------------------------------------------------------------------------

/**
 * Seed a user into the mock DB.
 * Returns the user ID.
 */
export function seedUser(
  env: MockEnv,
  userId?: string,
  username?: string
): string {
  const id = userId || crypto.randomUUID();
  const name = username || `testuser-${id.slice(0, 8)}`;
  const now = new Date().toISOString();

  (env.DB as MockD1Database).seed("users", {
    id,
    username: name,
    created_at: now,
    updated_at: now,
  });

  return id;
}

/**
 * Seed a session in KV for a given user.
 * Returns the cookie string that can be used in request headers.
 */
export async function seedSession(
  env: MockEnv,
  userId: string
): Promise<string> {
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const session: Session = {
    userId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  await (env.KV as MockKVNamespace).put(
    `session:${token}`,
    JSON.stringify(session),
    { expirationTtl: 7 * 24 * 60 * 60 }
  );

  return `session=${token}`;
}

/**
 * Seed an API key in the DB for a given user.
 * Returns the Bearer token string (including "Bearer " prefix) and the raw key.
 */
export async function seedApiKey(
  env: MockEnv,
  userId: string,
  name?: string
): Promise<{ bearer: string; rawKey: string; keyId: string }> {
  // Generate a deterministic-ish key for testing
  const rawKey = `owgs_test_${crypto.randomUUID().replace(/-/g, "")}`;
  const keyId = crypto.randomUUID();

  // Hash it the same way the real code does
  const encoder = new TextEncoder();
  const data = encoder.encode(rawKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  const keyHash = Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const keyPrefix = rawKey.slice(0, 12);
  const now = new Date().toISOString();

  (env.DB as MockD1Database).seed("api_keys", {
    id: keyId,
    user_id: userId,
    name: name || "Test API Key",
    key_hash: keyHash,
    key_prefix: keyPrefix,
    expires_at: null,
    last_used_at: null,
    last_used_ip: null,
    created_at: now,
  });

  return {
    bearer: `Bearer ${rawKey}`,
    rawKey,
    keyId,
  };
}

/**
 * Seed a share (and its type-specific data) into the mock DB.
 * Returns the share ID and slug.
 */
export function seedShare(
  env: MockEnv,
  userId: string,
  type: "link" | "markdown" | "code" | "file" | "gallery",
  data?: Partial<{
    id: string;
    slug: string;
    title: string;
    comment: string;
    encrypted: number;
    expires_at: string | null;
    max_hits: number | null;
    hits: number;
    // Link
    url: string;
    // Markdown / Code
    content: string;
    language: string;
    filename: string;
    // File
    content_type: string;
    size: number;
    r2_key: string;
  }>
): { shareId: string; slug: string } {
  const db = env.DB as MockD1Database;
  const shareId = data?.id || crypto.randomUUID();
  const slug = data?.slug || `test-${shareId.slice(0, 8)}`;
  const now = new Date().toISOString();

  db.seed("shares", {
    id: shareId,
    user_id: userId,
    slug,
    type,
    title: data?.title ?? null,
    comment: data?.comment ?? null,
    encrypted: data?.encrypted ?? 0,
    expires_at: data?.expires_at ?? null,
    max_hits: data?.max_hits ?? null,
    hits: data?.hits ?? 0,
    created_at: now,
    updated_at: now,
  });

  const typeId = crypto.randomUUID();

  switch (type) {
    case "link":
      db.seed("link_shares", {
        id: typeId,
        share_id: shareId,
        url: data?.url || "https://example.com",
      });
      break;
    case "markdown":
      db.seed("markdown_shares", {
        id: typeId,
        share_id: shareId,
        content: data?.content || "# Test Markdown",
      });
      break;
    case "code":
      db.seed("code_shares", {
        id: typeId,
        share_id: shareId,
        content: data?.content || 'console.log("hello")',
        language: data?.language ?? "javascript",
        filename: data?.filename ?? null,
      });
      break;
    case "file":
      db.seed("file_shares", {
        id: typeId,
        share_id: shareId,
        filename: data?.filename || "test.txt",
        content_type: data?.content_type || "text/plain",
        size: data?.size || 1024,
        r2_key: data?.r2_key || `${userId}/${shareId}/test.txt`,
      });
      break;
    case "gallery": {
      const galleryId = crypto.randomUUID();
      db.seed("gallery_shares", {
        id: galleryId,
        share_id: shareId,
      });
      break;
    }
  }

  return { shareId, slug };
}

/**
 * Seed a gallery image into the mock DB.
 * Requires the gallery_shares entry to already exist.
 */
export function seedGalleryImage(
  env: MockEnv,
  galleryId: string,
  data?: Partial<{
    id: string;
    filename: string;
    content_type: string;
    size: number;
    r2_key: string;
    sort_order: number;
    caption: string | null;
  }>
): string {
  const db = env.DB as MockD1Database;
  const imageId = data?.id || crypto.randomUUID();

  db.seed("gallery_images", {
    id: imageId,
    gallery_id: galleryId,
    filename: data?.filename || "image.jpg",
    content_type: data?.content_type || "image/jpeg",
    size: data?.size || 2048,
    r2_key: data?.r2_key || `test/${imageId}/image.jpg`,
    sort_order: data?.sort_order ?? 0,
    caption: data?.caption ?? null,
  });

  return imageId;
}

/**
 * Create a mock ExecutionContext for use in tests.
 */
export function createMockExecutionContext(): ExecutionContext {
  const waitUntilPromises: Promise<unknown>[] = [];
  return {
    waitUntil: vi.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(promise);
    }),
    passThroughOnException: vi.fn(),
    abort: vi.fn(),
    props: {} as never,
  } as unknown as ExecutionContext;
}
