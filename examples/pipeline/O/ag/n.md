# 조립자 A

[r4](../../J/M/r4.md) · [r3](../../J/M/r3.md)

## {{>Inputs}}
- w1 (text)
- w3 (text)
- w8 (text) — `y2.json`
- w7 (text) — `y1.md`
- w9 (text) — `y3.json`
- w6 (text)
- errors (text)

## {{<Outputs}}
- w13
- w14 — [runs](../../J/P/runs/) 의 `{w3}/y4.md`

## 읽는 순서
[k1](../../J/P/k1.md)

[s1](../../J/M/s1.py)

[분석](../../J/P/runs/) 을 {{<w8}}

[선정](../../J/P/runs/) 을 {{<w9}}

## 설계상 중요한 규칙

## 산출
[프리셋](../../J/P/presets/{{>w1}}.json) 에 {{>w13}}

[runs](../../J/P/runs/) 에 {{>w14}}

## 원칙
`P/p5.json` · `D/**` · `L/**`
