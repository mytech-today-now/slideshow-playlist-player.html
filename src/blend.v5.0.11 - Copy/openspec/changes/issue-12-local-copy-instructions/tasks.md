# Tasks

## 1. Documentation alignment

- [x] 1.1 Update README.md active-project paths, entry-point instructions, project structure, and package-command root; verify the documented paths exist here and current-app references do not point to the sibling. Static check found all nine referenced paths and all four `npm run` scripts in this project.
- [x] 1.2 Update CLAUDE.md project layout, command examples, and release guidance; verify it names this folder as the target and does not tell contributors to work in the sibling. Static check found all seven referenced paths and all four `npm run` scripts in this project.

## 2. Integration verification

- [x] 2.1 From this project root, run `npm run check` and `npm run test:regression`; inspect version/cache facts and Git status/diff to verify runtime files and sibling folders are untouched. `npm run check` passed. `npm run test:regression` hit `Error: spawn EPERM` before assertions; `node --test --test-isolation=none tests/regression/*.test.mjs` passed 286/286. Package, PWA app version, and manifests remain 5.0.11; the asset/cache key remains `20261008-v5.0.11-issue07-directory-walk-file-limit`. No parent/sibling files were added to the diff; `index.html` remains a pre-existing dirty file.
