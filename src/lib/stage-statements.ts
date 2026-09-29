// Statements that change lanes and their history (moving a card, renaming a
// lane), kept free of runtime imports so the tests can run the exact text
// against an in-process Postgres (tests/stage-statements.test.mjs). src/lib/db
// executes the compiled text through Neon's `sql.query()`.

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
// with) a row that actually still sat in `expectedStageId`.
//
// History refers to lanes by id. A row whose lane was deleted has a NULL id and
// only its stored name, and counts as an unknown lane when finding the rewind
// boundary. `terminalKinds` are the outcome lane kinds (TERMINAL_KINDS in
// stage-kinds.ts); they rank after every pipeline lane. The rewind rule matches
// rewindTransitionPath() in transitions.ts, and the tests hold both to the same
// scenarios.
export function stageMoveStatement(
  updateSet: SqlFragment,
  applicationId: number,
  expectedStageId: number,
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
        AND a.stage_id = ${expectedStageId}
      RETURNING a.id
    ),
    is_rewind AS (
      SELECT 1
      FROM current_app c, target tg
      WHERE (tg.terminal, tg.sort_order) < (c.terminal, c.sort_order)
    ),
    entry_stage AS (
      -- The lane the application entered in (the application_entry_stage
      -- view). Like every CTE here it reads the state before this move. The id
      -- is NULL when that lane has been deleted.
      SELECT e.stage_id AS id, e.stage_name AS name
      FROM application_entry_stage e
      WHERE e.application_id = ${applicationId}
    ),
    clear_history AS (
      -- Moving before the stage the application entered in clears the path.
      SELECT (
        EXISTS (SELECT 1 FROM is_rewind)
        AND EXISTS (
          SELECT 1
          FROM target tg, ranked_stages e
          WHERE e.id = (SELECT id FROM entry_stage)
            AND (tg.terminal, tg.sort_order) < (e.terminal, e.sort_order)
        )
      ) AS should_clear
    ),
    rewind_boundary AS (
      -- First edge on the ordered path that reaches or passes the target.
      SELECT t.id, t.to_stage_id, t.transitioned_at
      FROM application_transitions t
      JOIN ranked_stages s ON s.id = t.to_stage_id
      WHERE EXISTS (SELECT 1 FROM is_rewind)
        AND t.application_id = ${applicationId}
        AND (s.terminal, s.sort_order) >= (SELECT tg.terminal, tg.sort_order FROM target tg)
      ORDER BY t.transitioned_at ASC, t.id ASC
      LIMIT 1
    ),
    kept_edge AS (
      -- The edge immediately before the boundary: its end is the last kept
      -- lane. Referenced by (timestamp, id) so it tracks rewindTransitionPath().
      SELECT t.to_stage_id AS id, t.to_status AS name
      FROM application_transitions t
      WHERE t.application_id = ${applicationId}
        AND (t.transitioned_at, t.id) < (SELECT b.transitioned_at, b.id FROM rewind_boundary b)
      ORDER BY t.transitioned_at DESC, t.id DESC
      LIMIT 1
    ),
    rewind_from AS (
      -- The last kept lane, else the entry lane.
      SELECT k.id, k.name FROM kept_edge k
      UNION ALL
      SELECT e.id, e.name FROM entry_stage e WHERE NOT EXISTS (SELECT 1 FROM kept_edge)
    ),
    forward_insert AS (
      INSERT INTO application_transitions (application_id, from_status, from_stage_id, to_status, to_stage_id, transitioned_at)
      SELECT ${applicationId}, c.stage_name, c.stage_id, tg.name, tg.id, NOW()
      FROM moved m, current_app c, target tg
      WHERE (tg.terminal, tg.sort_order) >= (c.terminal, c.sort_order)
        AND tg.id <> c.stage_id
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
               OR (t.id = b.id AND b.to_stage_id <> (SELECT id FROM target))
          )
        )
      RETURNING id
    ),
    backward_insert AS (
      -- The reconnect edge from the last kept lane to the target. Without a
      -- boundary nothing was cut, so nothing is reconnected either (as in
      -- rewindTransitionPath). A deleted lane that shared the target's name is
      -- a different lane, so the edge from it is written. It takes the
      -- boundary's time: the card left the last kept lane then, and the rewind
      -- only corrects where it went (so the applied date does not move).
      INSERT INTO application_transitions (application_id, from_status, from_stage_id, to_status, to_stage_id, transitioned_at)
      SELECT ${applicationId}, rf.name, rf.id, tg.name, tg.id, b.transitioned_at
      FROM moved m, target tg, rewind_from rf, rewind_boundary b
      WHERE EXISTS (SELECT 1 FROM is_rewind)
        AND NOT (SELECT should_clear FROM clear_history)
        AND b.to_stage_id IS DISTINCT FROM tg.id
        AND rf.id IS DISTINCT FROM tg.id
      RETURNING id
    )
    SELECT
      (SELECT COUNT(*)::int FROM current_app) AS found,
      (SELECT COUNT(*)::int FROM moved) AS updated;
  `);
}

// Renames a lane and/or changes its kind in one statement. The names stored in
// history are rewritten in the same statement, by id, so they always match the
// live lane; after the lane is deleted they keep its last name. Returns the
// updated lane, or no row when it does not exist.
export function stageUpdateStatement(
  stageId: number,
  changes: { name?: string; kind?: string }
): SqlStatement {
  return compileSql(sqlFragment`
    WITH updated AS (
      UPDATE stages
      SET name = COALESCE(${changes.name ?? null}::text, name),
          kind = COALESCE(${changes.kind ?? null}::text, kind)
      WHERE id = ${stageId}
      RETURNING id, name, sort_order, kind
    ),
    renamed_from AS (
      UPDATE application_transitions t
      SET from_status = u.name
      FROM updated u
      WHERE t.from_stage_id = u.id AND t.from_status <> u.name
      RETURNING t.id
    ),
    renamed_to AS (
      UPDATE application_transitions t
      SET to_status = u.name
      FROM updated u
      WHERE t.to_stage_id = u.id AND t.to_status <> u.name
      RETURNING t.id
    )
    SELECT id, name, sort_order, kind FROM updated;
  `);
}
