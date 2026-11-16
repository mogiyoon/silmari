# 검증·출력

## {{>Inputs}}
- w1 (text)
- w3 (text)
- w9 (text)
- w5 (json)
- w4 (json)
- w10 (json)
- w11 (json)

## {{<Outputs}}
- w12 — {status(ready|repair|blocked), pdfs, checks, report}
- w6

## 검사 기준
[r3](../J/M/r3.md)

입력 트랙이 모두 ready 이고 y3 해시가 일치할 때만 진행한다.

## 1. 최종 기계 검사

| 검사 | 명령 |
|---|---|
| 정합 | `s3 {slug}` |
| 구조 | `s2 {slug}` |
| 포트폴리오 정합 | `s3 {slug} --portfolio-only` |

[s2](../J/M/s2.py) · [s3](../J/M/s3.py)

오류가 있으면 repair 를 돌려준다. w4=false 면 여기서 끝낸다.

## 2. 인쇄 준비
`/f10.md` · `/f11.jpg` · 포트 5173 · 환경변수 `MOGIYOON_BASE`

[s11](../J/P/scripts/s11.mjs) — 여유 30px

## {{=A 가 대상이면 인쇄}}
[s4](../J/P/scripts/s4.mjs) → `J/out-a/`

```sh
node P/scripts/s4.mjs <slug>
```

## {{=B 가 대상이면 인쇄}}
[s5](../J/P/scripts/s5.mjs) → `J/out-b/`

```sh
node P/scripts/s5.mjs <slug>
```

## {{=3. 인쇄본 검사}}
[s6](../J/M/s6.py)

```sh
python M/s6.py <slug>
python M/s6.py --pdf <경로>
```

쪽수 ≤ page_target, 297×210mm, 5MB 이하.

## 4. 반환
`{w3}/run.md`
