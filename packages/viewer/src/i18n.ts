// UI strings. English by default; Korean when the browser (or the host) says so. The rail button switches and remembers.
import { createContext, useContext } from 'react'

export type Lang = 'en' | 'ko'

const en = {
  kind: { task: 'Task', doc: 'Reference', file: 'File', ghost: 'Missing' } as Record<'task' | 'doc' | 'file' | 'ghost', string>,
  missingFile: 'missing file',
  plannedFile: 'planned', templateFile: 'path pattern',
  entry: 'entry', entryTitle: 'Entry point (entry in .sil/config.yaml)',
  collapse: 'Collapse', expandTitle: 'Expand — see the headings and calls inside the node',
  subagent: 'subagent', noRules: 'project rules off', noRulesOf: (w: string) => `runs without the project start files: {{-${w}}}`, calls: (n: number) => `calls ${n}`,
  dragToMove: 'Drag this label to adjust its position. The position is saved.', resetLabel: 'Reset this label position', target: (to: string) => `Target: ${to}`, headingOfCall: 'The heading that contains this call', headingOfTarget: 'The heading the link points to',
  tagSend: 'send', tagReceive: 'receive', tagTools: 'tools', tagModel: 'model', tagWrite: 'writes', tagRead: 'imports',
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
  scopeEntry: 'Entry flows', scopeAll: 'All md files', entryOverview: 'Entry point', openFlow: 'Open this flow alone', outsideCallers: (n: number): string => `+${n} outside`, outsideTitle: (ids: string[]): string => `Also called from outside this flow:\n${ids.join('\n')}`, hiddenDiags: (n: number): string => `${n} more in documents this view hides — see all md files`,
  kinds: 'Kinds', selectedNode: 'Selected node', clickHint: 'Click a node. Double-click to expand it', diagnostics: 'Diagnostics', shownOf: (n: number, total: number): string => `${n} of ${total}`, none: 'none',
  legendCall: 'call', legendRef: 'reference', legendData: 'file data (write · import)', legendMissing: 'missing target',
  legendTask: 'task', legendDoc: 'reference', legendFile: 'file', legendGhost: 'missing', legendSubagent: 'subagent call (isolated)',
  send: 'send', receive: 'receive',
  collapseBtn: 'Collapse ▴', expandBtn: 'Expand ▾', editTitle: 'Stage 1: open every prompt body below for editing', edit: 'Edit ✎', rawEdit: 'Raw ✎', rawTitle: 'Stage 2: edit the whole file as text — headings, subagent marks, links', cancel: 'Cancel', save: 'Save',
  summary: (n: number) => `calls · contract · edges ${n}`, calledAs: (n: number) => `called ${n}×`, models: 'models', toolSets: 'tools', inputs: 'Inputs', outputs: 'Outputs', out: 'Out', in: 'In',
  prompt: 'Prompt', thisSectionOnly: '— this section only', promptOf: '└ prompt ', empty: '(empty)', fileText: 'File', calledDocs: (n: number): string => `called documents ${n}`,
}
export type Dict = typeof en

const ko: Dict = {
  kind: { task: '작업', doc: '자료', file: '파일', ghost: '없는 것' },
  missingFile: '없는 파일',
  plannedFile: '예정', templateFile: '경로 패턴',
  entry: '진입', entryTitle: '진입점 (.sil/config.yaml 의 entry)',
  collapse: '접기', expandTitle: '펼치기 — 헤딩과 호출을 노드 안에서 본다',
  subagent: '서브 에이전트', noRules: '프로젝트 규칙 미적용', noRulesOf: (w) => `프로젝트 시작 파일 없이 실행: {{-${w}}}`, calls: (n) => `호출 ${n}`,
  dragToMove: '이 라벨을 끌어 위치를 조정할 수 있다. 위치는 저장된다.', resetLabel: '이 라벨 위치 초기화', target: (to) => `대상: ${to}`, headingOfCall: '이 호출이 있는 헤딩', headingOfTarget: '링크가 가리키는 헤딩',
  tagSend: '보냄', tagReceive: '받음', tagTools: '도구', tagModel: '모델', tagWrite: '저장', tagRead: '불러오기',
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
  scopeEntry: '진입점 흐름', scopeAll: '전체 md', entryOverview: '진입점', openFlow: '이 흐름만 연다', outsideCallers: (n) => `밖에서 +${n}`, outsideTitle: (ids) => `이 흐름 밖에서도 부른다:\n${ids.join('\n')}`, hiddenDiags: (n) => `이 보기가 숨긴 문서에 ${n}개 더 — 전체 md에서 본다`,
  kinds: '종류', selectedNode: '선택한 노드', clickHint: '노드를 클릭하세요. 두 번 클릭하면 펼쳐집니다', diagnostics: '진단', shownOf: (n, total) => `${total} 중 ${n}`, none: '없음',
  legendCall: '호출', legendRef: '읽기 참고', legendData: '파일 데이터 (저장 · 불러오기)', legendMissing: '대상 없음',
  legendTask: '작업', legendDoc: '자료', legendFile: '파일', legendGhost: '없음', legendSubagent: '보조 작업 호출(서브에이전트)',
  send: '보냄', receive: '받음',
  collapseBtn: '접기 ▴', expandBtn: '펼치기 ▾', editTitle: '1단계: 아래 프롬프트 본문 전부를 고칠 수 있게 연다', edit: '편집 ✎', rawEdit: '원문 ✎', rawTitle: '2단계: 파일 전체를 글로 고친다. 헤딩, 서브 에이전트 표시, 링크까지', cancel: '취소', save: '저장',
  summary: (n) => `호출 · 계약 · 간선 ${n}`, calledAs: (n) => `호출 ${n}회`, models: '모델', toolSets: '도구', inputs: '받는 것', outputs: '내는 것', out: '나감', in: '들어옴',
  prompt: '프롬프트', thisSectionOnly: '— 이 구간만', promptOf: '└ 프롬프트 ', empty: '(비어 있음)', fileText: '파일', calledDocs: (n) => `호출하는 문서 ${n}`,
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
