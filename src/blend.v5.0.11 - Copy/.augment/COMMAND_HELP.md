# Command Help Reference

Auto-generated command-line help for Augment workflow tools.

**Generated**: 2026-10-19T18:02:17.652Z
**Tools**: Augx, Beads, OpenSpec
**Version**: 1.0.0

---

## Augx Commands (augx)

---

## Beads Commands (bd)

### bd --help

```
Issues chained together like beads. A lightweight issue tracker with first-class dependency support.

Usage:
  bd [flags]
  bd [command]

Working With Issues:
  assign            Assign an issue to someone
  children          List child beads of a parent
  close             Close one or more issues
  comment           Add a comment to an issue
  comments          View or manage comments on an issue
  create            Create a new issue (or batch from markdown/graph JSON)
  create-form       Create a new issue using an interactive form
  delete            Delete one or more issues and clean up references
  edit              Edit an issue field in $EDITOR
  gate              Manage async coordination gates
  heartbeat         Refresh the lease on an issue you hold in_progress
  label             Manage issue labels
  link              Link two issues with a dependency
  list              List issues
  merge-slot        Manage merge-slot gates for serialized conflict resolution
  note              Append a note to an issue
  priority          Set the priority of an issue
  promote           Promote a wisp to a permanent bead
  provenance        Append-only provenance event log
  q                 Quick capture: create issue and output only ID
  query             Query issues using a simple query language
  reclaim           Revert stale-lease in_progress issues back to ready (dead-worker recovery)
  reopen            Reopen one or more closed issues
  search            Search issues by text query
  set-state         Set operational state (creates event + updates label)
  show              Show issue details
  state             Query the current value of a state dimension
  tag               Add a label to an issue
  todo              Manage TODO items (convenience wrapper for task issues)
  unclaim           Release a claimed issue
  update            Update one or more issues

Views & Reports:
  count             Count issues matching filters
  diff              Show changes between two commits or branches
  find-duplicates   Find semantically similar issues using text analysis or AI
  history           Show version history for an issue
  lint              Check issues for missing template sections
  stale             Show stale issues (not updated recently)
  status            Show issue database overview and statistics
  statuses          List valid issue statuses
  types             List valid issue types

Dependencies & Structure:
  dep               Manage dependencies
  duplicate         Mark an issue as a duplicate of another
  duplicates        Find and optionally merge duplicate issues
  epic              Epic management commands
  graph             Display issue dependency graph
  supersede         Mark an issue as superseded by a newer one
  swarm             Swarm management for structured epics

Sync & Data:
  backup            Back up your beads database
  branch            List or create branches
  conflicts         Inspect and resolve live merge conflicts
  export            Export issues to JSONL format
  federation        Manage peer-to-peer federation with other workspaces
  import            Import issues from a JSONL file or stdin into the database
  restore           Restore the pre-compaction content of a compacted issue
  sync              Pull, check for conflicts, repair is_blocked, and push (the federation loop)
  vc                Version control operations

Setup & Configuration:
  bootstrap         Non-destructive database setup for fresh clones and recovery
  config            Manage configuration settings
  context           Show effective backend identity and repository context
  dolt              Configure Dolt database settings
  forget            Remove a persistent memory
  hooks             Manage git hooks for beads integration
  human             Show essential commands for human users
  info              Show database information
  init              Initialize bd in the current directory
  kv                Key-value store commands
  memories          List or search persistent memories
  migrate-personal  Move personal planning issues from the project database to your planning repo
  onboard           Display minimal snippet for agent instructions file
  prime             Output AI-optimized workflow context
  quickstart        Quick start guide for bd
  recall            Retrieve a specific memory
  remember          Store a persistent memory
  setup             Setup integration with AI editors
  where             Show active beads location

Maintenance:
  batch             Run multiple write operations in a single database transaction
  compact           Squash old Dolt commits to reduce history size
  doctor            Check and fix beads installation health (start here)
  events            Read and manage the durable events journal
  flatten           Squash all Dolt history into a single commit
  gc                Garbage collect: decay old issues, compact Dolt commits, run Dolt GC
  migrate           Database migration commands
  ping              Check database connectivity
  preflight         Show PR readiness checklist
  prune             Delete old closed beads to reclaim space and shrink exports
  purge             Delete closed ephemeral beads to reclaim space
  recompute-blocked Recompute is_blocked for all issues (repairs stale flags after a pull)
  rename-prefix     Rename the issue prefix for all issues in the database
  rules             Audit and compact Claude rules
  sql               Execute raw SQL against the beads database
  upgrade           Check and manage bd version upgrades
  worktree          Manage git worktrees for parallel development

Integrations & Advanced:
  admin             Administrative commands for database maintenance
  jira              Jira integration commands
  linear            Linear integration commands
  repo              Manage multiple repository configuration

Additional Commands:
  ado               Azure DevOps integration commands
  audit             Record and label agent interactions (append-only JSONL)
  blocked           Show blocked issues
  completion        Generate the autocompletion script for the specified shell
  cook              Compile a formula into a proto (ephemeral by default)
  defer             Defer one or more issues for later
  formula           Manage workflow formulas
  github            GitHub integration commands
  gitlab            GitLab integration commands
  help              Help about any command
  init-safety       Explain bd init flag semantics and the destroy-token format
  mail              Delegate to mail provider (e.g., gt mail)
  metrics           Show or change anonymous usage-metrics settings
  mol               Molecule commands (work templates)
  notion            Notion integration commands
  orphans           Identify orphaned issues (referenced in commits but still open)
  ready             Show ready work (open, no active blockers)
  rename            Rename an issue ID
  schema            Print the JSON Schema for bd's --json / export output
  serve             Serve the beads HTTP API over loopback
  ship              Publish a capability for cross-project dependencies
  undefer           Undefer one or more issues (restore to open)
  version           Print version information

Flags:
      --actor string              Actor name for audit trail (default: $BEADS_ACTOR, git user.name, $USER)
      --cpu-profile               Generate CPU profile for performance analysis
      --database string           Run against a different server database for this invocation, without changing the project's configured database (proxied-server mode only)
      --db string                 Database path (default: auto-discover .beads/*.db). In proxied-server mode, a value that isn't an existing path is treated as a database name override (see --database)
  -C, --directory string          Change to this directory before running the command (like git -C)
      --dolt-auto-commit string   Dolt auto-commit policy (off|on|batch). 'on': commit after each write. 'batch': defer commits to bd dolt commit; uncommitted changes persist in the working set until then (a live batch-mode bd process also flushes on SIGTERM/SIGHUP, except in proxied-server mode, where bd dolt commit is the only flush point). In proxied-server mode the deferral covers the writes the CLI makes on that route, including config and version metadata; explicit commit points (bd batch, bd mol bond/pour/squash, bd mol wisp create, and the wisp half of bd mol burn) still commit, and a bd serve process on the same database is unaffected. Default: on. Override via config key dolt.auto-commit
      --global                    Use the global shared-server database (beads_global)
  -h, --help                      help for bd
      --ignore-schema-skew        Proceed despite forward schema drift (some queries may fail)
      --json                      Output in JSON format
      --mem-profile string        Write heap profile to FILE on exit (also respects BEADS_MEM_PROFILE)
      --no-color                  Disable color output (also: NO_COLOR=1 or CLICOLOR=0)
  -q, --quiet                     Suppress non-essential output (errors only)
      --readonly                  Read-only mode: block write operations (for worker sandboxes)
      --sandbox                   Sandbox mode: disables Dolt auto-push
  -v, --verbose                   Enable verbose/debug output
  -V, --version                   Print version information

Use "bd [command] --help" for more information about a command.

```

