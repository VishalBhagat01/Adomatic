import React, { useEffect, useId, useRef } from 'react';
import { ArrowUp, Link2 } from 'lucide-react';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const ORIGIN_META = {
  adpilot_generated: { label: 'AdPilot AI', variant: 'purple' },
  uploaded_creative: { label: 'Uploaded Creative', variant: 'info' },
  external_meta: { label: 'External Meta', variant: 'neutral' },
};

function formatCurrency(val, currency = 'INR') {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return '—';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 2,
    }).format(Number(val));
  } catch {
    return `${currency || 'USD'} ${Number(val).toFixed(2)}`;
  }
}

function formatInt(val) {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return '—';
  return new Intl.NumberFormat('en-IN').format(Math.round(Number(val)));
}

function formatPct(val) {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return '—';
  return `${Number(val).toFixed(2)}%`;
}

function formatRoas(val) {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return '—';
  return `${Number(val).toFixed(2)}x`;
}

function reorderRows(tbody, orderedRows) {
  const canMoveBefore = typeof tbody.moveBefore === 'function';
  for (const row of orderedRows) {
    if (canMoveBefore) {
      tbody.moveBefore(row, null);
    } else {
      tbody.appendChild(row);
    }
  }
}

function getNumericCellValue(row, colIndex) {
  const cell = row.cells[colIndex];
  if (!cell) return Number.NEGATIVE_INFINITY;
  const raw = cell.dataset.value;
  if (raw === undefined || raw === '') return Number.NEGATIVE_INFINITY;
  const num = Number(raw);
  return Number.isFinite(num) ? num : Number.NEGATIVE_INFINITY;
}

function getTextCellValue(row, colIndex) {
  const cell = row.cells[colIndex];
  if (!cell) return '';
  return cell.dataset.value ?? cell.textContent.trim();
}

