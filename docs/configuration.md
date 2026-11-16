# Project setup and configuration

[← README](../README.md)

## Configuration

`sil init` creates `.sil/config.yaml`. Every key is optional.

```yaml
entry: [SILMARI.md]    # entry documents: the graph starts here
lang: en              # the language your agent writes in
scan:
  exclude: [drafts/]  # gitignore patterns
run:
  keep_session: true  # keep the runtime's resumable session copy
```

`.gitignore` is respected. sil also excludes `.git`, `node_modules`, `.sil` and `.claude/worktrees` from scanning.

`SILMARI.md` contains the notation summary and links to flow documents. Add generated run records and personal viewer state to `.gitignore`:

```gitignore
.sil/run/
.sil/layout.json
```

## Initialize a project

`sil init` creates the entry document and adds a line in supported agent start files pointing to it. Missing start files are created.

Choose your language with `sil init --lang=ko`; otherwise sil uses the environment or system locale. Generated SILMARI.md guidance is English, and asks the agent to write documents and replies in your language. The symbols do not depend on a word list.

## Upgrade guidance

After installing a new version, run `sil update` in each project. It backs up Markdown files, refreshes the generated Notation, Running a call and Subagents sections, and keeps your Flow section and custom sections.

When notation has changed, sil writes versioned notes to `.sil/updates/` and points to them from the agent start files. At the next session, the agent explains the changes and asks whether to apply them. It takes another backup before editing, then removes completed notes and their prompt line.

Lint reports L-I06 for older project guidance and L-I07 for pending update notes. VS Code shows the same diagnostics.

## Migrate existing agent documents

When Markdown files already exist, `sil init` backs them up and prepares `.sil/migration.md`. At the next session, your agent asks whether to start the migration. The agent then:

1. Runs `sil backup` before editing and tells you where the backup is.
2. Gives each worker its own file, with input/output contracts inside it.
3. Writes calls, values, tools and models in the orchestrator's call paragraphs. Rules and other needed files travel through links.
4. Preserves prose, diagrams and examples, while making the calls readable by lint.
5. Runs `sil lint` until error 0, then removes the migration guide and prompt line.

`sil migrate` prepares the guide and prompt again if you want to migrate later. The [demo corpus](../packages/core/test/fixtures/after) shows a complete migrated flow.
