# 배포

검사를 통과한 원고만 내보낸다.

## {{>입력}}
- topic

## 1. 검사
[배포 검사](release-check.md) 를 {{>topic}} 와 함께 부르고 {{<report}} 를 받는다.

## 2. 내보내기 ((서브에이전트로, sil run))
[내보내기 담당](../agents/release/publisher.md) 를 {{>topic}} 와 {{>report}} 와 함께 부르고 {{<url}} 를 받는다. {{#빠른 모델}} 에서 {{+읽기}} 와 {{+셸}} 을 쓴다.

## 3. 기록
[배포 기록](../out/releases.jsonl) 에 {{>url}} 를 남긴다.
