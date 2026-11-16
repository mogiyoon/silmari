# 파이프라인

## 개요
[p2](../J/P/p2.json) · [k3](../J/P/research/k3-{{>v1}}.local.md) · [k2](../J/P/research/k2.local.md)

[r1](../J/M/r1.md)

## {{>Inputs}}
- v2 (json)
- v1 (text)
- v3 (text)

## {{<Outputs}}
- v4
- v5

## 검색 조건
[r1](../J/M/r1.md)

[r6](../J/P/r6.md)

## 1. 수집 — 단위마다 ((sil run 으로 서브에이전트를 띄운다))
[d](ag/d.md) 를 {{>v2}} · {{>v3}} 로, {{<v9}}
{{+bash}} {{+read}} {{+write}} {{+webfetch}} {{#sonnet}}

## 2. 게이트와 1차 채점 — 배치마다 ((sil run 으로 서브에이전트를 띄운다))
[e](ag/e.md) 를 {{>v9}} · {{>v2}} · {{>v3}} 로, {{<v10}} · {{<v11}}
{{+read}} {{+write}} {{#sonnet}}

## 3. 2차 채점 — 배치마다 ((sil run 으로 서브에이전트를 띄운다))
[f](ag/f.md) 를 {{>v9}} · {{>v3}} 로, {{<v12}}
{{+read}} {{+write}} {{#sonnet}} {{#opus}}

## 4. 컷 — 오케스트레이터 직접
[보류](/{{>v3}}/deferred.json) 에 {{>v13}}

v2.research_min_fit 미만만 뺀다. null 이면 전량 넘긴다. 원본 결과는 덮어쓰지 않는다.

## 5. 외부 조사 — 10~15곳 배치마다 ((sil run 으로 서브에이전트를 띄운다))
[g](ag/g.md) 를 {{>v10}} · {{>v12}} · {{>v3}} 로, {{<v14}}
{{+websearch}} {{+webfetch}} {{+read}} {{+write}} {{#sonnet}}

## 6. 정규화 ((sil run 으로 서브에이전트를 띄운다))
[h](ag/h.md) 를 {{>v10}} · {{>v12}} · {{>v14}} · {{>v11}} · {{>v3}} · {{>v1}} 로, {{<v4}} · {{<v5}}
{{+read}} {{+write}} {{+bash}} {{#sonnet}}

## 7. 인계

## 8. 기준만 바뀌면 재채점 (개정당 1회) ((sil run 으로 서브에이전트를 띄운다))
[f](ag/f.md) 를 {{>v9}} · {{>v3}} 로, {{<v12}} → 4·5·6 재적용
{{+read}} {{+write}} {{#sonnet}}

`y1.md`

## 에러 처리
[r1](../J/M/r1.md)

`r6.md`
