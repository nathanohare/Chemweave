// The SI tab's ribbon pictures (retrospective audit G5-07). A button that does what a command
// elsewhere does shows that command's picture (SI_ICON_SAME: Paste, Delete, Copy, the table's row
// and column commands…); the SI's own commands have drawings of their own here, drawn for this
// program on the same 24 × 24 grid and with the same roles as the Document Insert tab's (outline,
// .a the part that tells it apart, .f a soft fill, .p paper). Keys are ribbon button keys
// (buttonKey in icon-set.ts): "si:" for data-si, "si-scheme:" for data-si-scheme, and so on.

const page = '<path class="p" d="M6.25 2.75h8.5l4.5 4.5v12.5a1.5 1.5 0 0 1-1.5 1.5h-11.5a1.5 1.5 0 0 1-1.5-1.5V4.25a1.5 1.5 0 0 1 1.5-1.5z"/>';
const pages = '<rect x="7.25" y="2.75" width="12" height="15" rx="1.5"/><rect class="p" x="4.25" y="5.75" width="12" height="15.5" rx="1.5"/>';
const plus = (x: number, y: number) => `<path class="a" d="M${x} ${y - 2.75}v5.5M${x - 2.75} ${y}h5.5"/>`;
const hex = (cx: number, cy: number, r: number, cls = '') => {
  const h = r * 0.866;
  return `<path${cls ? ` class="${cls}"` : ''} d="M${cx} ${cy - r}l${h} ${r / 2}v${r}l${-h} ${r / 2}l${-h} ${-r / 2}v${-r}z"/>`;
};
const books = (x: number) => `<path class="p" d="M${x} 4.75h3.75v14.5H${x}z"/><path class="p" d="M${x + 3.75} 4.75h3.75v14.5h-3.75z"/><path d="M${x + 1} 8h1.75M${x + 4.75} 8h1.75"/>`;
const arrowR = (x1: number, x2: number, y: number, cls = 'a') => `<path${cls ? ` class="${cls}"` : ''} d="M${x1} ${y}h${x2 - x1}M${x2 - 2.75} ${y - 2.75}L${x2} ${y}l-2.75 2.75"/>`;
const arrowL = (x1: number, x2: number, y: number, cls = 'a') => `<path${cls ? ` class="${cls}"` : ''} d="M${x2} ${y}H${x1}M${x1 + 2.75} ${y - 2.75}L${x1} ${y}l2.75 2.75"/>`;
const check = (x: number, y: number) => `<path class="a" d="M${x} ${y}l2 2 4-4.5"/>`;
const spectrumAxis = '<path d="M2.75 19.25h14.5"/>';

