# Feature work

Handle one request in the order research → plan → implement → review. When the review has comments, go back to implement.

## 1. Research [use a subagent]

For each target file, call [research](research.md) with {{>target}} and receive {{<findings}}.

## 2. Plan

Call [plan](plan.md) with {{>findings}} and receive {{<plan}}.

## 3. Implement

Call [implement](implement.md) with {{>plan}} and receive {{<changed-files}}.

## 4. Review [use a subagent]

Call [review](review.md) with {{>changed-files}} and receive {{<comments}}.

## 5. If there are comments

Call [implement](implement.md) with {{>comments}} and receive {{<changed-files}} again. Repeat until there are no comments.

## 6. Wrap up

Run [wrap-up](wrap-up.md).
