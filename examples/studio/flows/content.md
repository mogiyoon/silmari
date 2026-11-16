# 콘텐츠 제작

조사 요약으로 초안을 쓰고, 편집하고, 검수가 통과할 때까지 고친다. [어조](../rules/tone.md) 를 따른다.

## {{>입력}}
- topic
- audience — 독자층

## {{<출력}}
- article

## 1. 조사
[시장 조사](research.md) 를 {{>topic}} 와 함께 부르고 {{<brief}} 를 받는다.

## 2. 초안 ((서브에이전트로, sil run))
[작가](../agents/content/writer.md) 를 {{>brief}} 와 {{>audience}} 와 함께 부르고 {{<draft}} 를 받는다. {{#큰 모델}} 에서 {{+읽기}} 와 {{+쓰기}} 를 쓴다.

## 3. 편집 ((서브에이전트로, sil run))
[편집자](../agents/content/editor.md) 를 {{>draft}} 와 함께 부르고 {{<edited}} 를 받는다. {{#중간 모델}} 에서 {{+읽기}} 만 쓴다.

## 4. 검수 ((서브에이전트로, sil run))
[검수자](../agents/shared/reviewer.md) 를 {{>edited}} 와 함께 부르고 {{<issues}} 를 받는다. {{#큰 모델}} 에서 {{+읽기}} 만 쓴다.

## 5. 지적이 있으면 (최대 3번)
[편집자](../agents/content/editor.md) 를 {{>edited}} 와 {{>issues}} 와 함께 다시 부르고 {{<article}} 를 받는다.

## 6. 저장
[원고](../out/articles/{{>topic}}.md) 에 {{>article}} 를 쓴다.
