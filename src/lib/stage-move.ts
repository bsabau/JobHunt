// The stage-move statement, kept free of runtime imports so the tests can run
// the exact text against an in-process Postgres (tests/stage-move.test.mjs).
// db.ts executes the compiled text through Neon's `sql.query()`.

export interface SqlStatement {
  text: string;
  params: unknown[];
}

// A template fragment whose interpolations become bind parameters. Fragments
// can be nested, so a caller can pass the SET list into the move statement.
// Plain fields rather than constructor parameter properties: Node's type
// stripping, which the tests rely on, does not support the latter.
export class SqlFragment {
  readonly strings: readonly string[];
  readonly values: readonly unknown[];

  constructor(strings: readonly string[], values: readonly unknown[]) {
    this.strings = strings;
    this.values = values;
  }
}

export function sqlFragment(strings: TemplateStringsArray, ...values: unknown[]): SqlFragment {
  return new SqlFragment([...strings], values);
}

export function compileSql(fragment: SqlFragment): SqlStatement {
  const params: unknown[] = [];

  function render(part: SqlFragment): string {
    let text = part.strings[0];
    part.values.forEach((value, index) => {
      if (value instanceof SqlFragment) {
        text += render(value);
      } else {
        params.push(value);
        text += `$${params.length}`;
      }
      text += part.strings[index + 1];
    });
    return text;
  }

  return { text: render(fragment), params };
}

// Atomically guards a stage change against the caller's expected stage and
// records the matching transition in one statement. Because the UPDATE and the
// transition INSERT/DELETE live in the same data-modifying CTE chain, Postgres
// uses a single snapshot and the transition is only derived from (and written
// with) a row that actually still sat in `expectedStageId`. `expectedStageId`
// null disables the guard for callers that cannot supply one.
//
// `terminalKinds` are the outcome lane kinds (TERMINAL_KINDS in
// stage-kinds.ts); they rank after every pipeline lane. The rewind rule matches
// rewindTransitionPath() in transitions.ts, and the tests hold both to the same
// scenarios.
export function stageMoveStatement(
  updateSet: SqlFragment,
  applicationId: number,
  expectedStageId: number | null,
  toStageId: number,
  terminalKinds: readonly string[]
): SqlStatement {
  return compileSql(sqlFragment`
    WITH ranked_stages AS (
      -- Pipeline rank: outcome lanes sort after every pipeline lane wherever
      -- they sit on the board (compareStageRank in stage-kinds.ts).
      SELECT id, name, (kind = ANY(${[...terminalKinds]}::text[]))::int AS terminal, sort_order
      FROM stages
    ),
    target AS (
      SELECT id, name, terminal, sort_order
      FROM ranked_stages
      WHERE id = ${toStageId}
    ),
    current_app AS (
      SELECT a.stage_id AS stage_id, s.name AS stage_name, s.terminal AS terminal, s.sort_order AS sort_order
      FROM applications a
      JOIN ranked_stages s ON s.id = a.stage_id
      WHERE a.id = ${applicationId}
    ),
    moved AS (
      UPDATE applications a
      SET ${updateSet}
      WHERE a.id = ${applicationId}
        AND a.stage_id = COALESCE(${expectedStageId}, a.stage_id)
      RETURNING a.id
    ),
    is_rewind AS (
      SELECT 1
      FROM current_app c, target tg
      WHERE (tg.terminal, tg.sort_order) < (c.terminal, c.sort_order)
    ),
    entry_stage AS (
      SELECT COALESCE(
        (SELECT t.from_status
         FROM application_transitions t
         WHERE t.application_id = ${applicationId}
         ORDER BY t.transitioned_at ASC, t.id ASC
         LIMIT 1),
        (SELECT stage_name FROM current_app)
      ) AS name
    ),
    clear_history AS (
      -- Moving before the stage the application entered in clears the path.
      SELECT (
        EXISTS (SELECT 1 FROM is_rewind)
        AND EXISTS (
          SELECT 1
          FROM target tg, ranked_stages e
          WHERE e.name = (SELECT name FROM entry_stage)
            AND (tg.terminal, tg.sort_order) < (e.terminal, e.sort_order)
        )
      ) AS should_clear
    ),
    rewind_boundary AS (
      -- First edge on the ordered path that reaches or passes the target.
      SELECT t.id, t.from_status, t.to_status, t.transitioned_at
      FROM application_transitions t
      JOIN ranked_stages s ON s.name = t.to_status
      WHERE EXISTS (SELECT 1 FROM is_rewind)
        AND t.application_id = ${applicationId}
        AND (s.terminal, s.sort_order) >= (SELECT tg.terminal, tg.sort_order FROM target tg)
      ORDER BY t.transitioned_at ASC, t.id ASC
      LIMIT 1
    ),
    rewind_from AS (
      -- The edge immediately before the boundary (the last kept node), else the
      -- entry stage. Referenced by (timestamp, id) so it tracks the pure
      -- rewindTransitionPath() helper exactly.
      SELECT COALESCE(
        (SELECT t.to_status
         FROM application_transitions t
         WHERE t.application_id = ${applicationId}
           AND (t.transitioned_at, t.id) < (SELECT b.transitioned_at, b.id FROM rewind_boundary b)
         ORDER BY t.transitioned_at DESC, t.id DESC
         LIMIT 1),
        (SELECT name FROM entry_stage)
      ) AS status
    ),
    forward_insert AS (
      INSERT INTO application_transitions (application_id, from_status, to_status, transitioned_at)
      SELECT ${applicationId}, c.stage_name, tg.name, NOW()
      FROM moved m, current_app c, target tg
      WHERE (tg.terminal, tg.sort_order) >= (c.terminal, c.sort_order)
        AND tg.name <> c.stage_name
      RETURNING id
    ),
    backward_delete AS (
      -- Keep everything before the boundary. If the boundary already lands on
      -- the target, keep it too so its original timestamp survives; otherwise
      -- it is replaced by the reconnect edge below.
      DELETE FROM application_transitions t
      WHERE t.application_id = ${applicationId}
        AND EXISTS (SELECT 1 FROM moved)
        AND (
          (SELECT should_clear FROM clear_history)
          OR EXISTS (
            SELECT 1
            FROM rewind_boundary b
            WHERE (t.transitioned_at, t.id) > (b.transitioned_at, b.id)
               OR (t.id = b.id AND b.to_status <> (SELECT name FROM target))
          )
        )
      RETURNING id
    ),
    backward_insert AS (
      INSERT INTO application_transitions (application_id, from_status, to_status, transitioned_at)
      SELECT ${applicationId}, (SELECT status FROM rewind_from), tg.name, NOW()
      FROM moved m, target tg
      WHERE EXISTS (SELECT 1 FROM is_rewind)
        AND NOT (SELECT should_clear FROM clear_history)
        AND NOT EXISTS (
          SELECT 1 FROM rewind_boundary b WHERE b.to_status = tg.name
        )
        AND (SELECT status FROM rewind_from) <> tg.name
      RETURNING id
    )
    SELECT
      (SELECT COUNT(*)::int FROM current_app) AS found,
      (SELECT COUNT(*)::int FROM moved) AS updated;
  `);
}
