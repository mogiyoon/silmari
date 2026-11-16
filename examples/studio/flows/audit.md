# 품질 감사

다른 흐름의 산출물을 다시 본다. 채용 결정과 원고를 표본으로 뽑는다.

## {{>입력}}
- sample — 감사할 표본 수

## {{<출력}}
- findings

## 1. 표본 뽑기 ((서브에이전트로, sil run))
[표본 추출기](../agents/audit/sampler.md) 를 {{>sample}} 와 함께 부르고 {{<items}} 를 받는다. {{#빠른 모델}} 에서 {{+읽기}} 만 쓴다.

## 2. 원고 검수 ((서브에이전트로, sil run))
[검수자](../agents/shared/reviewer.md) 를 {{>items}} 와 함께 부르고 {{<issues}} 를 받는다. {{#큰 모델}} {{#중간 모델}} 에서 {{+읽기}} 만 쓴다.

## 3. 채용 판정 재검 ((서브에이전트로, sil run))
[이력서 심사관](../agents/hiring/resume-screener.md) 를 {{>items}} 와 함께 부르고 {{<verdict}} 를 받는다. {{#큰 모델}} 에서 {{+읽기}} 만 쓴다.

## 4. 보고 ((서브에이전트로, sil run))
[감사 보고자](../agents/audit/reporter.md) 를 {{>issues}} 와 {{>verdict}} 와 함께 부르고 {{<findings}} 를 받는다. {{#중간 모델}} 에서 {{+읽기}} 만 쓴다.

지적 목록은 `out/audit/selected.json` 에 모아 둔다.
