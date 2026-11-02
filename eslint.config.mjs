import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Dead bindings are a gate, not a suggestion. `_` marks the one deliberate exception:
      // a parameter a signature requires but the body does not use.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["lib/**/*.ts", "lib/**/*.tsx"],
    rules: {
      // lib is the framework-free core: React and Next live in app/ and components/.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "react", "react-dom", "react/*", "@/components/*", "components/*"],
              message: "lib is framework-free — keep React/Next in app/ and components/",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "dist/**",
    "server/**",
  ]),
]);

export default eslintConfig;
