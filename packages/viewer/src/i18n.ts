// UI strings. English by default; Korean when the browser (or the host) says so. The rail button switches and remembers.
import { createContext, useContext } from 'react'

export type Lang = 'en' | 'ko'

const en = {
  kind: { task: 'Task', doc: 'Reference', ghost: 'Missing' } as Record<'task' | 'doc' | 'ghost', string>,
  missingFile: 'missing file',
  entry: 'entry', entryTitle: 'Entry point (entry in .sil/config.yaml)',
  collapse: 'Collapse', expandTitle: 'Expand — see the headings and calls inside the node',
  subagent: 'subagent', calls: (n: number) => `calls ${n}`,
  dragToMove: 'Drag to move', target: (to: string) => `Target: ${to}`, headingOfCall: 'The heading that contains this call',
  tagSend: 'send', tagReceive: 'receive',
  someFailed: 'Some failed — ', saved: 'Saved ', failed: 'failed',
  irError: (e: string) => `Could not load the IR: ${e}`,
  loading: { server: 'Reading the documents …', download: 'Receiving the graph …', parse: 'Building the graph …' } as Record<'server' | 'download' | 'parse', string>,
  elapsed: (s: number) => `${s} s`, laying: 'Laying out …',
  resetTitle: 'Forget dragged node and label positions and lay out automatically', reset: 'Reset layout',
  closeSide: 'Close the side panel', openSide: 'Open the side panel',
  langSwitch: '한', langSwitchTitle: '한국어로 보기',
  collapseAll: 'Fold every subtree below the first level', expandAll: 'Unfold every subtree', unfoldOne: 'Show the children', unfoldDeep: 'Show everything below', foldOne: 'Hide everything below',
  orderFlow: '☰', orderChildren: '⌥', orderTitle: (m: 'flow' | 'children'): string => (m === 'flow' ? 'Label order: parent flow (line order). Click for child order' : 'Label order: next to each child. Click for parent flow order'),
  disconnected: 'disconnected', snapshot: 'snapshot',
  stats: (s: { files: number; nodes: number; edges: number; diagnostics: number }) => `files ${s.files} · nodes ${s.nodes} · edges ${s.edges} · diagnostics ${s.diagnostics}`,
  flows: 'Flows', viewMap: 'Overview map', viewGrid: 'Draw everything', loose: 'unlinked files', cellStats: (files: number, diags: number) => `${files} files · ${diags} diagnostics`,
  kinds: 'Kinds', selectedNode: 'Selected node', clickHint: 'Click a node. Double-click to expand it', diagnostics: 'Diagnostics', shownOf: (n: number, total: number): string => `${n} of ${total}`, none: 'none',
  legendCall: 'call (values)', legendRef: 'reference', legendMissing: 'missing target',
  legendTask: 'task', legendDoc: 'reference', legendGhost: 'missing', legendSubagent: 'subagent call (isolated)',
  send: 'send', receive: 'receive',
  collapseBtn: 'Collapse ▴', expandBtn: 'Expand ▾', editTitle: 'Stage 1: open every prompt body below for editing', edit: 'Edit ✎', rawEdit: 'Raw ✎', rawTitle: 'Stage 2: edit the whole file as text — headings, subagent marks, links', cancel: 'Cancel', save: 'Save',
  summary: (n: number) => `agent · contract · edges ${n}`, registeredAgent: 'Registered agent', inputs: 'Inputs', outputs: 'Outputs', out: 'Out', in: 'In',
  prompt: 'Prompt', thisSectionOnly: '— this section only', promptOf: '└ prompt ', empty: '(empty)',
}
export type Dict = typeof en

