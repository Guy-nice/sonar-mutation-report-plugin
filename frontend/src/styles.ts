const GREEN_DARK = '#065f46';
const GREEN = '#059669';
const GREEN_LIGHT = '#10b981';
const CORAL = '#f87171';

export const CSS = `
.md{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Helvetica,Arial,sans-serif;color:#1a202c;padding:24px 40px 40px;max-width:1280px}
.md h1{font-size:28px;line-height:1.2;font-weight:700;margin:0 0 14px;letter-spacing:-.01em}
.md-sub{color:#4a5568;margin:0 0 28px}
.md-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:0 0 28px}
.md-kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:18px 20px}
.md-kpi .l{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b}
.md-kpi .v{font-size:34px;line-height:1.1;font-weight:700;margin:14px 0 10px;white-space:nowrap}
.md-kpi .s{font-size:12px;color:#4a5568}
.md-cards{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:0 0 28px}
.md-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:18px 20px}
.md-card h2{font-size:14px;font-weight:600;margin:0 0 22px}
.md-card.wide{margin:0 0 28px}
.md-hbars{display:flex;flex-direction:column;gap:12px}
.md-hbar{display:grid;grid-template-columns:150px 1fr 44px;gap:14px;align-items:center;font-size:13px}
.md-hbar .n{color:#4a5568;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.md-hbar .p{text-align:right;font-weight:700}
.md-track{position:relative;height:24px;background:#edf0f4;border-radius:4px}
.md-fill{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,${GREEN_DARK},${GREEN})}
.md-fill.needs{background:linear-gradient(90deg,#dc5a5a,${CORAL})}
.md-tick{position:absolute;top:-3px;width:2px;height:30px;background:#1a202c;border-radius:1px}
.md-empty{color:#64748b;font-size:13px;margin:0}
.md-dist{display:flex;justify-content:space-around;text-align:center;margin:0 0 26px}
.md-dist .big{font-size:48px;line-height:1.1;font-weight:700}
.md-dist .cap{font-size:12px;color:#4a5568;margin-top:8px}
.md-dist .big.ok{color:${GREEN_DARK}}.md-dist .big.bad{color:${CORAL}}
.md-split{display:flex;height:40px;border-radius:8px;overflow:hidden;background:#edf0f4}
.md-split i{display:block;height:100%}.md-split .ok{background:${GREEN}}.md-split .bad{background:${CORAL}}
.md-splitcap{display:flex;justify-content:space-between;font-size:11px;color:#4a5568;margin-top:14px}
.md-note2{font-size:12px;color:#64748b;margin:10px 0 0}
.md-table{width:100%;border-collapse:collapse;font-size:13px}
.md-table th{text-align:left;padding:10px 8px;border-bottom:2px solid #e2e8f0;color:#64748b;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;user-select:none}
.md-table th.sortable{cursor:pointer}.md-table th.sortable:hover{color:#1a202c}
.md-table td{padding:16px 8px;border-bottom:1px solid #e2e8f0;white-space:nowrap}
.md-table tbody tr:last-child td{border-bottom:0}
.md-table th.num,.md-table td.num{text-align:right}
.md-table th.desc::after{content:" \\25BC"}.md-table th.asc::after{content:" \\25B2"}
.md-table tr.selected{background:#ecfdf5}.md-table tr[data-file]:hover{background:#f0fdf8}
.md-fail{color:#dc4c4c;font-weight:600}.md-pass{color:${GREEN_DARK};font-weight:600}.md-muted{color:#64748b}
.md-pill{display:inline-block;padding:3px 9px;border-radius:4px;font-size:12px;font-weight:700;color:#fff}
.md-pill.excellent{background:${GREEN_DARK}}.md-pill.good,.md-pill.pass{background:${GREEN}}.md-pill.fair{background:${GREEN_LIGHT}}
.md-pill.needs,.md-pill.fail{background:${CORAL}}.md-pill.none{background:#e2e8f0;color:#64748b}
.md-sc{display:inline-block;min-width:50px}
.md-bar{display:inline-block;position:relative;width:90px;height:8px;background:#edf0f4;border-radius:4px;vertical-align:middle;margin-left:8px}
.md-bar i{display:block;height:100%;border-radius:4px;background:${GREEN}}.md-bar i.excellent{background:${GREEN_DARK}}.md-bar i.fair{background:${GREEN_LIGHT}}.md-bar i.needs{background:${CORAL}}
.md-bar b{position:absolute;top:-3px;width:2px;height:14px;background:#1a202c}
.md-legend{display:flex;flex-wrap:wrap;gap:20px;border-top:1px solid #e2e8f0;margin-top:8px;padding-top:16px;font-size:12px;color:#1a202c}
.md-legend span{display:inline-flex;align-items:center;gap:6px}
.md-legend i{display:inline-block;width:12px;height:12px;border-radius:2px}
.md-legend i.excellent{background:${GREEN_DARK}}.md-legend i.good{background:${GREEN}}.md-legend i.fair{background:${GREEN_LIGHT}}.md-legend i.needs{background:${CORAL}}
.md-tabs{display:flex;gap:4px;border-bottom:1px solid #e2e8f0;margin:0 0 16px}
.md-tab{padding:8px 14px;border:0;border-bottom:2px solid transparent;color:#64748b;background:none;cursor:pointer;font:inherit}
.md-tab.on{border-color:${GREEN_DARK};color:${GREEN_DARK};font-weight:600}
.md-head{display:flex;justify-content:space-between;align-items:center;margin:14px 0 24px}
.md-head .t{font-size:22px;font-weight:700;display:flex;align-items:center;gap:10px}.md-head .m{font-size:13px;color:#4a5568;margin-top:4px}
.md-big{font-size:34px;font-weight:700;text-align:right;line-height:1.1}
.md-row{display:flex;gap:24px}.md-row>*{flex:1;min-width:0}
.md a,.md .md-link{color:${GREEN_DARK};cursor:pointer;text-decoration:none;background:none;border:0;font:inherit;padding:0;font-weight:600}
.md a:hover,.md .md-link:hover{text-decoration:underline}
.md-note{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:16px}
.md-filters{display:flex;gap:14px;align-items:center;margin:0 0 12px;font-size:13px;color:#4a5568}
.md-filters select{font:inherit;padding:3px 6px;border:1px solid #cbd5e1;border-radius:4px;background:#fff}
.md-lbl{font-size:12px;color:#64748b;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin:0 0 8px}
.md-kpi .v .md-arrow{color:#64748b;font-weight:400;margin:0 4px}
.md-up{color:${GREEN_DARK};font-weight:700}.md-dn{color:#dc4c4c;font-weight:700}
.md-pair{display:flex;flex-direction:column;gap:16px}
.md-pr{display:grid;grid-template-columns:170px 1fr 92px;gap:14px;align-items:center;font-size:13px}
.md-pr .n{color:#4a5568;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.md-pr .tr{display:flex;flex-direction:column;gap:4px}
.md-pr .md-track{height:14px}
.md-pr .md-track.before .md-fill{background:#cbd5e1}
.md-pr .md-tick{top:-3px;height:20px}
.md-pr .p{text-align:right;font-weight:700;white-space:nowrap}
.md-pr .p .was{color:#94a3b8;font-weight:600}
.md-key{display:flex;gap:18px;font-size:12px;color:#4a5568;margin:16px 0 0}
.md-key i{display:inline-block;width:12px;height:12px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.md-key i.before{background:#cbd5e1}.md-key i.after{background:${GREEN}}
.md-key b{display:inline-block;width:2px;height:13px;background:#1a202c;margin-right:6px;vertical-align:-2px}
.md-gate .a{color:#64748b}.md-gate .arr{color:#94a3b8;margin:0 4px}.md-gate .b{font-weight:700}
.md-gate .b.ok{color:${GREEN_DARK}}.md-gate .b.bad{color:#dc4c4c}
.md-table tr.md-sum td{border-top:2px solid #e2e8f0;border-bottom:0;font-weight:700;background:#f1f5f9}
@media (max-width:900px){.md-kpis{grid-template-columns:repeat(2,1fr)}.md-cards{grid-template-columns:1fr}.md{padding:16px}}
`;

export function injectStyles(doc: Document = document): void {
  if (doc.getElementById('md-css')) return;
  const style = doc.createElement('style');
  style.id = 'md-css';
  style.textContent = CSS;
  doc.head.append(style);
}
