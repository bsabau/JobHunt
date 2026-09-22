export async function up(sql) {
  // Stage semantics (which stage means "interview", which are resolved, etc.)
  // were previously inferred by matching stage names. Give each stage an
  // explicit kind so renamed and custom stages keep working.
  await sql`
    ALTER TABLE stages
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'active';
  `;

  // Backfill the default pipeline by name; custom stages keep the 'active'
  // default. The kind = 'active' guard means a re-run cannot overwrite a kind
  // that was set deliberately.
  await sql`
    UPDATE stages
    SET kind = v.kind
    FROM (VALUES
      ('wishlist', 'intake'),
      ('applied', 'active'),
      ('interview', 'interview'),
      ('offer', 'offer'),
      ('rejected', 'rejected')
    ) AS v(name, kind)
    WHERE LOWER(stages.name) = v.name
      AND stages.kind = 'active';
  `;

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stages_kind_check') THEN
        ALTER TABLE stages
        ADD CONSTRAINT stages_kind_check
        CHECK (kind IN ('intake', 'active', 'interview', 'offer', 'rejected'));
      END IF;
    END $$;
  `;
}
