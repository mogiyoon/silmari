# 트랙 B

## {{>Inputs}}
- w1 (text)
- w3 (text)
- w8 (text)
- w7 (text)
- w9 (text)
- w4 (json)
- w6 (text)

## {{<Outputs}}
- w11 — {preset, rationale, score, status(ready|blocked|reselect), fixes, project_revision}

## 1. 조립 ((sil run 으로 서브에이전트를 띄운다))
[o](ag/o.md) 를 {{>w1}} · {{>w3}} · {{>w8}} · {{>w7}} · {{>w9}} · {{>w6}} 로, {{<w13}} · {{<w14}}
{{+read}} {{+write}} {{#sonnet}}

## 2. 구조 검사 ((sil run 으로 서브에이전트를 띄운다))
[p](ag/p.md) 를 {{>w1}} · {{>w13}} 로, {{<w15}}
{{+read}} {{+bash}} {{#haiku}}

`python M/s3.py {slug} --portfolio-only`

1→2 는 최대 2회 다시 한다. 3회 연속 실패면 blocked.

## 3. 평가가 필요한 경우 ((sil run 으로 서브에이전트를 띄운다))
[r](ag/r.md) 를 {{>w1}} · {{>w13}} · {{>w8}} · {{>w7}} · {{>w9}} · {{>w15}} 로, {{<w16}} · {{<w6}}
{{+read}} {{+write}} {{#opus}} {{-프로젝트 규칙 없이}}

w4=false 면 건너뛴다.

## 4. 결과 확정
`{w3}/iter-{n}.portfolio.preset.json` · `iter-{n}.portfolio.eval.json`

project fix 가 있으면 reselect. 85 미만이면 1→2→3 을 최대 3회. 85 이상·점수 하락·상한 중 하나면 끝낸다. 통과 후보 중 최고점을 채택한다.
