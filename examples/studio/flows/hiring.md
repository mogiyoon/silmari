# 채용 파이프라인

지원서 하나를 받아 트랙에 맞는 심사관에게 보내고, 점수를 매겨 결정한다. [문서 역할](../rules/roles.md) 을 따른다.

## {{>입력}}
- posting (path) — 공고 파일
- application (path) — 지원서 파일
- track — resume 또는 portfolio
- slug — 지원자 식별자

## {{<출력}}
- decision

## 1. 공고 분석 ((서브에이전트로, sil run)) {#posting}
[공고 분석가](../agents/hiring/posting-analyst.md) 를 {{>posting}} 와 함께 부르고 {{<criteria}} 를 받는다. {{#빠른 모델}} 에서 {{+읽기}} 만 쓴다.

## 2. 서류 정리 ((서브에이전트로, sil run))
[서류 정리기](../agents/hiring/intake.md) 를 {{>application}} 와 {{>slug}} 와 함께 부르고 {{<profile}} 를 받는다. {{#빠른 모델}} 에서 {{+읽기}} 와 {{+쓰기}} 를 쓴다.

## 3. 조립 ((서브에이전트로, sil run)) {#assemble}
[조립자](../agents/hiring/{{>track}}-composer.md) 를 {{>profile}} 와 {{>criteria}} 와 함께 부르고 {{<draft}} 를 받는다. {{#중간 모델}} 에서 {{+읽기}} 만 쓴다.

## 4. 심사
### 이력서면 ((서브에이전트로, sil run))
[이력서 심사관](../agents/hiring/resume-screener.md) 를 {{>draft}} 와 {{>criteria}} 와 함께 부르고 {{<verdict}} 를 받는다. {{#큰 모델}} 에서 {{+읽기}} 만 쓴다.

### 포트폴리오면 ((서브에이전트로, sil run))
[포트폴리오 심사관](../agents/hiring/portfolio-screener.md) 를 {{>draft}} 와 {{>criteria}} 와 함께 부르고 {{<verdict}} 를 받는다. {{#큰 모델}} 에서 {{+읽기}} 만 쓴다.

## 5. 심사 결과가 불충분하면 (최대 2번)
[조립자](../agents/hiring/{{>track}}-composer.md) 를 {{>profile}} 와 {{>criteria}} 와 {{>verdict}} 와 함께 다시 부르고 {{<draft}} 를 받는다.

## {{=점수 계산}}
[점수 스크립트](../scripts/score.mjs) 가 [판정](../out/{{>slug}}/verdict.json) 에 {{>verdict}} 를 쓰고 [점수](../out/{{>slug}}/score.json) 로 {{<score}} 를 불러온다.

```sh
node scripts/score.mjs out/<slug>/verdict.json > out/<slug>/score.json
```

## 7. 결정 ((서브에이전트로, sil run))
[결정자](../agents/hiring/decider.md) 를 {{>score}} 와 {{>verdict}} 와 함께 부르고 {{<decision}} 를 받는다. {{#큰 모델}} 에서 {{+읽기}} 만 쓴다.

## 8. 기록
[결정 기록](../out/decisions.jsonl) 에 {{>decision}} 를 남긴다.
