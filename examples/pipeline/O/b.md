# 흐름 1

## 트리거

## {{>Inputs}}
- v1 (text)
- v2 (json) — 조건. `P/p1.json`
- v3 (text)

## {{<Outputs}}
- v4 — `p2.json`
- v5
- v6 — `p1.json` 에 기록

## 0. 사전 점검

| 항목 | 확인 | 없으면 |
|---|---|---|
| 파이썬 | `python --version` | 설치 |
| 퍼피티어 | `node -e "require.resolve('puppeteer')"` | 설치 |
| 이력 원본 | `/f10.md` · `/f11.jpg` | 멈춤 |
| 작업 폴더 | `P/` | 만든다 |

## {{=1. 킷 준비}}
[s1.py](../J/M/s1.py)

```sh
python M/s1.py
```

[f1](../D/f1.json) · [f2](../D/f2.json) · [f3](../L/f3.json) · [f4](../J/M/f4.json)

```sh
node -e "const a = require('./M/f4.json'); const b = require('./D/f5.json'); /* 드리프트 검사 */"
```

[k1](../J/P/k1.md) 에 {{>kit}}

## 2. 조건 확정
[p1](../J/P/p1.json) 에 {{>searchprefs}}

```json
{ "cycle": "", "roles": [], "salary_floor_avg": 0, "remote": "", "company_stage": [], "score_cut": null, "eval_cut": 35, "research_min_fit": null, "notes": "" }
```

## 3. 수집·채점
[c](c.md) 를 {{>v2}} · {{>v1}} · {{>v3}} 로 호출하고 {{<v4}} · {{<v5}} 를 받는다.

이 단계 제목에는 (( )) 가 없다.

## G. 사람 게이트 — 여기서 종료
[r2](../J/M/r2.md)

통과 3건 미만이면 되묻는다. 25건 초과면 경고한다. 동점은 전부 포함한다. 숨긴 항목은 뺀다.

v6 과 eval_cut(기본 35)을 기록한다.

## 중단과 재개

| 상태 | 재개 |
|---|---|
| k1 없음 | 1 |
| p1 없음 | 2 |
| p2 없음 | 3 |
| score_cut null | G |
| 모두 있음 | 완료 |
