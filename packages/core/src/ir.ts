// The IR maps one-to-one to test/fixtures/after/graph.example.json. Design document §3.
// The CLI, viewer, and extension share only these types as their contract.

export type NodeKind = 'task' | 'doc' | 'ghost'
export type EdgeType = 'call' | 'mention' | 'ref'
export type Severity = 'error' | 'warning' | 'info'

/** Source byte range converted from an mdast UTF-16 offset (INV-8). */
export interface Range { readonly start: number; readonly end: number }

/** body is the source text below this heading and before the next heading. It appears as the node prompt in the viewer accordion. */
/** range is the file-based byte range occupied by body (INV-8). An empty body has length 0. Its insertion point is right after the heading line.
 *  The viewer asks Writer to change only this range. Writer inserts the user's text there unchanged (INV-1). */
export interface Heading { level: number; text: string; line: number; subagent: boolean; body: string; range: Range }

export interface Contract { inputs: string[]; outputs: string[] }

/** Frontmatter for a Claude Code registration file (.claude/agents/*.md). Tool limits exist only here (§1.5). */
export interface Agent { name?: string; description?: string; tools?: string[]; model?: string }

/** hash is the SHA-1 of the file bytes. The viewer sends it with an edit request. Writer rejects the request if the file changed in the meantime (T-10). */
export interface Node {
  id: string            // The repository-relative path is the identifier (D-06).
  kind: NodeKind
  title: string         // The first H1, or the file name if there is no H1.
  desc: string          // The first paragraph right after the H1.
  headings: Heading[]   // The accordion tree.
  contract: Contract | null
  hash: string
  agent?: Agent
}

/** range is the byte range occupied by the whole link in the from file (INV-8). Writer changes only this range. */
export interface Edge {
  from: string
  to: string
  type: EdgeType
  line: number
  under: string[]       // Heading path around the link. Conditions and titles are not distinguished (§1.4).
  sends: string[]       // {{>x}}
  returns: string[]     // {{<x}}
  isolated: boolean     // Whether it is under a heading with a subagent label such as [use a subagent].
  range: Range
  anchor?: string
}

/** range is a file-based byte offset in the file named by where (INV-8). Only diagnostics from links and markers have one. */
export interface Diagnostic { code: string; severity: Severity; where: string; message: string; range?: Range }

/** entry contains the entry points from .sil/config.yaml and the batch roots. If there are none, the key is absent. */
export interface Graph {
  spec: 'v4'
  entry?: string[]
  stats: {
    files: number; nodes: number; edges: number; diagnostics: number
    nodesByKind: Partial<Record<NodeKind, number>>
    edgesByType: Partial<Record<EdgeType, number>>
    diagnosticsBySeverity: Partial<Record<Severity, number>>
  }
  nodes: Node[]
  edges: Edge[]
  diagnostics: Diagnostic[]
}
