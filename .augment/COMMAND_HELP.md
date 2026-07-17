# Command Help Reference

Auto-generated command-line help for Augment workflow tools.

**Generated**: 2026-06-26T20:03:00.951Z
**Tools**: Augx
**Version**: 1.0.0

---

## Augx Commands (augx)

### augx --help

```
Usage: augx [options] [command]

CLI tool for managing Augment Code AI extension modules

Options:
  -V, --version                        output the version number
  -h, --help                           display help for command

Commands:
  init [options]                       Initialize Augment Extensions in current
                                       project (includes Beads integration if
                                       .beads/ exists)
  gui                                  Launch interactive GUI for module
                                       management
  list [options]                       List available or linked extension
                                       modules
  show [options] <module> [file-path]  Display detailed information about a
                                       module (use "completed" to show Beads
                                       completed tasks, "linked" for linked
                                       modules, "all" for all modules)
  use [options] <module>               Select and load a specific module
                                       version
  upgrade [options] <module>           Upgrade module to latest version
  version-info [options] <module>      Show detailed version information
  link [options] <module>              Link an extension module to current
                                       project
  unlink [options] <module>            Unlink an extension module or collection
                                       from current project
  update [options]                     Update CLI and/or linked modules to
                                       latest versions
  search [options] <keyword>           Search for extension modules
  create [options] <name>              Create a new extension module
  validate [options] <module>          Validate module structure and metadata
  pin <module> <version>               Pin module to specific version
  check-updates                        Check for available module updates
  self-remove [options]                Completely remove all Augment Extensions
                                       from the project
  diff <module>                        Show differences between current and
                                       latest version
  catalog [options]                    Update MODULES.md catalog with all
                                       available modules
  catalog-hook [options]               Setup git hook for automatic catalog
                                       updates
  install-rules [options]              Install character count management rule
                                       to .augment/rules
  coord                                Query coordination manifest data
  sync                                 Sync Beads and OpenSpec with
                                       coordination manifest
  migrate                              Migrate existing Beads and OpenSpec data
                                       to coordination system
  skill                                Manage skills
  mcp                                  Manage MCP server integrations
  code-analysis|analyze [options]      Analyze code for quality, complexity,
                                       security, and dependencies
  help [command]                       display help for command

```

#### augx init --help

```
Usage: augx init [options] [command]

Initialize Augment Extensions in current project (includes Beads integration if
.beads/ exists)

Options:
  --from-submodule  Initialize from existing submodule
  -h, --help        display help for command

Commands:
  beads             Initialize Beads task tracking in current project

```

##### augx init beads --help

```
Usage: augx init beads [options]

Initialize Beads task tracking in current project

Options:
  -h, --help  display help for command

```

#### augx project --help

```
Usage: augx [options] [command]

CLI tool for managing Augment Code AI extension modules

Options:
  -V, --version                        output the version number
  -h, --help                           display help for command

Commands:
  init [options]                       Initialize Augment Extensions in current
                                       project (includes Beads integration if
                                       .beads/ exists)
  gui                                  Launch interactive GUI for module
                                       management
  list [options]                       List available or linked extension
                                       modules
  show [options] <module> [file-path]  Display detailed information about a
                                       module (use "completed" to show Beads
                                       completed tasks, "linked" for linked
                                       modules, "all" for all modules)
  use [options] <module>               Select and load a specific module
                                       version
  upgrade [options] <module>           Upgrade module to latest version
  version-info [options] <module>      Show detailed version information
  link [options] <module>              Link an extension module to current
                                       project
  unlink [options] <module>            Unlink an extension module or collection
                                       from current project
  update [options]                     Update CLI and/or linked modules to
                                       latest versions
  search [options] <keyword>           Search for extension modules
  create [options] <name>              Create a new extension module
  validate [options] <module>          Validate module structure and metadata
  pin <module> <version>               Pin module to specific version
  check-updates                        Check for available module updates
  self-remove [options]                Completely remove all Augment Extensions
                                       from the project
  diff <module>                        Show differences between current and
                                       latest version
  catalog [options]                    Update MODULES.md catalog with all
                                       available modules
  catalog-hook [options]               Setup git hook for automatic catalog
                                       updates
  install-rules [options]              Install character count management rule
                                       to .augment/rules
  coord                                Query coordination manifest data
  sync                                 Sync Beads and OpenSpec with
                                       coordination manifest
  migrate                              Migrate existing Beads and OpenSpec data
                                       to coordination system
  skill                                Manage skills
  mcp                                  Manage MCP server integrations
  code-analysis|analyze [options]      Analyze code for quality, complexity,
                                       security, and dependencies
  help [command]                       display help for command

```

