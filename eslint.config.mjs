import next from "eslint-config-next";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  // Agent worktrees live under .claude/ and are full copies of the repo.
  { ignores: [".claude/**"] },
  ...next,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn"
    }
  }
];

export default config;
