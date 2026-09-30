export async function up(sql) {
  // An optional interview time and the IANA zone it is in. interview_date stays
  // a DATE and keeps driving "upcoming interviews" and the card label; the
  // time is separate so that a date-only interview stays exactly that.
  await sql`
    ALTER TABLE applications
      ADD COLUMN IF NOT EXISTS interview_time TIME,
      ADD COLUMN IF NOT EXISTS interview_time_zone TEXT;
  `;

  // A time comes with its zone, and only on a day that is set. Guarded, so a
  // re-run is harmless.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'applications'::regclass AND conname = 'applications_interview_time_has_zone') THEN
        ALTER TABLE applications ADD CONSTRAINT applications_interview_time_has_zone
          CHECK ((interview_time IS NULL) = (interview_time_zone IS NULL));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'applications'::regclass AND conname = 'applications_interview_time_has_date') THEN
        ALTER TABLE applications ADD CONSTRAINT applications_interview_time_has_date
          CHECK (interview_time IS NULL OR interview_date IS NOT NULL);
      END IF;
    END $$;
  `;
}
