---
type: "always_apply"
---

# No Em-Dash in AI Output

## Rule

**Never use the em-dash character (—) in any generated text, code, comments, or documentation.**

Use a regular hyphen-minus (-) or double-hyphen (--) instead.

## Rationale

Em-dashes cause copy-paste and encoding issues in terminals, config files, and cross-platform tooling. Plain ASCII punctuation is always safe and unambiguous.

## Examples

| Instead of | Use |
|---|---|
| `foo — bar` | `foo - bar` or `foo -- bar` |
| `critical — warn immediately` | `critical - warn immediately` |

## Scope

This rule applies to **all** AI-generated output in this project:
- Code comments
- Markdown documentation
- Console/log messages
- Commit messages
- Any other text
