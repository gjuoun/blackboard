import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  // js.configs.recommended without the style/opinionated rules eslint-config-next never enforced;
  // what the repo lints for is the TS ruleset below plus the gates further down.
  ...tseslint.configs.recommended,
  reactHooks.configs.flat["recommended-latest"],
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
      // lib is the framework-free core: React and the router live in src/ and components/.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "react", "react-dom", "react/*", "@tanstack/*", "@/components/*", "components/*"],
              message: "lib is framework-free — keep React/router in src/ and components/",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    "out/**",
    "build/**",
    "dist/**",
    "server/**",
    ".output/**",
    ".tanstack/**",
    "src/routeTree.gen.ts",
    // The eslint scan traverses the whole tree looking for JS/TS it can parse; the things it finds
    // there are not what it lints.
    "node_modules/**",
    "sketches/**",
    "docs/**",
    "test/fixtures/**",
    ".next/**",
  ]),
]);

export default eslintConfig;
