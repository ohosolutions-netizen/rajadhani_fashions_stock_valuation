import { useState, useEffect, useRef } from 'react'
import './App.css'
import { checkIframe, fetchReport } from './zohoApi.js'

function fmtINR(num) {
  if (num === null || num === undefined || isNaN(num)) return '—'
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(num)
}

function fmtCurrency(num) {
  if (num === null || num === undefined || isNaN(num)) return '—'
  return '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(num)
}

function buildSummary(stockRecords, itemRecords) {
  // Build Item_Report map — keyed by ID and name fallback
  const itemById   = {}
  const itemByName = {}
  for (const rec of itemRecords) {
    const id   = String(rec.ID || rec.id || '').trim()
    const name = String(rec.Item_Name || '').trim().toLowerCase()
    const info = {
      name:         rec.Item_Name    || 'Unknown',
      code:         rec.Item_Code    || '',
      sellingPrice: parseFloat(rec.Selling_Price) || 0,
      opStock:      parseFloat(rec.OP_Stock)      || 0,
    }
    if (id)   itemById[id]     = info
    if (name) itemByName[name] = info
  }

  // Group All_Stocks by item — sum Available_Stock across warehouses
  const grouped = {}
  for (const rec of stockRecords) {
    const itemRef  = rec.Item
    const itemId   = String(itemRef?.ID || itemRef?.id || '').trim()
    const itemName = String(itemRef?.display_value || itemRef?.Display_Value || '').trim()
    const key      = itemId || itemName.toLowerCase() || 'unknown'

    if (!grouped[key]) {
      grouped[key] = { key, itemId, itemName: itemName || itemId || 'Unknown', availableStock: 0, stockLines: [] }
    }
    grouped[key].availableStock += parseFloat(rec.Available_Stock) || 0
    grouped[key].stockLines.push(rec)   // keep raw rows for the detail modal
  }

  // Merge with Item_Report — calculate values using Selling_Price
  const rows = Object.values(grouped).map((row) => {
    const info         = itemById[row.itemId] || itemByName[row.itemName.toLowerCase()] || {}
    const sellingPrice = info.sellingPrice ?? 0
    const opStock      = info.opStock      ?? 0
    return {
      itemId:            row.itemId,
      itemCode:          info.code         || '',
      itemName:          info.name         || row.itemName,
      availableStock:    row.availableStock,
      sellingPrice,
      balanceStockValue: row.availableStock * sellingPrice,
      opStock,
      opStockValue:      opStock * sellingPrice,
      stockLines:        row.stockLines,   // raw All_Stocks rows for this item
    }
  })

  rows.sort((a, b) => a.itemName.localeCompare(b.itemName))
  return rows
}

