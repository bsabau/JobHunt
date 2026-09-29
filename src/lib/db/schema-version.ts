// The newest migration the code needs. ensureSchema() refuses to query a
// database whose schema_migrations is behind it; tests/schema.test.mjs fails
// when this falls behind the newest file in migrations/. Update it with every
// migration.
export const LATEST_MIGRATION = "1730000017000_application-milestones-view.mjs";