/** The SI's own drawings. */
export const SI_ICONS: Record<string, string> = {
  // Insert ▸ Import with AI: a page with a four-pointed spark
  'si:ai-import': page + '<path d="M8 11h5M8 14.5h6M8 18h4"/><path class="f a" d="M17.5 1.75l1.1 2.9 2.9 1.1-2.9 1.1-1.1 2.9-1.1-2.9-2.9-1.1 2.9-1.1z"/>',
  // Review ▸ Dictionary: a book with a tick
  'si:dictionary': '<path class="p" d="M5.25 3.75h11a1.5 1.5 0 0 1 1.5 1.5v15h-11a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M5.25 18.25a1.5 1.5 0 0 1 1.5-1.5h11"/>' + check(8.5, 9.5),
  // View ▸ Hide SI Page: two panes, the left one folded away toward the arrow
  'si:page-collapse': '<rect class="p" x="2.75" y="4.75" width="18.5" height="14.5" rx="1.5"/><path d="M9.25 4.75v14.5"/><path class="a" d="M7 9.5L4.75 12L7 14.5"/>',
  // View ▸ Show/Hide ¶: a pilcrow
  'si:show-marks': '<path d="M11.25 4.75v14.5M15.25 4.75v14.5M10.25 4.75h8.5"/><path class="f a" d="M11.25 4.75h-2a4 4 0 0 0 0 8h2z"/>',
  // Home ▸ Project
  'si:rename': '<rect class="p" x="2.75" y="7.25" width="18.5" height="9.5" rx="2"/><path d="M6 12h5.5"/><path class="a" d="M15.5 5v14M13.75 5h3.5M13.75 19h3.5"/>',
  'si:trash': '<path d="M4.75 6.25h14.5"/><path d="M9.5 6.25V4.5h5v1.75"/><path class="p" d="M6.5 6.25l1 14h9l1-14"/><path class="a" d="M9.75 15.25a2.5 2.5 0 1 0 .6-3.1M10.25 10.5v1.9h1.9"/>',
  'si:move-up': '<rect class="p" x="2.75" y="12.75" width="11.5" height="7.5" rx="1.25"/><path d="M2.75 6.75h11.5"/><path class="a" d="M18.5 19.5V4.5M15.75 7.25L18.5 4.5l2.75 2.75"/>',
  'si:move-down': '<rect class="p" x="2.75" y="3.75" width="11.5" height="7.5" rx="1.25"/><path d="M2.75 17.25h11.5"/><path class="a" d="M18.5 4.5v15M15.75 16.75l2.75 2.75 2.75-2.75"/>',
  'si:move-to': '<path class="p" d="M2.75 6.25a1.5 1.5 0 0 1 1.5-1.5h4.5l2 2h9a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-15.5a1.5 1.5 0 0 1-1.5-1.5z"/>' + arrowR(7.5, 16.5, 13.25),
  'si:duplicate': hex(8.5, 9.25, 5.25) + hex(15.5, 14.75, 5.25, 'f a') + plus(19.5, 4.5),
  // Compile ▸ Save Word Snapshot: the compiled SI's page, kept by the clock
  // a page with a speech bubble: the flags as comments
  'si:save-snapshot-docx': page + '<path d="M7.75 9.25h7M7.75 12.25h4.5"/><circle class="f a" cx="16.5" cy="16.75" r="4.5"/><path class="a" d="M16.5 14.25v2.5l1.75 1.25"/>',
  'si:snapshot': '<rect class="p" x="2.75" y="6.75" width="18.5" height="13" rx="2"/><path d="M8.25 6.75l1.5-2.5h4.5l1.5 2.5"/><circle class="a" cx="12" cy="13.25" r="3.5"/>',
  'si:project-settings': page + '<circle class="a" cx="12" cy="13.5" r="2.25"/><path class="a" d="M12 8.75v1.5M12 16.75v1.5M7.25 13.5h1.5M15.25 13.5h1.5M8.65 10.15l1.05 1.05M14.3 15.8l1.05 1.05M8.65 16.85l1.05-1.05M14.3 11.2l1.05-1.05"/>',
  'si:apply-fields': '<path d="M4 4.75h9M4 8.25h9M4 11.75h6"/><path class="a" d="M17.5 3.5v9M14.75 9.75l2.75 2.75 2.75-2.75"/><rect class="p" x="3.75" y="15.25" width="16.5" height="5.5" rx="1.25"/>',
  // Home ▸ Compound IDs
  'si:fill-pattern': '<rect class="p" x="3.75" y="2.75" width="9.5" height="18.5" rx="1.25"/><path d="M3.75 8.75h9.5M3.75 14.75h9.5"/><path class="a" d="M6.5 5.75h4M6.5 11.75h4M6.5 17.75h4"/><path class="a" d="M17.5 5v13M15 15.5l2.5 2.5 2.5-2.5"/>',
  'si:pages-for-ids': pages + '<path class="a" d="M8.75 10.5l-1 7M12.25 10.5l-1 7M7 12.75h6M6.5 15.75h6"/>',
  'si:manual-id': hex(8.5, 9.5, 5.25) + '<rect class="f a" x="11.75" y="14.25" width="9.5" height="6.5" rx="1.25"/><path class="a" d="M14.25 17.5h4.5"/>',
  // Home ▸ Library
  'si:from-library': books(2.75) + arrowR(13.25, 21.25, 12),
  'si:to-library': books(13.75) + arrowR(2.75, 10.75, 12),
  'si:name-pubchem': hex(8, 9.5, 5.25) + '<circle class="a" cx="15.5" cy="15" r="3.75"/><path class="a" d="M18.25 17.75l3 3"/>',
  'si:structure-to-name': hex(6.5, 7.75, 4.5) + arrowR(13, 20.5, 7.75) + '<path d="M3.75 15.75h16.5M3.75 19.75h10"/>',
  // Home ▸ Structure ▸ Structure from Name: a name's lines, an arrow, the structure (Structure to Name the other way)
  'si:structure-from-name': '<path d="M3.75 4.25h16.5M3.75 8.25h10"/>' + arrowR(3.75, 11, 16.25) + hex(16.5, 16.25, 4.5),
  // Insert ▸ Figures and Schemes
  'si:new-figure-compound': '<rect class="p" x="2.75" y="3.75" width="18.5" height="16.5" rx="2"/>' + hex(12, 11, 4.75, 'a') + '<path d="M8.5 18h7"/>',
  // Insert ▸ Figures ▸ Structure from Name: a figure, a name above its structure
  'si:new-figure-name': '<rect class="p" x="2.75" y="3.75" width="18.5" height="16.5" rx="2"/>' + '<path d="M6 7.25h12"/>' + hex(12, 14.25, 4, 'a'),
  'si:to-scheme': hex(5.75, 12, 3.25) + arrowR(10.25, 15.5, 12) + hex(19, 12, 2.75, 'f a'),
  'si:out-of-scheme': '<rect class="p" x="2.75" y="4.75" width="11.5" height="14.5" rx="1.5"/>' + arrowR(8.5, 21.25, 12),
  'si:into-scheme': '<rect class="p" x="9.75" y="4.75" width="11.5" height="14.5" rx="1.5"/>' + arrowR(2.75, 15.5, 12),
  // Insert ▸ Compound Data
  'si:add-nmr-report': spectrumAxis + '<path class="a" d="M3.25 19.25h2.5l.75-6 .75 6h1.5l.6-9.5.6 9.5h1.3l.75-4 .75 4h3"/>' + plus(19, 6.25),
  'si:add-hrms-report': spectrumAxis + '<path class="a" d="M5.5 19.25V8.25M8.75 19.25v-6M12 19.25v-3.25M14.5 19.25v-1.75"/>' + plus(19, 6.25),
  'si:add-stored': '<path class="p" d="M2.75 6.25a1.5 1.5 0 0 1 1.5-1.5h4.5l2 2h9a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-15.5a1.5 1.5 0 0 1-1.5-1.5z"/><rect class="f a" x="9" y="12.25" width="6" height="4.75" rx="0.75"/><path class="a" d="M10.25 12.25v-1.5a1.75 1.75 0 0 1 3.5 0v1.5"/>',
  'si:add-field': '<path d="M3.75 7.25h6.5"/><rect class="p" x="3.75" y="10.25" width="13.5" height="6.5" rx="1.25"/><path d="M6.25 13.5h5"/>' + plus(19, 6.25),
  'si:new-gp': page + '<text class="a" x="11.75" y="12.5" font-size="6" font-weight="700" text-anchor="middle">GP</text><path d="M7.75 15.75h8.5M7.75 18.5h5.5"/>',
  'si:add-author': '<circle class="f a" cx="10" cy="8" r="3.75"/><path d="M3.25 20.25c.75-3.75 3.5-5.75 6.75-5.75 1.75 0 3.25.5 4.5 1.5"/>' + plus(18.5, 17),
  'si:add-affiliation': '<path class="p" d="M3.75 20.25V9.25L10.5 4.75l6.75 4.5v11"/><path d="M2.25 20.25h12.5"/><path class="a" d="M7.5 12v5M10.5 12v5M13.5 12v5"/>' + plus(19, 17.25),
  // References
  'si:ref-new': '<rect class="p" x="2.75" y="4.75" width="14" height="14.5" rx="1.5"/><text class="a" x="9.75" y="14.25" font-size="7" font-weight="650" text-anchor="middle">[1]</text>' + plus(19.25, 6),
  'si:ref-import': '<rect class="p" x="8.75" y="6.75" width="12.5" height="14.5" rx="1.5"/><path d="M11.5 15h7M11.5 18h4.5"/><path class="a" d="M5.25 2.75v8.5M2.5 8.5l2.75 2.75L8 8.5"/>',
  'si:ref-edit': '<rect class="p" x="2.75" y="4.75" width="14" height="14.5" rx="1.5"/><text x="9.75" y="14.25" font-size="7" font-weight="650" text-anchor="middle">[1]</text><path class="f a" d="M14.25 19.75l.75-3 6-6 2.25 2.25-6 6z"/>',
  // Manuscript Check
  'si-ms:ms-add-doc': page + '<path d="M7.75 10.5h8.5M7.75 13.5h8.5M7.75 16.5h5"/><path class="a" d="M15.25 16.25l2.25 2.25 3.75-4"/>',
  'si-ms:ms-dismissed': '<path class="p" d="M2.25 12s3.5-6.25 9.75-6.25S21.75 12 21.75 12 18.25 18.25 12 18.25 2.25 12 2.25 12z"/><circle class="a" cx="12" cy="12" r="2.75"/><path class="a" d="M17.75 3.25v3.5M16 5h3.5"/>',
  'si-ms:ms-dismiss': '<circle class="p" cx="12" cy="12" r="8.75"/><path class="a" d="M8.75 8.75l6.5 6.5M15.25 8.75l-6.5 6.5"/>',
  'si-ms:ms-restore': '<circle class="p" cx="12" cy="12" r="8.75"/><path class="a" d="M8.5 12.5a3.75 3.75 0 1 0 1.1-3.9M9.25 6.5v2.75H12"/>',
  'si:open-compound': hex(8.75, 12, 5.75) + '<path class="a" d="M14.5 4.25h5.25V9.5M19.75 4.25l-6 6"/>',
  // Dashboard
  'si-dash:columns': '<rect class="p" x="2.75" y="4.75" width="18.5" height="14.5" rx="1.5"/><path d="M8.75 4.75v14.5M14.75 4.75v14.5"/><path class="f a" d="M15 5h6v14h-6z"/>',
  'si-dash:split': '<rect class="p" x="2.75" y="3.75" width="18.5" height="7" rx="1.25"/><rect class="p" x="2.75" y="13.25" width="18.5" height="7" rx="1.25"/><text class="a" x="7" y="9.25" font-size="5" font-weight="700" text-anchor="middle">H</text><text class="a" x="7" y="18.75" font-size="5" font-weight="700" text-anchor="middle">C</text><path d="M11 7.25h7.5M11 16.75h7.5"/>',
  'si-dash:compact': '<path d="M3.75 4.75h16.5M3.75 19.25h16.5"/><path d="M3.75 10.5h16.5M3.75 13.5h16.5"/><path class="a" d="M12 2.75v4.5M10 5.25l2 2 2-2M12 21.25v-4.5M10 18.75l2-2 2 2"/>',
  'si-dash:colors': '<rect class="p" x="2.75" y="3.75" width="18.5" height="16.5" rx="1.5"/><circle class="s" cx="7" cy="8" r="1.5"/><circle class="a" cx="7" cy="12" r="1.5"/><circle cx="7" cy="16" r="1.5"/><path d="M10.5 8h7.5M10.5 12h7.5M10.5 16h7.5"/>',
  // Spectrum
  'si-spectrum:auto': '<path d="M3.75 5.25h9M3.75 9.75h7M3.75 14.25h5M3.75 18.75h3"/><path class="a" d="M17.5 4v15.5M14.75 16.75l2.75 2.75 2.75-2.75"/>',
  'si-spectrum:scope-page': page + check(9, 14),
  'si-spectrum:scope-file': pages + check(7.25, 14.25),
  'si-spectrum:reset': '<rect class="p" x="2.75" y="4.75" width="18.5" height="14.5" rx="1.5"/><path class="a" d="M9 13a3.25 3.25 0 1 0 1-2.4M9.5 8.25v2.5H12"/>',
  'si-spectrum:reset-place': '<rect x="3.75" y="3.75" width="9" height="7" rx="1" stroke-dasharray="2 2"/><rect class="p" x="11.25" y="13.25" width="9" height="7" rx="1"/><path class="a" d="M10.75 15.25L7 11.5M7 11.5v3.25M7 11.5h3.25"/>',
  'si-spectrum:section': page + '<path d="M7.25 17.25h9.5"/><path class="a" d="M7.75 17.25h1.5l.75-6 .75 6h1.5l.6-4 .6 4h3.25"/>',
  // Scheme
  'si-scheme:add-start': plus(5.5, 12) + arrowR(11.25, 21, 12, ''),
  'si-scheme:add-product': arrowR(3, 12.5, 12, '') + plus(18.5, 12),
  'si-scheme:add-step': arrowR(3, 20.5, 16, '') + plus(11.5, 7.5),
  'si-scheme:move-left': '<rect class="p" x="11.75" y="6.75" width="9.5" height="10.5" rx="1.5"/>' + arrowL(3, 10, 12),
  'si-scheme:move-right': '<rect class="p" x="2.75" y="6.75" width="9.5" height="10.5" rx="1.5"/>' + arrowR(14, 21, 12),
  'si-scheme:step-left': arrowR(8, 21, 7.5, '') + arrowL(3, 16, 16.5),
  'si-scheme:step-right': arrowR(3, 16, 7.5, '') + arrowR(8, 21, 16.5),
  'si-scheme:unlink': '<path d="M9.5 14.5l-2 2a3 3 0 0 1-4.25-4.25l2-2M14.5 9.5l2-2a3 3 0 0 1 4.25 4.25l-2 2"/><path class="a" d="M8 3.75l1 2.75M3.75 8l2.75 1M16 20.25l-1-2.75M20.25 16l-2.75-1"/>',
  'si-scheme:align:': '<rect class="p" x="2.75" y="4.75" width="18.5" height="14.5" rx="1.5"/>' + hex(8, 12, 3) + '<path class="a" d="M13.25 12h5"/>',
};

