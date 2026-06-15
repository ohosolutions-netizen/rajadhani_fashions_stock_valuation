/**
 * Zoho Creator Widget JS SDK v2 data layer.
 * Docs: https://www.zoho.com/creator/help/js-api/v2/get-records.html
 */

const APP = 'oho-erp'

export function checkIframe() {
  return window.self !== window.top
}

export async function fetchReport(reportName) {
  if (!window.ZOHO?.CREATOR?.DATA) {
    throw new Error(`ZOHO.CREATOR.DATA not available. Ensure widgetsdk-min.js is loaded and widget is inside a Creator page.`)
  }

  const records = []
  let cursor = undefined

  while (true) {
    const config = {
      app_name:    APP,
      report_name: reportName,
      max_records: 1000,
      ...(cursor ? { record_cursor: cursor } : {}),
    }

    const response = await window.ZOHO.CREATOR.DATA.getRecords(config)

    if (response.code !== 3000) {
      const msg = response.message || response.error || JSON.stringify(response)
      throw new Error(`"${reportName}" error (code ${response.code}): ${msg}`)
    }

    const batch = Array.isArray(response.data) ? response.data : []
    records.push(...batch)

    if (response.record_cursor) {
      cursor = response.record_cursor
    } else {
      break
    }
  }

  return records
}