export function SortablePerformanceTable({ items = [], onOpenMappingModal }) {
  const uid = useId().replace(/:/g, '');
  const tableId = `meta-creatives-table-${uid}`;
  const captionId = `meta-creatives-caption-${uid}`;

  const tableRef = useRef(null);
  const tbodyRef = useRef(null);
  const statusRef = useRef(null);
  const hasRows = items.length > 0;

  // Clear stale aria-sort indicators whenever upstream dataset items refresh
  useEffect(() => {
    const table = tableRef.current;
    if (!table || !table.tHead?.rows?.[0]) return;
    for (const th of table.tHead.rows[0].cells) {
      th.removeAttribute('aria-sort');
    }
    if (statusRef.current) {
      statusRef.current.textContent = '';
    }
  }, [items]);

  // Attach single table-level Invoker Command handler (with click fallback for older browsers)
  useEffect(() => {
    const table = tableRef.current;
    const tbody = tbodyRef.current;
    const status = statusRef.current;
    if (!hasRows || !table || !tbody) return undefined;

    const performSort = (buttonEl) => {
      const th = buttonEl?.closest('th');
      if (!th || !table.tHead?.rows?.[0]) return;

      const direction = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
      for (const header of table.tHead.rows[0].cells) {
        header.removeAttribute('aria-sort');
      }
      th.setAttribute('aria-sort', direction);

      const index = th.cellIndex;
      const type = th.dataset.type || 'text';
      const factor = direction === 'ascending' ? 1 : -1;

      const sortedRows = [...tbody.rows].sort((a, b) => {
        if (type === 'number') {
          return factor * (getNumericCellValue(a, index) - getNumericCellValue(b, index));
        }
        return factor * collator.compare(getTextCellValue(a, index), getTextCellValue(b, index));
      });

      const applyDomOrder = () => reorderRows(tbody, sortedRows);
      if (typeof table.startViewTransition === 'function') {
        table.startViewTransition(applyDomOrder);
      } else {
        applyDomOrder();
      }

      if (status) {
        status.textContent = `Sorted by ${buttonEl.textContent.trim()}, ${direction}, ${sortedRows.length} rows`;
      }
    };

    const supportsInvokerCommands =
      typeof HTMLButtonElement !== 'undefined' && 'commandForElement' in HTMLButtonElement.prototype;

    if (supportsInvokerCommands) {
      const onCommand = (event) => {
        if (event.command !== '--sort') return;
        performSort(event.source);
      };
      table.addEventListener('command', onCommand);
      return () => table.removeEventListener('command', onCommand);
    }

    const headerButtons = Array.from(table.tHead.querySelectorAll('button.studio-sort-btn'));
    const onClick = (event) => performSort(event.currentTarget);
    for (const btn of headerButtons) btn.addEventListener('click', onClick);
    return () => {
      for (const btn of headerButtons) btn.removeEventListener('click', onClick);
    };
  }, [hasRows]);

  if (!items.length) {
    return (
      <div className="rounded-lg border border-slate-800/80 bg-slate-950/50 py-10 px-4 text-center text-xs text-slate-400">
        No Meta creative performance records match the current filters. Trigger a Meta sync or load isolated test fixtures in Settings.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div ref={statusRef} role="status" className="studio-sr-status" />

      <div
        tabIndex={0}
        role="region"
        aria-labelledby={captionId}
        className="studio-table-wrapper"
      >
        <table ref={tableRef} id={tableId} className="studio-table studio-table--creatives">
          <caption id={captionId}>
            Creative-Level Meta Performance Comparison — Distinguishes Link CTR (outbound inline link clicks) from All-Click CTR. Missing metrics display &ldquo;—&rdquo;.
          </caption>
          <thead>
            <tr>
              <th scope="col" data-type="text">
                <button type="button" commandfor={tableId} command="--sort" className="studio-sort-btn">
                  <span>Creative &amp; Lineage</span>
                  <ArrowUp className="w-3 h-3 shrink-0 studio-sort-icon" aria-hidden="true" />
                </button>
              </th>
              <th scope="col" data-type="text">
                <button type="button" commandfor={tableId} command="--sort" className="studio-sort-btn">
                  <span>Origin</span>
                  <ArrowUp className="w-3 h-3 shrink-0 studio-sort-icon" aria-hidden="true" />
                </button>
              </th>
              <th scope="col" data-type="number">
                <button type="button" commandfor={tableId} command="--sort" className="studio-sort-btn">
                  <span>Spend</span>
                  <ArrowUp className="w-3 h-3 shrink-0 studio-sort-icon" aria-hidden="true" />
                </button>
              </th>
              <th scope="col" data-type="number">
                <button type="button" commandfor={tableId} command="--sort" className="studio-sort-btn">
                  <span>Impr.</span>
                  <ArrowUp className="w-3 h-3 shrink-0 studio-sort-icon" aria-hidden="true" />
                </button>
              </th>
              <th scope="col" data-type="number">
                <button type="button" commandfor={tableId} command="--sort" className="studio-sort-btn">
                  <span>Link Clicks</span>
                  <ArrowUp className="w-3 h-3 shrink-0 studio-sort-icon" aria-hidden="true" />
                </button>
              </th>
              <th scope="col" data-type="number">
                <button type="button" commandfor={tableId} command="--sort" className="studio-sort-btn">
                  <span>Link CTR</span>
                  <ArrowUp className="w-3 h-3 shrink-0 studio-sort-icon" aria-hidden="true" />
                </button>
              </th>
              <th scope="col" data-type="number">
                <button type="button" commandfor={tableId} command="--sort" className="studio-sort-btn">
                  <span>All CTR</span>
                  <ArrowUp className="w-3 h-3 shrink-0 studio-sort-icon" aria-hidden="true" />
                </button>
              </th>
              <th scope="col" data-type="number">
                <button type="button" commandfor={tableId} command="--sort" className="studio-sort-btn">
                  <span>Link CPC</span>
                  <ArrowUp className="w-3 h-3 shrink-0 studio-sort-icon" aria-hidden="true" />
                </button>
              </th>
              <th scope="col" data-type="number">
                <button type="button" commandfor={tableId} command="--sort" className="studio-sort-btn">
                  <span>Purchases</span>
                  <ArrowUp className="w-3 h-3 shrink-0 studio-sort-icon" aria-hidden="true" />
                </button>
              </th>
              <th scope="col" data-type="number">
                <button type="button" commandfor={tableId} command="--sort" className="studio-sort-btn">
                  <span>Conv. Value</span>
                  <ArrowUp className="w-3 h-3 shrink-0 studio-sort-icon" aria-hidden="true" />
                </button>
              </th>
              <th scope="col" data-type="number">
                <button type="button" commandfor={tableId} command="--sort" className="studio-sort-btn">
                  <span>CPA</span>
                  <ArrowUp className="w-3 h-3 shrink-0 studio-sort-icon" aria-hidden="true" />
                </button>
              </th>
              <th scope="col" data-type="number">
                <button type="button" commandfor={tableId} command="--sort" className="studio-sort-btn">
                  <span>ROAS</span>
                  <ArrowUp className="w-3 h-3 shrink-0 studio-sort-icon" aria-hidden="true" />
                </button>
              </th>
              <th scope="col">Mapping</th>
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {items.map((row) => {
              const m = row.metrics || {};
              const originMeta = ORIGIN_META[row.origin] || ORIGIN_META.external_meta;
              const titleText = row.adPilotCreativeTitle || row.metaAdName || row.metaAdId;

              return (
                <tr key={`${row.metaAdAccountId}:${row.metaAdId}`}>
                  <th scope="row" data-value={titleText}>
                    <div className="min-w-[15rem] max-w-[20rem] space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-slate-100 truncate">{titleText}</span>
                        {row.adPilotQaScore !== null && row.adPilotQaScore !== undefined ? (
                          <Badge variant="success">QA {row.adPilotQaScore}</Badge>
                        ) : null}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 truncate">
                        {row.adPilotCampaignName || row.metaCampaignName || 'Unlinked Campaign'}
                        {' → '}
                        {row.adPilotCreativeId ? `CR:${row.adPilotCreativeId.slice(-6)}` : 'No CR'}
                        {' → '}
                        Ad:{row.metaAdId}
                      </div>
                    </div>
                  </th>
                  <td data-value={originMeta.label}>
                    <Badge variant={originMeta.variant}>{originMeta.label}</Badge>
                  </td>
                  <td data-value={m.spend ?? ''} className="font-mono text-slate-100">
                    {formatCurrency(m.spend, row.currency)}
                  </td>
                  <td data-value={m.impressions ?? ''} className="font-mono text-slate-300">
                    {formatInt(m.impressions)}
                  </td>
                  <td data-value={m.linkClicks ?? ''} className="font-mono text-slate-200">
                    {formatInt(m.linkClicks)}
                  </td>
                  <td data-value={m.linkCtr ?? ''} className="font-mono text-indigo-300 font-medium">
                    {formatPct(m.linkCtr)}
                  </td>
                  <td data-value={m.allClickCtr ?? ''} className="font-mono text-slate-400">
                    {formatPct(m.allClickCtr)}
                  </td>
                  <td data-value={m.cpc ?? ''} className="font-mono text-slate-300">
                    {formatCurrency(m.cpc, row.currency)}
                  </td>
                  <td data-value={m.purchases ?? ''} className="font-mono text-emerald-300">
                    {formatInt(m.purchases)}
                  </td>
                  <td data-value={m.purchaseConversionValue ?? ''} className="font-mono text-emerald-300 font-medium">
                    {formatCurrency(m.purchaseConversionValue, row.currency)}
                  </td>
                  <td data-value={m.cpa ?? ''} className="font-mono text-slate-300">
                    {formatCurrency(m.cpa, row.currency)}
                  </td>
                  <td data-value={m.roas ?? ''} className="font-mono text-amber-300 font-semibold">
                    {formatRoas(m.roas)}
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Link2}
                      onClick={() => onOpenMappingModal(row)}
                      aria-label={`Map creative for Meta ad ${row.metaAdId}`}
                    >
                      {row.adPilotCreativeId ? 'Edit Link' : 'Map'}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
