export async function up(sql) {
  // Normalize any legacy duplicate sort_order values before enforcing
  // uniqueness. Existing rows may collide because the column was never
  // constrained.
  await sql`
    WITH ordered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order ASC, id ASC) - 1 AS new_sort
      FROM stages
    )
    UPDATE stages s
    SET sort_order = ordered.new_sort
    FROM ordered
    WHERE s.id = ordered.id;
  `;

  // Deferrable and deferred so the bulk renumber in reorderStages() and the
  // deleteStage resequence commit without transient collisions, while a
  // concurrent addStage still gets a 23505 the route maps to a 409.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stages_sort_order_key') THEN
        ALTER TABLE stages
        ADD CONSTRAINT stages_sort_order_key
        UNIQUE (sort_order) DEFERRABLE INITIALLY DEFERRED;
      END IF;
    END $$;
  `;
}
