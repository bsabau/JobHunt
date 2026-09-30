export async function up(sql) {
  // Optional facts the owner types: whether there was a referral, the work
  // mode, the location, and the salary. Salary is owner-only, like notes
  // (mapApplication() in src/lib/db/rows.ts). Existing rows get no referral.
  await sql`
    ALTER TABLE applications
      ADD COLUMN IF NOT EXISTS referral BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS work_mode TEXT,
      ADD COLUMN IF NOT EXISTS location TEXT,
      ADD COLUMN IF NOT EXISTS salary TEXT;
  `;

  // The API enforces the same rules (WORK_MODES and TEXT_LIMITS in
  // src/lib/limits.ts); each constraint is added only if missing, so a re-run
  // is harmless.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'applications'::regclass AND conname = 'applications_work_mode_known') THEN
        ALTER TABLE applications ADD CONSTRAINT applications_work_mode_known CHECK (work_mode IN ('remote', 'hybrid', 'onsite'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'applications'::regclass AND conname = 'applications_location_not_blank') THEN
        ALTER TABLE applications ADD CONSTRAINT applications_location_not_blank CHECK (btrim(location) <> '');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'applications'::regclass AND conname = 'applications_salary_not_blank') THEN
        ALTER TABLE applications ADD CONSTRAINT applications_salary_not_blank CHECK (btrim(salary) <> '');
      END IF;
    END $$;
  `;
}
