export async function up(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS stages (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      notes TEXT,
      interview_date DATE,
      source_url TEXT,
      logo_url TEXT,
      stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS application_transitions (
      id SERIAL PRIMARY KEY,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      transitioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
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
  `;
}
