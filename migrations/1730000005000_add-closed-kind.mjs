export async function up(sql) {
  // 'closed' marks outcome lanes that are not rejections (e.g. Ghosting): like
  // 'rejected' they leave the pipeline, but they are counted separately.
  await sql`ALTER TABLE stages DROP CONSTRAINT IF EXISTS stages_kind_check;`;
  await sql`
    ALTER TABLE stages
    ADD CONSTRAINT stages_kind_check
    CHECK (kind IN ('intake', 'active', 'interview', 'offer', 'rejected', 'closed'));
  `;

  // Custom lanes were always created as 'active'. Classify the common ones by
  // name; the kind = 'active' guard leaves any deliberately chosen kind alone.
  await sql`
    UPDATE stages
    SET kind = CASE
      WHEN LOWER(name) LIKE 'rejected%' THEN 'rejected'
      WHEN LOWER(name) LIKE 'ghost%' THEN 'closed'
      WHEN LOWER(name) LIKE 'interview%' THEN 'interview'
    END
    WHERE kind = 'active'
      AND (
        LOWER(name) LIKE 'rejected%'
        OR LOWER(name) LIKE 'ghost%'
        OR LOWER(name) LIKE 'interview%'
      );
  `;
}
