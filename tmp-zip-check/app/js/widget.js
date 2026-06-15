(function () {
  "use strict";

  var DEFAULTS = {
    applicationLinkName: "",
    stockReportName: "Stock_Report",
    itemReportName: "Item_Report",
    itemLookupField: "Item",
    warehouseField: "Warehouse",
    availableStockField: "Available_Stock",
    balanceStockValueField: "Balance_Stock_Value",
    itemNameField: "Item_Name",
    opStockField: "OP_Stock",
    opStockValueField: "OP_Stock_Value"
  };

  var state = {
    params: Object.assign({}, DEFAULTS),
    rows: [],
    filteredRows: [],
    warnings: [],
    loading: false
  };

  var nodes = {};

  document.addEventListener("DOMContentLoaded", function () {
    nodes = {
      lastUpdated: document.getElementById("lastUpdated"),
      totalItems: document.getElementById("totalItems"),
      totalAvailable: document.getElementById("totalAvailable"),
      totalBalanceValue: document.getElementById("totalBalanceValue"),
      totalOpValue: document.getElementById("totalOpValue"),
      notice: document.getElementById("notice"),
      tableBody: document.getElementById("stockTableBody"),
      searchInput: document.getElementById("searchInput"),
      refreshButton: document.getElementById("refreshButton"),
      exportButton: document.getElementById("exportButton")
    };

    nodes.refreshButton.addEventListener("click", loadData);
    nodes.exportButton.addEventListener("click", exportCsv);
    nodes.searchInput.addEventListener("input", applyFilter);

    loadData();
  });

  async function loadData() {
    if (state.loading) {
      return;
    }

    setLoading(true);
    showNotice("", "");

    try {
      state.params = await getResolvedParams();
      var stockRecords = await getAllRecords(state.params.stockReportName);
      var itemRecords = await getItemRecords();
      var itemMap = buildItemMap(itemRecords);

      state.rows = aggregateStock(stockRecords, itemMap);
      state.filteredRows = state.rows.slice();
      render();

      var message = "Live data refreshed at " + formatTime(new Date()) + ". " +
        stockRecords.length + " stock rows combined into " + state.rows.length + " item rows.";
      nodes.lastUpdated.textContent = message;

      if (state.warnings.length) {
        showNotice(state.warnings.join(" "), "warning");
      }
    } catch (error) {
      showNotice(error.message || "Unable to load live stock data.", "error");
      nodes.lastUpdated.textContent = "Live data could not be loaded.";
      renderEmpty("No stock data available.");
    } finally {
      setLoading(false);
    }
  }

  async function getResolvedParams() {
    var params = Object.assign({}, DEFAULTS);

    if (window.ZOHO && ZOHO.CREATOR && ZOHO.CREATOR.UTIL && ZOHO.CREATOR.UTIL.getWidgetParams) {
      var response = await ZOHO.CREATOR.UTIL.getWidgetParams();
      var values = response && response.data ? response.data : response;

      Object.keys(DEFAULTS).forEach(function (key) {
        if (values && values[key] !== undefined && values[key] !== null && String(values[key]).trim() !== "") {
          params[key] = String(values[key]).trim();
        }
      });
    } else {
      throw new Error("Open this widget inside Zoho Creator so the Creator widget SDK can read live records.");
    }

    return params;
  }

  async function getItemRecords() {
    state.warnings = [];

    if (!state.params.itemReportName) {
      state.warnings.push("Item report is not configured, so OP stock values are read only if they are exposed in the Stock report.");
      return [];
    }

    try {
      return await getAllRecords(state.params.itemReportName);
    } catch (error) {
      state.warnings.push("Could not read Item report '" + state.params.itemReportName + "'. OP stock fields will use any lookup-related values available in Stock records.");
      return [];
    }
  }

  async function getAllRecords(reportName) {
    if (!window.ZOHO || !ZOHO.CREATOR || !ZOHO.CREATOR.DATA || !ZOHO.CREATOR.DATA.getRecords) {
      throw new Error("Zoho Creator JS API v2 is unavailable.");
    }

    var allRecords = [];
    var cursor = "";
    var guard = 0;

    do {
      var config = {
        report_name: reportName,
        field_config: "all",
        max_records: 1000
      };

      if (state.params.applicationLinkName) {
        config.app_name = state.params.applicationLinkName;
      }

      if (cursor) {
        config.record_cursor = cursor;
      }

      var response = await ZOHO.CREATOR.DATA.getRecords(config);
      if (!isSuccess(response)) {
        throw new Error(getApiError(response, "Unable to fetch report '" + reportName + "'."));
      }

      var batch = Array.isArray(response.data) ? response.data : [];
      allRecords = allRecords.concat(batch);
      cursor = getRecordCursor(response);
      guard += 1;

      if (guard > 500) {
        throw new Error("Record cursor loop stopped after too many batches for '" + reportName + "'.");
      }
    } while (cursor);

    return allRecords;
  }

  function isSuccess(response) {
    return response && (response.code === 3000 || response.code === "3000");
  }

  function getApiError(response, fallback) {
    if (!response) {
      return fallback;
    }

    return response.message || response.error_message || response.error || fallback;
  }

  function getRecordCursor(response) {
    var candidates = [
      response.record_cursor,
      response.next_record_cursor,
      response.cursor,
      response.result && response.result.record_cursor,
      response.info && response.info.record_cursor,
      response.header && response.header.record_cursor,
      response.headers && response.headers.record_cursor
    ];

    for (var i = 0; i < candidates.length; i += 1) {
      if (typeof candidates[i] === "string" && candidates[i].trim()) {
        return candidates[i].trim();
      }
    }

    return "";
  }

  function buildItemMap(itemRecords) {
    var map = {};

    itemRecords.forEach(function (record) {
      if (record && record.ID) {
        map[String(record.ID)] = record;
      }
    });

    return map;
  }

  function aggregateStock(stockRecords, itemMap) {
    var grouped = {};

    stockRecords.forEach(function (record) {
      var lookup = record[state.params.itemLookupField];
      var itemId = getLookupId(lookup);
      var lookupName = getDisplayValue(lookup);
      var relatedItem = itemId ? itemMap[itemId] : null;
      var itemName = firstText(
        relatedItem && relatedItem[state.params.itemNameField],
        record[state.params.itemLookupField + "." + state.params.itemNameField],
        lookupName,
        record[state.params.itemNameField],
        "Unassigned Item"
      );
      var key = itemId || normalizeKey(itemName);

      if (!grouped[key]) {
        grouped[key] = {
          key: key,
          itemId: itemId,
          itemName: itemName,
          warehouseSet: {},
          warehouses: [],
          rowCount: 0,
          availableStock: 0,
          balanceStockValue: 0,
          opStock: firstNumber(
            relatedItem && relatedItem[state.params.opStockField],
            record[state.params.itemLookupField + "." + state.params.opStockField],
            record[state.params.opStockField]
          ),
          opStockValue: firstNumber(
            relatedItem && relatedItem[state.params.opStockValueField],
            record[state.params.itemLookupField + "." + state.params.opStockValueField],
            record[state.params.opStockValueField]
          )
        };
      }

      var bucket = grouped[key];
      bucket.rowCount += 1;
      bucket.availableStock += toNumber(record[state.params.availableStockField]);
      bucket.balanceStockValue += toNumber(record[state.params.balanceStockValueField]);

      var warehouse = firstText(record[state.params.warehouseField], "No warehouse");
      if (!bucket.warehouseSet[warehouse]) {
        bucket.warehouseSet[warehouse] = true;
        bucket.warehouses.push(warehouse);
      }

      if (!bucket.opStock) {
        bucket.opStock = firstNumber(
          relatedItem && relatedItem[state.params.opStockField],
          record[state.params.itemLookupField + "." + state.params.opStockField],
          record[state.params.opStockField]
        );
      }

      if (!bucket.opStockValue) {
        bucket.opStockValue = firstNumber(
          relatedItem && relatedItem[state.params.opStockValueField],
          record[state.params.itemLookupField + "." + state.params.opStockValueField],
          record[state.params.opStockValueField]
        );
      }
    });

    return Object.keys(grouped)
      .map(function (key) {
        var row = grouped[key];
        row.warehouses.sort(function (a, b) {
          return a.localeCompare(b);
        });
        return row;
      })
      .sort(function (a, b) {
        return a.itemName.localeCompare(b.itemName);
      });
  }

  function applyFilter() {
    var term = nodes.searchInput.value.trim().toLowerCase();

    if (!term) {
      state.filteredRows = state.rows.slice();
    } else {
      state.filteredRows = state.rows.filter(function (row) {
        return row.itemName.toLowerCase().indexOf(term) >= 0 ||
          row.warehouses.join(" ").toLowerCase().indexOf(term) >= 0;
      });
    }

    render();
  }

  function render() {
    var rows = state.filteredRows;
    var totals = rows.reduce(function (sum, row) {
      sum.availableStock += row.availableStock;
      sum.balanceStockValue += row.balanceStockValue;
      sum.opStockValue += row.opStockValue;
      return sum;
    }, {
      availableStock: 0,
      balanceStockValue: 0,
      opStockValue: 0
    });

    nodes.totalItems.textContent = formatInteger(rows.length);
    nodes.totalAvailable.textContent = formatQuantity(totals.availableStock);
    nodes.totalBalanceValue.textContent = formatMoney(totals.balanceStockValue);
    nodes.totalOpValue.textContent = formatMoney(totals.opStockValue);

    if (!rows.length) {
      renderEmpty("No matching stock rows.");
      return;
    }

    nodes.tableBody.innerHTML = rows.map(function (row) {
      return "<tr>" +
        "<td><span class=\"item-name\">" + escapeHtml(row.itemName) + "</span>" +
        (row.itemId ? "<span class=\"item-id\">ID: " + escapeHtml(row.itemId) + "</span>" : "") + "</td>" +
        "<td><div class=\"warehouses\" title=\"" + escapeHtml(row.warehouses.join(", ")) + "\">" +
        escapeHtml(row.warehouses.join(", ")) + "</div></td>" +
        "<td class=\"number-cell\">" + formatQuantity(row.availableStock) + "</td>" +
        "<td class=\"number-cell\">" + formatMoney(row.balanceStockValue) + "</td>" +
        "<td class=\"number-cell\">" + formatQuantity(row.opStock) + "</td>" +
        "<td class=\"number-cell\">" + formatMoney(row.opStockValue) + "</td>" +
        "</tr>";
    }).join("");
  }

  function renderEmpty(message) {
    nodes.tableBody.innerHTML = "<tr><td colspan=\"6\" class=\"empty-cell\">" + escapeHtml(message) + "</td></tr>";
    nodes.totalItems.textContent = "0";
    nodes.totalAvailable.textContent = "0";
    nodes.totalBalanceValue.textContent = "0.00";
    nodes.totalOpValue.textContent = "0.00";
  }

  function exportCsv() {
    var rows = state.filteredRows;
    if (!rows.length) {
      return;
    }

    var header = [
      "Item",
      "Item ID",
      "Warehouses",
      "Available Stock",
      "Balance Stock Value",
      "OP Stock",
      "OP Stock Value"
    ];
    var lines = [header].concat(rows.map(function (row) {
      return [
        row.itemName,
        row.itemId || "",
        row.warehouses.join(", "),
        row.availableStock,
        row.balanceStockValue,
        row.opStock,
        row.opStockValue
      ];
    })).map(function (line) {
      return line.map(csvCell).join(",");
    });

    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "stock-summary.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    var text = value === undefined || value === null ? "" : String(value);
    return "\"" + text.replace(/"/g, "\"\"") + "\"";
  }

  function getLookupId(value) {
    if (!value) {
      return "";
    }

    if (typeof value === "object") {
      return firstText(value.ID, value.id, "");
    }

    return "";
  }

  function getDisplayValue(value) {
    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value === "object") {
      return firstText(value.zc_display_value, value.display_value, value.name, value.Name, value.ID, "");
    }

    return String(value);
  }

  function firstText() {
    for (var i = 0; i < arguments.length; i += 1) {
      var value = arguments[i];
      var text = getDisplayValue(value).trim();
      if (text) {
        return text;
      }
    }

    return "";
  }

  function firstNumber() {
    for (var i = 0; i < arguments.length; i += 1) {
      if (arguments[i] !== undefined && arguments[i] !== null && String(arguments[i]).trim() !== "") {
        return toNumber(arguments[i]);
      }
    }

    return 0;
  }

  function toNumber(value) {
    if (typeof value === "number" && isFinite(value)) {
      return value;
    }

    var displayValue = getDisplayValue(value);
    var text = String(displayValue).replace(/,/g, "").trim();
    var isNegative = /^\(.*\)$/.test(text);
    var normalized = text.replace(/[^0-9.-]/g, "");
    var number = Number(normalized);

    if (!isFinite(number)) {
      return 0;
    }

    return isNegative ? -number : number;
  }

  function normalizeKey(value) {
    return String(value || "").trim().toLowerCase();
  }

  function formatInteger(value) {
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
  }

  function formatQuantity(value) {
    var hasFraction = Math.abs(value % 1) > 0.0001;
    return new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: 2
    }).format(value);
  }

  function formatMoney(value) {
    return new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  function formatTime(date) {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    nodes.refreshButton.disabled = isLoading;
    nodes.exportButton.disabled = isLoading;
    nodes.refreshButton.textContent = isLoading ? "Loading" : "Refresh";
  }

  function showNotice(message, type) {
    nodes.notice.textContent = message;
    nodes.notice.className = "notice hidden";

    if (message) {
      nodes.notice.className = "notice" + (type === "error" ? " error" : "");
    }
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