function StockDetailModal({ row, onClose }) {
  if (!row) return null

  // Collect all unique field keys across the stock lines (excluding Item lookup)
  const skipKeys = new Set(['Item', 'ID', 'ROWID'])
  const fieldKeys = []
  for (const rec of row.stockLines) {
    for (const k of Object.keys(rec)) {
      if (!skipKeys.has(k) && !fieldKeys.includes(k)) fieldKeys.push(k)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-item-code">{row.itemCode}</div>
            <h2 className="modal-title">{row.itemName}</h2>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-summary-row">
          <div className="modal-stat">
            <span className="modal-stat-label">Total Available Stock</span>
            <span className="modal-stat-value">{fmtINR(row.availableStock)}</span>
          </div>
          <div className="modal-stat">
            <span className="modal-stat-label">Selling Price</span>
            <span className="modal-stat-value">{fmtCurrency(row.sellingPrice)}</span>
          </div>
          <div className="modal-stat">
            <span className="modal-stat-label">Balance Stock Value</span>
            <span className="modal-stat-value">{fmtCurrency(row.balanceStockValue)}</span>
          </div>
          <div className="modal-stat">
            <span className="modal-stat-label">OP Stock</span>
            <span className="modal-stat-value">{fmtINR(row.opStock)}</span>
          </div>
          <div className="modal-stat">
            <span className="modal-stat-label">OP Stock Value</span>
            <span className="modal-stat-value">{fmtCurrency(row.opStockValue)}</span>
          </div>
        </div>

        <h3 className="modal-section-title">
          Stock Lines ({row.stockLines.length} {row.stockLines.length === 1 ? 'warehouse' : 'warehouses'})
        </h3>

        <div className="modal-table-wrap">
          <table className="modal-table">
            <thead>
              <tr>
                {fieldKeys.map((k) => <th key={k}>{k.replace(/_/g, ' ')}</th>)}
              </tr>
            </thead>
            <tbody>
              {row.stockLines.map((rec, i) => (
                <tr key={i}>
                  {fieldKeys.map((k) => {
                    const v = rec[k]
                    const display = typeof v === 'object' ? (v?.display_value ?? JSON.stringify(v)) : String(v ?? '—')
                    const isNum = !isNaN(parseFloat(display)) && display !== '—'
                    return (
                      <td key={k} className={isNum ? 'col-num' : ''}>
                        {isNum ? fmtINR(parseFloat(display)) : display}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, color }) {
  return (
    <div className="metric-card" style={{ borderTopColor: color }}>
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={{ color }}>{value}</div>
    </div>
  )
}

function ErrorBanner({ message, onDismiss }) {
  return (
    <div className="error-banner">
      <span className="error-banner-icon">⚠</span>
      <pre className="error-banner-msg">{message}</pre>
      <button className="error-banner-close" onClick={onDismiss}>✕</button>
    </div>
  )
}

export default function App() {
  const [ready, setReady]         = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [rows, setRows]           = useState([])
  const [detailRow, setDetailRow] = useState(null)
  const [search, setSearch]       = useState('')
  const [sortCol, setSortCol]     = useState('itemName')
  const [sortDir, setSortDir]     = useState('asc')
  const loadingRef                = useRef(false)

  useEffect(() => {
    if (!checkIframe()) {
      setError('NOT_IN_IFRAME')
    } else {
      setReady(true)
    }
  }, [])

  async function loadData() {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const [stockRecords, itemRecords] = await Promise.all([
        fetchReport('All_Stocks'),
        fetchReport('Item_Report'),
      ])
      setRows(buildSummary(stockRecords, itemRecords))
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }

  useEffect(() => {
    if (ready) loadData()
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // Not inside Creator iframe — show setup guide
  if (error === 'NOT_IN_IFRAME') {
    return (
      <div className="error-screen">
        <div className="error-box">
          <div className="error-icon">🔌</div>
          <h2>Open this inside Zoho Creator</h2>
          <p style={{ marginBottom: 12, color: '#4a5568', fontSize: '0.9rem' }}>
            This page must be embedded inside a Creator page for the SDK to connect.
          </p>
          <ol className="setup-steps">
            <li>Open <strong>oho-erp</strong> in Zoho Creator</li>
            <li>Open any <strong>Page</strong> in edit mode</li>
            <li>Add a <strong>Widget</strong> component → type: <strong>URL Widget</strong></li>
            <li>URL: <code>http://localhost:5173</code></li>
            <li>Save and <strong>preview the page</strong></li>
          </ol>
        </div>
      </div>
    )
  }

  const filtered = rows.filter((r) =>
    r.itemName.toLowerCase().includes(search.toLowerCase())
  )

  const sorted = [...filtered].sort((a, b) => {
    const va = a[sortCol], vb = b[sortCol]
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : (va - vb)
    return sortDir === 'asc' ? cmp : -cmp
  })

  function toggleSort(col) {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortCol(col); setSortDir('asc') }
  }

  function SortIcon({ col }) {
    if (sortCol !== col) return <span className="sort-icon">⇅</span>
    return <span className="sort-icon active">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  function exportCSV() {
    const headers = ['Item Code', 'Item', 'Available Stock', 'Selling Price', 'Balance Stock Value', 'OP Stock', 'OP Stock Value']
    const csvRows = [
      headers.join(','),
      ...sorted.map((r) =>
        [
          `"${r.itemCode}"`,
          `"${r.itemName}"`,
          r.availableStock,
          r.sellingPrice.toFixed(2),
          r.balanceStockValue.toFixed(2),
          r.opStock,
          r.opStockValue.toFixed(2),
        ].join(',')
      ),
    ]
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'stock_summary.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const totalItems     = rows.length
  const totalAvailable = rows.reduce((s, r) => s + r.availableStock,    0)
  const totalBalance   = rows.reduce((s, r) => s + r.balanceStockValue, 0)
  const totalOPStock   = rows.reduce((s, r) => s + r.opStock,           0)
  const totalOPValue   = rows.reduce((s, r) => s + r.opStockValue,      0)

  return (
    <div className="widget-root">
      <StockDetailModal row={detailRow} onClose={() => setDetailRow(null)} />
      <header className="widget-header">
        <div className="header-title">
          <span className="header-icon">📦</span>
          <h1>Stock Summary</h1>
        </div>
        <div className="header-actions">
          <input
            className="search-box"
            type="text"
            placeholder="Search item…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn-export" onClick={exportCSV} disabled={loading || rows.length === 0}>
            ⬇ CSV
          </button>
          <button className="btn-refresh" onClick={loadData} disabled={loading}>
            {loading ? <><span className="btn-spinner" /> Loading…</> : '↻ Refresh'}
          </button>
        </div>
      </header>

      {error && error !== 'NOT_IN_IFRAME' && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      )}

      {loading && rows.length === 0 ? (
        <div className="loading-screen">
          <div className="spinner" />
          <p>Fetching records from Zoho Creator…</p>
        </div>
      ) : (
        <>
          <div className="metrics-grid">
            <MetricCard label="Total Items"         value={fmtINR(totalItems)}        color="#4361ee" />
            <MetricCard label="Available Stock"     value={fmtINR(totalAvailable)}    color="#2ec4b6" />
            <MetricCard label="Balance Stock Value" value={fmtCurrency(totalBalance)} color="#f77f00" />
            <MetricCard label="OP Stock"            value={fmtINR(totalOPStock)}      color="#805ad5" />
            <MetricCard label="OP Stock Value"      value={fmtCurrency(totalOPValue)} color="#e63946" />
          </div>

          <div className="table-wrapper">
            {loading && <div className="table-overlay"><div className="spinner" /></div>}
            <table className="stock-table">
              <thead>
                <tr>
                  {[
                    { col: 'itemCode',          label: 'Item Code' },
                    { col: 'itemName',          label: 'Item' },
                    { col: 'availableStock',    label: 'Available Stock' },
                    { col: 'sellingPrice',      label: 'Selling Price' },
                    { col: 'balanceStockValue', label: 'Balance Stock Value' },
                    { col: 'opStock',           label: 'OP Stock' },
                    { col: 'opStockValue',      label: 'OP Stock Value' },
                  ].map(({ col, label }) => (
                    <th key={col} onClick={() => toggleSort(col)}>
                      {label} <SortIcon col={col} />
                    </th>
                  ))}
                  <th className="th-details">Details</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-row">
                      {search ? 'No items match your search.' : 'No stock records found.'}
                    </td>
                  </tr>
                ) : (
                  sorted.map((r, i) => (
                    <tr key={r.itemId || i} className={i % 2 === 0 ? 'row-even' : 'row-odd'}>
                      <td className="col-code">{r.itemCode || '—'}</td>
                      <td className="col-name">{r.itemName}</td>
                      <td className="col-num">{fmtINR(r.availableStock)}</td>
                      <td className="col-num">{fmtCurrency(r.sellingPrice)}</td>
                      <td className="col-num">{fmtCurrency(r.balanceStockValue)}</td>
                      <td className="col-num">{fmtINR(r.opStock)}</td>
                      <td className="col-num">{fmtCurrency(r.opStockValue)}</td>
                      <td className="col-detail">
                        <button className="btn-detail" onClick={() => setDetailRow(r)}>
                          📋 {r.stockLines.length}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            Showing {sorted.length} of {rows.length} items
          </div>
        </>
      )}
    </div>
  )
}