#### bd version --help

```
Print version information

Usage:
  bd version [flags]

Flags:
  -h, --help   help for version

Global Flags:
      --actor string              Actor name for audit trail (default: $BEADS_ACTOR, git user.name, $USER)
      --cpu-profile               Generate CPU profile for performance analysis
      --database string           Run against a different server database for this invocation, without changing the project's configured database (proxied-server mode only)
      --db string                 Database path (default: auto-discover .beads/*.db). In proxied-server mode, a value that isn't an existing path is treated as a database name override (see --database)
  -C, --directory string          Change to this directory before running the command (like git -C)
      --dolt-auto-commit string   Dolt auto-commit policy (off|on|batch). 'on': commit after each write. 'batch': defer commits to bd dolt commit; uncommitted changes persist in the working set until then (a live batch-mode bd process also flushes on SIGTERM/SIGHUP, except in proxied-server mode, where bd dolt commit is the only flush point). In proxied-server mode the deferral covers the writes the CLI makes on that route, including config and version metadata; explicit commit points (bd batch, bd mol bond/pour/squash, bd mol wisp create, and the wisp half of bd mol burn) still commit, and a bd serve process on the same database is unaffected. Default: on. Override via config key dolt.auto-commit
      --global                    Use the global shared-server database (beads_global)
      --ignore-schema-skew        Proceed despite forward schema drift (some queries may fail)
      --json                      Output in JSON format
      --mem-profile string        Write heap profile to FILE on exit (also respects BEADS_MEM_PROFILE)
      --no-color                  Disable color output (also: NO_COLOR=1 or CLICOLOR=0)
  -q, --quiet                     Suppress non-essential output (errors only)
      --readonly                  Read-only mode: block write operations (for worker sandboxes)
      --sandbox                   Sandbox mode: disables Dolt auto-push
  -v, --verbose                   Enable verbose/debug output

```

