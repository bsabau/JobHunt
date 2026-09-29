export async function up(sql) {
  // Mirrors rules the API already enforces, so a script or a future code path
  // cannot store what the app would never create. Each constraint is added only
  // if its table does not already have it, so a re-run is harmless. The
  // no-self-loop check on transitions lives in 1730000010000, after the rows
  // that would violate it are removed.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'applications'::regclass AND conname = 'applications_company_not_blank') THEN
        ALTER TABLE applications ADD CONSTRAINT applications_company_not_blank CHECK (btrim(company) <> '');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'applications'::regclass AND conname = 'applications_role_not_blank') THEN
        ALTER TABLE applications ADD CONSTRAINT applications_role_not_blank CHECK (btrim(role) <> '');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'stages'::regclass AND conname = 'stages_name_not_blank') THEN
        ALTER TABLE stages ADD CONSTRAINT stages_name_not_blank CHECK (btrim(name) <> '');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'stages'::regclass AND conname = 'stages_sort_order_non_negative') THEN
        ALTER TABLE stages ADD CONSTRAINT stages_sort_order_non_negative CHECK (sort_order >= 0);
      END IF;
    END $$;
  `;
}
