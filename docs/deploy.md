# Rajadhani Stock Widget Deployment

## Widget behavior

The widget reads live records from the Zoho Creator Stock report and groups rows by the Item lookup. For every item it totals:

- `Available_Stock`
- `Balance_Stock_Value`

It also reads item-level opening values from the Item report:

- `OP_Stock`
- `OP_Stock_Value`

The default configuration uses:

- Stock report: `Stock_Report`
- Item report: `Item_Report`
- Item lookup field: `Item`
- Warehouse field: `Warehouse`
- Item name field: `Item_Name`

## External Creator hosting

The widget is hosted as a public HTTPS page and can be used with Creator's External hosting option.

Use this path as the Zoho Creator widget Index File after deployment:

```text
https://<deployed-site-domain>/app/widget.html
```

Do not use `127.0.0.1` for a live Creator widget. That address only works on the local machine while a development server is running.

1. Open the Creator app settings for `oho-erp`.
2. Open `Widgets`.
3. Create or update the widget.
4. Set Hosting to `External`.
5. Paste the deployed HTTPS URL ending in `/app/widget.html` in Index File.
6. Add or refresh the widget on the required page from Page Builder.

## Values to confirm

The published report URLs you provided confirm the report link names as `Stock_Report` and `Item_Report`. The widget still exposes these as `stockReportName` and `itemReportName`, so they can be changed during Creator widget mapping without code changes if the report link names change later.