---

## OpenSpec Commands (openspec)

### openspec --help

```
Usage: openspec [options] [command]

AI-native system for spec-driven development

Options:
  -V, --version                      output the version number
  --no-color                         Disable color output
  -h, --help                         display help for command

Commands:
  version [options]                  Report the installed OpenSpec version and
                                     update availability
  init [options] [path]              Initialize OpenSpec in your project
  update [options] [path]            Update OpenSpec instruction files
  list [options]                     List items (changes by default). Use
                                     --specs to list specs.
  view [options]                     Display an interactive dashboard of specs
                                     and changes
  change                             Manage OpenSpec change proposals
  archive [options] [change-name]    Archive a completed change and update main
                                     specs
  spec                               Manage and view OpenSpec specifications
  config [options]                   View and modify global OpenSpec
                                     configuration
  schema                             Manage workflow schemas [experimental]
  store                              Create and manage stores - standalone
                                     OpenSpec repos you register on this machine
  doctor [options]                   Report relationship health for the resolved
                                     OpenSpec root
  context [options]                  Print the working context for the resolved
                                     OpenSpec root
  workset [options]                  Compose, keep, and open personal working
                                     views (purely local)
  validate [options] [item-name]     Validate changes and specs
  show [options] [item-name]         Show a change or spec
  feedback [options] <message>       Submit feedback about OpenSpec
  completion                         Manage shell completions for OpenSpec CLI
  status [options]                   Display artifact completion status for a
                                     change
  instructions [options] [artifact]  Output enriched instructions for artifacts,
                                     apply, or archive
  templates [options]                Show resolved template paths for all
                                     artifacts in a schema
  schemas [options]                  List available workflow schemas with
                                     descriptions
  new                                Create new items
  help [command]                     display help for command

```

#### openspec init --help

```
Usage: openspec init [options] [path]

Initialize OpenSpec in your project

Options:
  --tools <tools>        Configure AI tools non-interactively. Use "all",
                         "none", or a comma-separated list of: amazon-q, amp,
                         antigravity, atomcode, auggie, bob, claude, cline,
                         command-code, codeartsagent, codex, dsh, devin,
                         forgecode, codebuddy, codestudio, continue, costrict,
                         crush, cursor, easycode, factory, gemini,
                         github-copilot, gigacode, grok, gsd, hermes, iflow,
                         junie, kilocode, kimi, kiro, lingma, minimax-code,
                         vibe, oh-my-pi, opencode, pi, codeassistant, qoder,
                         qwen, rovodev, roocode, trae, veai, warp, zed, zcode,
                         agents. Also accepted: windsurf (now devin)
  --language <language>  Write new OpenSpec artifacts in this language
  --force                Auto-cleanup legacy files without prompting
  --profile <profile>    Override global config profile (core or custom)
  --no-animation         Show a static welcome screen instead of the animated
                         one
  --copilot-cloud        Set up GitHub Copilot cloud coding-agent files without
                         prompting
  --no-copilot-cloud     Skip GitHub Copilot cloud coding-agent files without
                         prompting
  -h, --help             display help for command

```

#### openspec list --help

```
Usage: openspec list [options]

List items (changes by default). Use --specs to list specs.

Options:
  --specs         List specs instead of changes
  --changes       List changes explicitly (default)
  --archived      Show only archived changes
  --all           Show both active and archived changes
  --sort <order>  Sort order: "recent" (default) or "name" (default: "recent")
  --json          Output as JSON (for programmatic use)
  --store <id>    Store id to use as the OpenSpec root (a store is a standalone
                  OpenSpec repo you've registered)
  -h, --help      display help for command

```

#### openspec update --help

```
Usage: openspec update [options] [path]

Update OpenSpec instruction files

Options:
  --force     Force update even when tools are up to date
  -h, --help  display help for command

```

#### openspec version --help

```
Usage: openspec version [options]

Report the installed OpenSpec version and update availability

Options:
  --json      Output as JSON
  --check     Check the registry for a newer version
  -h, --help  display help for command

```

---

