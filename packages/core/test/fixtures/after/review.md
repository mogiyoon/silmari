# Review

Read the changed files and find problems.

## {{>Inputs}}
- changed-files

## Steps

Read the changed files and check them against the [coding rules](coding-rules.md) and the [review criteria](review-criteria.md). When there is nothing to say, write only "pass".

## If the comments are serious (at most 2 times)

Call [implement](implement.md) with {{>comments}} to get them fixed. Implement calls review again, so the documents form a cycle — the viewer marks this edge as one.

## {{<Outputs}}
- comments — `file:line` / what is wrong / how to fix it

## Seeded problem

`review-criteria.md` does not exist. `L-N01` catches it and it stays as a ghost node.
