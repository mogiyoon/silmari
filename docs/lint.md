# Lint reference

[← README](../README.md)

```sh
sil lint           # report findings
sil lint --strict  # exit 1 when there is an error
sil lint --json    # print the graph and diagnostics as JSON
```

Here is what `sil lint` prints for the [demo corpus](../packages/core/test/fixtures/after):

```
✖ review.md:10   L-N01  Linked file not found: review-criteria.md
✖ wrap-up.md:11  L-N09  Anchor not found in the target document: structure.md#rollback
· flow.md        L-N23  A sent value is neither received from a call nor declared in this document's contract: target
· flow.md:19     L-N25  Subagent call names no {{+tools}} or {{#model}}; it runs with whatever the caller passes

error 2 · warning 0 · info 2
files 8 · task 6 · doc 2 · file 0 · ghost 1 · call 7 · read 0 · write 0 · ref 5 · mention 2
```

The last line is the count of what was read. A migration that changed nothing is visible there even when there is no error.

## Diagnostic codes

| Code | Level | Meaning |
|---|---|---|
| L-N01 | error | Linked file does not exist |
| L-N09 | error | Anchor does not exist in the target document |
| L-N03 | error | Reference-style link has no definition |
| L-N04 | error | Invalid value name in `{{ }}` |
| L-N13 | error | `{{ }}` has no preceding link to attach to |
| L-N16 | error | The same name is received twice under one condition |
| L-C01 | warning | Sends values not listed in the callee's inputs |
| L-C02 | warning | Receives values not listed in the callee's outputs |
| L-N14 | warning | Data is attached to a reference document, which has no contract |
| L-G01 | warning | Reference document that nobody links to. It may need cleanup, but is never deleted |
| L-G06 | warning | A document is called again without a condition, so there is no way out |
| L-N15 | warning | `{{*x}}` is retired notation; write `{{>x}}` and say "for each" in words |
| L-N17 | info | A received value is never used |
| L-N05 | info | A link inside a heading is not an edge |
| L-N06 | info | The file has no H1 or more than one, so its file name is used as the title |
| L-I05 | info | Heading label uses `[…]`: write `((…))`, because Markdown reads `[ ]` as a reference link |
| L-I04 | info | `[@…]` appears in a heading label: drop the `@`, because models read it as a mention |
| L-N18 | warning | Empty marker: `{{>}}`, `{{+}}`, `(())` — nothing can be read from it |
| L-N20 | warning | A heading starts with a contract marker but contains more text, so it is not a contract heading |
| L-N21 | warning | Unbalanced parentheses at the end of a heading: a label must be `((…))` |
| L-N26 | warning | `{{+…}}` / `{{#…}}` / `{{-…}}` / `{{!…}}` on a call outside a subagent step have no effect |
| L-N19 | info | A contract heading is used as H1 |
| L-N22 | info | The file is called with values but declares no contract, so the names cannot be checked |
| L-N23 | info | A sent value is neither received from a call nor declared in the document's contract |
| L-N24 | info | Different callers call one file with different tool sets |
| L-N25 | info | A subagent call names no `{{+tools}}` or `{{#model}}` |
| L-I06 | info | SILMARI.md was written by an older silmari than the one installed: run `sil update` |
| L-I07 | info | Update notes in `.sil/updates/` have not been applied yet |
| L-N28 | error | No file matches a template link such as `[x](refs/{{>topic}}.md)` |
| L-N29 | warning | A value inside a link target is neither an input of the document nor received from a call |
| L-N30 | warning | A link points outside the project root, where a subagent cannot reach it |
| L-N31 | warning | A `{{=…}}` execution section has no target link |
| L-N32 | error | `{{!…}}` is attached to a file or reference instead of a subagent call |
| L-N33 | error | Malformed `{{!…}}` approval marker |

Rules that require a contract or call run only on documents that contain one. Plain Markdown stays quiet. The last line of `sil lint` always shows the type counts (`task 6 · call 7 …`). This makes a migration that changed nothing visible, even at error 0.
