export async function up(sql) {
  // application_transitions_backup was left behind by migration 1730000002000
  // (history before that cleanup); pgmigrations belongs to an earlier migration
  // tool. No code reads either. Production's rows were exported on 2026-09-29
  // before this ran (backups/2026-09-29-unused-tables.json, not committed).
  await sql`DROP TABLE IF EXISTS application_transitions_backup;`;
  await sql`DROP TABLE IF EXISTS pgmigrations;`;
}
