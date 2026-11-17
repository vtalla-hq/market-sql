import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // node-sql-parser's AST is untyped; guardrails.ts walks it as `any` on purpose.
    files: ["lib/guardrails.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  globalIgnores([".next/**", "node_modules/**", ".venv/**", "next-env.d.ts"]),
]);
