# Token usage and tool surface

## Reading the numbers

Open **Runtime overview**. The token boxes show what Aevra relayed today: tokens out (results sent to your AI client), tokens in (arguments received), how much the result shaping saved, the average per call and the busiest tool. The chart below shows the history; pick 24h, 7d, 30d, 90d or All. Numbers are estimates made by Aevra, not your AI provider's bill.

Use **All-time statistics**, immediately to the right of **All**, to open totals for recorded history without changing the chart range. The modal shows input, output and saved tokens, calls, failed calls, average tokens per call, up to ten top tools and connector breakdowns. Counts remain estimates. Close with **Close** or Escape to return to the trigger. If loading fails, use **Retry**.

Daily and all-time summary cards show a label and a larger main value. Saved tokens include the estimated share of raw output on the same row, for example `754k ~ 7%`. Exact counts remain available by hovering over the value.

## Sending your AI fewer tools

Every tool Aevra advertises costs tokens in every conversation. Open **Connections**, choose a client and use **Tool surface** to switch off groups it does not need (for example Browser and Desktop for a coding-only client). The dialog shows the estimated saving. Changes apply the next time the client lists tools; reconnect the client if it does not refresh.

## Shorter results

Command output is cut to 16,000 characters per stream by default. Ask the AI to pass `maxOutputChars` (256-200,000) when it needs more or less. If a client cannot read structured results, leave **Result format** on the default; choose _Text only_ to send each result once and save roughly half the result tokens.