/**
 * Buttons that do what a command elsewhere does show its picture: an icon set name or a
 * TEXT_ICONS key. The same SI command on two tabs shares its own drawing.
 */
export const SI_ICON_SAME: Record<string, string> = {
  'si:replace': 'doc:replace', 'si:comment-prev': 'doc:prev-comment', 'si:comment-next': 'doc:next-comment', 'si:show-resolved': 'doc:resolve-comment',
  'si:new-figure-paste': 'paste', 'si-tbl:paste-picture': 'paste', 'si-fig:paste-picture': 'paste', 'si-scheme:paste': 'paste',
  'si-tbl:compound': 'si:new-figure-compound', 'si-fig:compound': 'si:new-figure-compound',
  'si-tbl:row-above': 'doc:table-row-above', 'si-tbl:row-below': 'doc:table-row-below', 'si-tbl:col-left': 'doc:table-col-left', 'si-tbl:col-right': 'doc:table-col-right',
  'si-tbl:del-rows': 'doc:table-del-row', 'si-tbl:del-cols': 'doc:table-del-col', 'si-tbl:del-table': 'doc:table-delete',
  'si-tbl:merge': 'doc:table-merge-cells', 'si-tbl:split': 'doc:table-split', 'si-tbl:remove-picture': 'delete',
  'si-tbl:shade-none': 'doc:table-shade-none', 'si-tbl:borders': 'doc:table-borders', 'si-tbl:painter': 'doc:table-painter',
  'si-tbl:select-table': 'doc:table-select', 'si-tbl:gridlines': 'doc:table-gridlines', 'si-tbl:cell-margins': 'doc:table-margins',
  'si-tbl:valign-top': 'doc:table-valign-top', 'si-tbl:valign-center': 'doc:table-valign-center', 'si-tbl:valign-bottom': 'doc:table-valign-bottom',
  'si-tbl:distribute': 'doc:table-even', 'si-tbl:fit-contents': 'doc:table-fit', 'si-tbl:fit-window': 'doc:table-fill-width',
  'si-xray:copy-svg': 'copy', 'si-xray:copy-picture': 'copy', 'si-xray:copy-table': 'copy', 'si-xray:save-picture': 'export-picture',
  'si:ref-delete': 'delete', 'si-ms:ms-remove': 'delete', 'si-scheme:remove': 'delete', 'si-scheme:remove-step': 'delete',
  'si:cite-library': 'insert-citation', 'si-ms:ms-add': 'insert-object', 'si-ms:ms-check': 'si-check',
  'si-ms:ms-open': 'si:open-compound', 'si-scheme:open-compound': 'si:open-compound',
  'si-dash:refresh': 'refresh-all', 'si-spectrum:up': 'si:move-up', 'si-spectrum:down': 'si:move-down',
  'si:go-to': 'doc:doc-go-to', 'si:select-all': 'doc:doc-select', 'si:view-multiple': 'doc:view-multiple',
};
