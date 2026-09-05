# Implement

Take the plan or the comments and change the code. The only task in this flow that writes source.

## Inputs
- plan
- comments

## Steps

Work through the items in the order given. Verify after each item and report it in one line.
Follow the [coding rules](coding-rules.md). If a change outside the plan is needed, write the reason before doing it.
When everything is done, call [review](review.md) with {{>changed-files}} and receive {{<comments}}; if there are comments, apply them.

## Outputs
- changed-files — one line per changed file: path and what changed
- comments — what the review left at the end. "pass" when there is nothing
