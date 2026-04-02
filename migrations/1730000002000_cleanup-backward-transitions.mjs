export async function up(sql) {
  // Step 1: Back up all transitions before cleanup
  await sql`
    CREATE TABLE IF NOT EXISTS application_transitions_backup AS
    SELECT * FROM application_transitions;
  `;

  // Step 2: Clean up backward transitions for each application
  // For each app, walk through transitions in order and rebuild a clean history.
  // When a backward move is detected (to_status has lower sort_order than from_status),
  // we remove intermediate transitions that went past the target.
  const apps = await sql`
    SELECT DISTINCT application_id FROM application_transitions ORDER BY application_id;
  `;

  for (const row of apps) {
    const appId = row.application_id;

    // Get all transitions for this app in order, with sort_orders
    const transitions = await sql`
      SELECT t.id, t.from_status, t.to_status, t.transitioned_at,
             fs.sort_order AS from_sort, ts.sort_order AS to_sort
      FROM application_transitions t
      LEFT JOIN stages fs ON fs.name = t.from_status
      LEFT JOIN stages ts ON ts.name = t.to_status
      WHERE t.application_id = ${appId}
      ORDER BY t.transitioned_at ASC, t.id ASC;
    `;

    // Build clean history: walk through transitions and rewind on backward moves
    const clean = [];
    for (const t of transitions) {
      if (t.to_sort !== null && t.from_sort !== null && t.to_sort < t.from_sort) {
        // Backward move: remove transitions where to_status sort_order >= target sort_order
        while (clean.length > 0) {
          const last = clean[clean.length - 1];
          if (last.to_sort >= t.to_sort) {
            clean.pop();
          } else {
            break;
          }
        }
        // Add transition from last clean to_status to target (if different)
        if (clean.length > 0) {
          const fromStatus = clean[clean.length - 1].to_status;
          if (fromStatus !== t.to_status) {
            clean.push({ ...t, from_status: fromStatus });
          }
        }
        // If clean is empty, no transition needed (back to initial stage)
      } else {
        clean.push(t);
      }
    }

    // Delete all transitions for this app and re-insert clean ones
    await sql`DELETE FROM application_transitions WHERE application_id = ${appId};`;

    for (const t of clean) {
      await sql`
        INSERT INTO application_transitions (application_id, from_status, to_status, transitioned_at)
        VALUES (${appId}, ${t.from_status}, ${t.to_status}, ${t.transitioned_at});
      `;
    }
  }
}
