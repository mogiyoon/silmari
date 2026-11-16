# 시장 조사

주제 하나를 네 관점에서 따로 조사하고 합친다. [문서 역할](../rules/roles.md) 을 따른다.

## {{>입력}}
- topic — 조사 주제

## {{<출력}}
- brief

## 1. 관점마다 조사 (병렬)
### 훅 ((서브에이전트로, sil run))
[훅 스카우트](../agents/research/scout-hook.md) 를 {{>topic}} 와 함께 부르고 {{<hooks}} 를 받는다. {{#빠른 모델}} 에서 {{+웹 검색}} 을 쓴다.

### 어조 ((서브에이전트로, sil run))
[어조 스카우트](../agents/research/scout-tone.md) 를 {{>topic}} 와 함께 부르고 {{<tones}} 를 받는다. {{#빠른 모델}} 에서 {{+웹 검색}} 을 쓴다.

### 시장 ((서브에이전트로, sil run))
[시장 스카우트](../agents/research/scout-market.md) 를 {{>topic}} 와 함께 부르고 {{<market}} 를 받는다. {{#빠른 모델}} 에서 {{+웹 검색}} 을 쓴다.

### 경쟁 ((서브에이전트로, sil run))
[경쟁 스카우트](../agents/research/scout-rival.md) 를 {{>topic}} 와 함께 부르고 {{<rivals}} 를 받는다. {{#빠른 모델}} 에서 {{+웹 검색}} 을 쓴다.

## 2. 합치기 ((서브에이전트로, sil run))
[종합가](../agents/research/synthesizer.md) 를 {{>hooks}} 와 {{>tones}} 와 {{>market}} 와 {{>rivals}} 와 함께 부르고 {{<brief}} 를 받는다. {{#큰 모델}} 에서 {{+읽기}} 만 쓴다.

## 3. 저장
[조사 요약](../out/research/{{>topic}}.md) 에 {{>brief}} 를 쓴다.
