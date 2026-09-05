# silmari

**Checks the flow and data in md documents and shows them as a graph.**
Agent md files are the source, silmari is the compiler, and AI is the runtime. It is like `tsc`.

```
sil lint    catches missing files, missing anchors, data without a link, references nobody calls   ← compiler
sil view    calls, send/receive, conditions and subagents between documents on one screen        ← graph
```

The VS Code extension marks the same checks with wavy lines as you edit. It opens the graph beside the editor.

## Notation: four things to learn

A standard Markdown link is an edge. Add values after the link with `{{ }}`.

```markdown
# 기능 개발

## 1. 조사 [서브 에이전트 사용]
대상파일마다 [조사](조사.md)에 {{>대상파일}}을 전달해 {{<조사결과}}를 받는다.

## 2. 계획
[계획](계획.md)에 {{>조사결과}}를 전달해 {{<계획}}을 받는다.

## 3. 지적이 있으면
[구현](구현.md)에 {{>지적사항}}을 전달해 {{<변경파일}}을 다시 받는다.
```

| Notation | Meaning | For the model |
|---|---|---|
| `[조사](조사.md)` | Edge. Caller → callee | "Read that file" |
| `{{>계획}}` | Send (parameter) | "Pass this value" |
| `{{<변경파일}}` | Receive (return) | "Keep this value" |
| `## … [서브 에이전트 사용]` | Calls in that section are isolated. The brackets are the symbol. The text inside can be in any language. In English, use the verb phrase `[use a subagent]` | "Use a subagent" |

Sequence follows line order. A heading (`## 지적이 있으면`) marks a choice. Show repetition by calling again under a condition ("until") or with "each." The only symbols are `>` and `<`.
In the called file, the lists under `## 받는 것` / `## 하는 일` / `## 내는 것` are the contract. There is no frontmatter.

**An md file without notation is not an error.** Adopt it one file at a time. [packages/core/test/fixtures/after](packages/core/test/fixtures/after) is a small complete example in this notation (it doubles as the golden test corpus).

## Usage

```sh
sil lint            # check the md files in the current folder. --strict exits with code 1 on error
sil view            # local server + browser. Edit ✎ changes prompt bodies heading by heading; Raw ✎ edits the whole file. Both write through the hash-checked writer
sil view --out=g.html   # one HTML file, no server
sil init            # .sil/config.yaml + SILMARI.md (entry point with a notation summary). Creates the missing agent start files (CLAUDE.md · AGENTS.md · GEMINI.md · copilot-instructions) and appends a SILMARI.md call to existing ones. Generated text is English; the user's language (--lang, else the locale) is recorded and agents write in it
```

VS Code: Install the `silmari` extension to see wavy lines while editing md files. Open the graph with **silmari: Show graph** in the command palette. It does not change the user's `settings.json`.

## What it never does

- It does not call a model. Prompts go to the model exactly as written. There is no assembler.
- It does not summarize, rewrite, or normalize the text. It does not delete files.
- It does not create files in other repositories (`sil init` only creates an optional `.sil/config.yaml`).

## Development

```sh
pnpm install
pnpm build          # viewer → cli → vscode 순으로 묶는다
pnpm test           # 골든 코퍼스(packages/core/test/fixtures/after) + 규칙 단위 테스트
pnpm --filter silmari-vscode package   # packages/vscode/dist/silmari.vsix
```

```
packages/core      파서 · IR · 린트. 순수 함수, IO 없음. 참조 구현
packages/cli       sil — init · lint · view
packages/viewer    React Flow + dagre. vite 가 단일 HTML 로
packages/vscode    확장 — Diagnostic · 그래프 웹뷰 · configurationDefaults
tools/stress.mjs   부하 테스트용 코퍼스 생성기 — node tools/stress.mjs <out> [flows] [depth] [fanout]
```

## License

MIT
