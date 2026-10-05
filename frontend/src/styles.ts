export const CSS = `
.md{font:14px/1.4 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#2c3e50;padding:16px 24px}
.md h1{font-size:20px;margin:0 0 12px}
.md-kpis{display:flex;gap:12px;margin:12px 0 16px}
.md-kpi{flex:1;border:1px solid #e1e6f0;border-radius:4px;padding:10px 12px;background:#fff}
.md-kpi .v{font-size:22px;font-weight:700}.md-kpi .l{font-size:12px;color:#6b7686}
.md-table{width:100%;border-collapse:collapse;font-size:13px;background:#fff}
.md-table th{text-align:left;padding:8px;border-bottom:2px solid #cdd7e9;color:#6b7686;font-weight:600;white-space:nowrap;user-select:none}
.md-table th.sortable{cursor:pointer}
.md-table td{padding:8px;border-bottom:1px solid #e1e6f0;white-space:nowrap}
.md-table th.desc::after{content:" \\25BC"}.md-table th.asc::after{content:" \\25B2"}
.md-fail{color:#d4333f;font-weight:600}.md-pass{color:#00aa00;font-weight:600}.md-muted{color:#8a95a5}
.md-pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600}
.md-pill.fail{background:#fbe9ea;color:#d4333f}.md-pill.pass{background:#e6f6e6;color:#008a00}.md-pill.none{background:#eef1f6;color:#6b7686}
.md-bar{display:inline-block;position:relative;width:90px;height:8px;background:#e1e6f0;border-radius:4px;vertical-align:middle;margin-left:6px}
.md-bar i{display:block;height:100%;border-radius:4px}.md-bar b{position:absolute;top:-2px;width:2px;height:12px;background:#2c3e50}
.md-table tr.selected{background:#eef4fa}.md-table tr[data-file]:hover{background:#f3f7fb}
.md-tabs{display:flex;gap:4px;border-bottom:1px solid #cdd7e9;margin:12px 0}
.md-tab{padding:6px 12px;border:0;border-bottom:2px solid transparent;color:#6b7686;background:none;cursor:pointer;font:inherit}
.md-tab.on{border-color:#236a97;color:#236a97;font-weight:600}
.md-head{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #cdd7e9;padding-bottom:8px}
.md-head .t{font-size:18px;font-weight:700}.md-head .m{font-size:12px;color:#6b7686}
.md-big{font-size:28px;font-weight:700;text-align:right}
.md-row{display:flex;gap:16px}.md-row>*{flex:1}
.md a,.md .md-link{color:#236a97;cursor:pointer;text-decoration:none;background:none;border:0;font:inherit;padding:0}
.md-note{background:#fff8e1;border:1px solid #f0d98c;border-radius:4px;padding:8px 12px;margin-bottom:12px}
.md-filters{display:flex;gap:12px;align-items:center;margin:8px 0;font-size:13px;color:#6b7686}
.md-lbl{font-size:12px;color:#6b7686;font-weight:600;text-transform:uppercase;margin:10px 0 4px}
`;

export function injectStyles(doc: Document = document): void {
  if (doc.getElementById('md-css')) return;
  const style = doc.createElement('style');
  style.id = 'md-css';
  style.textContent = CSS;
  doc.head.append(style);
}
