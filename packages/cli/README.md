# silmari

**Keep your docs talking to each other.**

Checks the flow and data in md documents and shows them as a graph. Agent md files are the source, silmari is the compiler, and AI is the runtime.

```sh
npm i -g silmari

sil lint                # missing files, missing anchors, data without a link, references nobody calls. --strict exits 1 on error
sil view                # local server + browser. Live: redraws when an md file changes
sil view --out=g.html   # one HTML file, no server
sil init                # .sil/config.yaml + SILMARI.md. Creates missing agent start files and appends a SILMARI.md call to existing ones
```

![sil view: one flow, orchestrators on the left calling agents on the right](https://raw.githubusercontent.com/mogiyoon/silmari/main/assets/silmari-graph.png)

Standard Markdown links are edges. Add values after a link with `{{>send}}` `{{<receive}}`. Headings are conditions. A bracket label at the end of a heading, such as `[use a subagent]`, marks isolation. An md file without notation is not an error.

Full guide and notation: https://github.com/mogiyoon/silmari