##### augx project init --help

```
Usage: augx [options] [command]

CLI tool for managing Augment Code AI extension modules

Options:
  -V, --version                        output the version number
  -h, --help                           display help for command

Commands:
  init [options]                       Initialize Augment Extensions in current
                                       project (includes Beads integration if
                                       .beads/ exists)
  gui                                  Launch interactive GUI for module
                                       management
  list [options]                       List available or linked extension
                                       modules
  show [options] <module> [file-path]  Display detailed information about a
                                       module (use "completed" to show Beads
                                       completed tasks, "linked" for linked
                                       modules, "all" for all modules)
  use [options] <module>               Select and load a specific module
                                       version
  upgrade [options] <module>           Upgrade module to latest version
  version-info [options] <module>      Show detailed version information
  link [options] <module>              Link an extension module to current
                                       project
  unlink [options] <module>            Unlink an extension module or collection
                                       from current project
  update [options]                     Update CLI and/or linked modules to
                                       latest versions
  search [options] <keyword>           Search for extension modules
  create [options] <name>              Create a new extension module
  validate [options] <module>          Validate module structure and metadata
  pin <module> <version>               Pin module to specific version
  check-updates                        Check for available module updates
  self-remove [options]                Completely remove all Augment Extensions
                                       from the project
  diff <module>                        Show differences between current and
                                       latest version
  catalog [options]                    Update MODULES.md catalog with all
                                       available modules
  catalog-hook [options]               Setup git hook for automatic catalog
                                       updates
  install-rules [options]              Install character count management rule
                                       to .augment/rules
  coord                                Query coordination manifest data
  sync                                 Sync Beads and OpenSpec with
                                       coordination manifest
  migrate                              Migrate existing Beads and OpenSpec data
                                       to coordination system
  skill                                Manage skills
  mcp                                  Manage MCP server integrations
  code-analysis|analyze [options]      Analyze code for quality, complexity,
                                       security, and dependencies
  help [command]                       display help for command

```

##### augx project project --help

```
Usage: augx [options] [command]

CLI tool for managing Augment Code AI extension modules

Options:
  -V, --version                        output the version number
  -h, --help                           display help for command

Commands:
  init [options]                       Initialize Augment Extensions in current
                                       project (includes Beads integration if
                                       .beads/ exists)
  gui                                  Launch interactive GUI for module
                                       management
  list [options]                       List available or linked extension
                                       modules
  show [options] <module> [file-path]  Display detailed information about a
                                       module (use "completed" to show Beads
                                       completed tasks, "linked" for linked
                                       modules, "all" for all modules)
  use [options] <module>               Select and load a specific module
                                       version
  upgrade [options] <module>           Upgrade module to latest version
  version-info [options] <module>      Show detailed version information
  link [options] <module>              Link an extension module to current
                                       project
  unlink [options] <module>            Unlink an extension module or collection
                                       from current project
  update [options]                     Update CLI and/or linked modules to
                                       latest versions
  search [options] <keyword>           Search for extension modules
  create [options] <name>              Create a new extension module
  validate [options] <module>          Validate module structure and metadata
  pin <module> <version>               Pin module to specific version
  check-updates                        Check for available module updates
  self-remove [options]                Completely remove all Augment Extensions
                                       from the project
  diff <module>                        Show differences between current and
                                       latest version
  catalog [options]                    Update MODULES.md catalog with all
                                       available modules
  catalog-hook [options]               Setup git hook for automatic catalog
                                       updates
  install-rules [options]              Install character count management rule
                                       to .augment/rules
  coord                                Query coordination manifest data
  sync                                 Sync Beads and OpenSpec with
                                       coordination manifest
  migrate                              Migrate existing Beads and OpenSpec data
                                       to coordination system
  skill                                Manage skills
  mcp                                  Manage MCP server integrations
  code-analysis|analyze [options]      Analyze code for quality, complexity,
                                       security, and dependencies
  help [command]                       display help for command

```

---

