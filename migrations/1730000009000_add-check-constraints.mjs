export async function up(sql) {
  // Mirrors rules the API already enforces, so a script or a future code path
  // cannot store what the app would never create. Each constraint is added only
  // if missing, so a re-run is harmless.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applications_company_not_blank') THEN
        ALTER TABLE applications ADD CONSTRAINT applications_company_not_blank CHECK (btrim(company) <> '');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applications_role_not_blank') THEN
        ALTER TABLE applications ADD CONSTRAINT applications_role_not_blank CHECK (btrim(role) <> '');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stages_name_not_blank') THEN
        ALTER TABLE stages ADD CONSTRAINT stages_name_not_blank CHECK (btrim(name) <> '');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stages_sort_order_non_negative') THEN
        ALTER TABLE stages ADD CONSTRAINT stages_sort_order_non_negative CHECK (sort_order >= 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'application_transitions_no_self_loop') THEN
        ALTER TABLE application_transitions ADD CONSTRAINT application_transitions_no_self_loop CHECK (from_status <> to_status);
      END IF;
    END $$;
  `;
}
