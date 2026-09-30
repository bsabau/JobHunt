import next from "eslint-config-next";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  // Agent worktrees live under .claude/ and are full copies of the repo.
  { ignores: [".claude/**"] },
  ...next,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      // An escape that does nothing is usually a meant one that went wrong:
      // "\;" in a string is just ";" (PR #42's calendar escaping).
      "no-useless-escape": "error"
    }
  }
];

export default config;
