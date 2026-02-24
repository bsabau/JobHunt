export async function up(sql) {
  await sql`
    ALTER TABLE applications
    ADD COLUMN IF NOT EXISTS interview_date DATE;
  `;
}
