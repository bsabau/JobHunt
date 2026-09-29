export async function up(sql) {
  // Early versions recorded creation as a transition from a synthetic
  // "created" lane. None remain in production; deleting them here makes that
  // a guarantee for every copy, so queries no longer need to filter them out.
  await sql`
    DELETE FROM application_transitions
    WHERE LOWER(from_status) = 'created' OR LOWER(to_status) = 'created';
  `;
}
