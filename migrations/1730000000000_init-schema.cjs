/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable(
    "stages",
    {
      id: "id",
      name: { type: "text", notNull: true, unique: true },
      sort_order: { type: "integer", notNull: true }
    },
    { ifNotExists: true }
  );

  pgm.createTable(
    "applications",
    {
      id: "id",
      company: { type: "text", notNull: true },
      role: { type: "text", notNull: true },
      notes: { type: "text" },
      source_url: { type: "text" },
      logo_url: { type: "text" },
      stage_id: {
        type: "integer",
        notNull: true,
        references: "stages(id)",
        onDelete: "RESTRICT"
      },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") }
    },
    { ifNotExists: true }
  );

  pgm.createTable(
    "application_transitions",
    {
      id: "id",
      application_id: {
        type: "integer",
        notNull: true,
        references: "applications(id)",
        onDelete: "CASCADE"
      },
      from_status: { type: "text", notNull: true },
      to_status: { type: "text", notNull: true },
      transitioned_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") }
    },
    { ifNotExists: true }
  );

  pgm.sql(`
    INSERT INTO stages (name, sort_order)
    SELECT v.name, v.sort_order
    FROM (VALUES
      ('Wishlist', 0),
      ('Applied', 1),
      ('Interview', 2),
      ('Offer', 3),
      ('Rejected', 4)
    ) AS v(name, sort_order)
    WHERE NOT EXISTS (SELECT 1 FROM stages);
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable("application_transitions", { ifExists: true });
  pgm.dropTable("applications", { ifExists: true });
  pgm.dropTable("stages", { ifExists: true });
};