const ko: Dict = {
  kind: { task: '작업', doc: '자료', ghost: '없는 것' },
  missingFile: '없는 파일',
  entry: '진입', entryTitle: '진입점 (.sil/config.yaml 의 entry)',
  collapse: '접기', expandTitle: '펼치기 — 헤딩과 호출을 노드 안에서 본다',
  subagent: '서브 에이전트', calls: (n) => `호출 ${n}`,
  dragToMove: '끌어서 옮길 수 있다', target: (to) => `대상: ${to}`, headingOfCall: '이 호출이 있는 헤딩',
  tagSend: '보냄', tagReceive: '받음',
  someFailed: '일부 실패 — ', saved: '저장 ', failed: '실패',
  irError: (e) => `IR 을 못 받았다: ${e}`,
  loading: { server: '문서를 읽는 중 …', download: '그래프를 받는 중 …', parse: '그래프를 만드는 중 …' },
  elapsed: (s) => `${s}초`, laying: '배치 계산 중 …',
  resetTitle: '끌어 놓은 노드·라벨 위치를 지우고 자동 배치로', reset: '배치 초기화',
  closeSide: '오른쪽 창 닫기', openSide: '오른쪽 창 열기',
  langSwitch: 'EN', langSwitchTitle: 'View in English',
  collapseAll: '첫 단계 아래 가지를 전부 접는다', expandAll: '접은 가지를 전부 편다', unfoldOne: '자식만 펼친다', unfoldDeep: '아래를 전부 펼친다', foldOne: '아래를 전부 접는다',
  orderFlow: '☰', orderChildren: '⌥', orderTitle: (m) => (m === 'flow' ? '라벨 순서: 부모 흐름(줄 순서). 누르면 자식 순서로' : '라벨 순서: 자식 옆에. 누르면 부모 흐름 순서로'),
  disconnected: '연결 끊김', snapshot: '스냅샷',
  stats: (s) => `파일 ${s.files} · 노드 ${s.nodes} · 엣지 ${s.edges} · 진단 ${s.diagnostics}`,
  flows: '흐름', viewMap: '전체 지도', viewGrid: '전체 그리기', loose: '홑 파일', cellStats: (files, diags) => `파일 ${files} · 진단 ${diags}`,
  kinds: '종류', selectedNode: '선택한 노드', clickHint: '노드를 클릭하세요. 두 번 클릭하면 펼쳐집니다', diagnostics: '진단', shownOf: (n, total) => `${total} 중 ${n}`, none: '없음',
  legendCall: '값 교환', legendRef: '읽기 참고', legendMissing: '대상 없음',
  legendTask: '작업', legendDoc: '자료', legendGhost: '없음', legendSubagent: '보조 작업 호출(서브에이전트)',
  send: '보냄', receive: '받음',
  collapseBtn: '접기 ▴', expandBtn: '펼치기 ▾', editTitle: '1단계: 아래 프롬프트 본문 전부를 고칠 수 있게 연다', edit: '편집 ✎', rawEdit: '원문 ✎', rawTitle: '2단계: 파일 전체를 글로 고친다. 헤딩, 서브 에이전트 표시, 링크까지', cancel: '취소', save: '저장',
  summary: (n) => `등록 · 계약 · 간선 ${n}`, registeredAgent: '등록 에이전트', inputs: '받는 것', outputs: '내는 것', out: '나감', in: '들어옴',
  prompt: '프롬프트', thisSectionOnly: '— 이 구간만', promptOf: '└ 프롬프트 ', empty: '(비어 있음)',
}

export const DICTS: Record<Lang, Dict> = { en, ko }

declare global { interface Window { __SIL_LANG__?: string } }
/** Host language first (VS Code passes it), then what the user chose here, then the browser. Anything that is not Korean is English. */
export function initialLang(): Lang {
  const pick = (s?: string | null): Lang | null => (s ? (/^ko/i.test(s) ? 'ko' : 'en') : null)
  try { const saved = localStorage.getItem('silmari:lang'); if (saved === 'ko' || saved === 'en') return saved } catch { /* */ }
  return pick(window.__SIL_LANG__) ?? pick(typeof navigator !== 'undefined' ? navigator.language : null) ?? 'en'
}
export function saveLang(l: Lang) { try { localStorage.setItem('silmari:lang', l) } catch { /* */ } }

export const LangCtx = createContext<{ lang: Lang; t: Dict; setLang: (l: Lang) => void }>({ lang: 'en', t: en, setLang: () => {} })
export const useLang = () => useContext(LangCtx)
