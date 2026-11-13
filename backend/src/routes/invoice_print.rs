//! Globally consistent A4 invoice rendering. All data is escaped before insertion
//! into HTML; no customer-controlled HTML, scripts, CSS or URLs are permitted.
use serde_json::Value;

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
fn words_0_999(n: u64) -> String {
    const ONES: [&str; 20] = [
        "Zero",
        "One",
        "Two",
        "Three",
        "Four",
        "Five",
        "Six",
        "Seven",
        "Eight",
        "Nine",
        "Ten",
        "Eleven",
        "Twelve",
        "Thirteen",
        "Fourteen",
        "Fifteen",
        "Sixteen",
        "Seventeen",
        "Eighteen",
        "Nineteen",
    ];
    const TENS: [&str; 10] = [
        "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
    ];
    if n < 20 {
        return ONES[n as usize].into();
    }
    if n < 100 {
        return format!(
            "{}{}",
            TENS[(n / 10) as usize],
            if n % 10 > 0 {
                format!(" {}", ONES[(n % 10) as usize])
            } else {
                String::new()
            }
        );
    }
    format!(
        "{} Hundred{}",
        ONES[(n / 100) as usize],
        if n % 100 > 0 {
            format!(" {}", words_0_999(n % 100))
        } else {
            String::new()
        }
    )
}
fn inr_words(total: &str) -> String {
    let mut split = total.split('.');
    let raw = split.next().unwrap_or("0").parse::<u64>().unwrap_or(0);
    let paise = split
        .next()
        .unwrap_or("0")
        .chars()
        .take(2)
        .collect::<String>();
    let paisa = format!("{paise:0<2}").parse::<u64>().unwrap_or(0);
    let mut num = raw;
    let mut parts = Vec::new();
    for (unit, size) in [
        ("", 1000),
        ("Thousand", 100),
        ("Lakh", 100),
        ("Crore", 100),
        ("Arab", 100),
    ] {
        let n = num % size;
        if n > 0 {
            parts.push(format!("{} {}", words_0_999(n), unit).trim().to_string());
        }
        num /= size;
        if num == 0 {
            break;
        }
    }
    if num > 0 {
        return "Amount as per total".into();
    }
    parts.reverse();
    let whole = if parts.is_empty() {
        "Zero".to_string()
    } else {
        parts.join(" ")
    };
    if paisa > 0 {
        format!("Rupees {} and {} Paise Only", whole, words_0_999(paisa))
    } else {
        format!("Rupees {} Only", whole)
    }
}
pub fn render(v: &Value, draft: bool) -> String {
    let seller = &v["seller"];
    let buyer = &v["buyer"];
    let mut items = String::new();
    for (idx, item) in v["items"].as_array().into_iter().flatten().enumerate() {
        items.push_str(&format!(
            "<tr><td class='num'>{}</td><td>Supply of Ready Mix Concrete - {}</td><td>{}</td><td class='num'>{}</td><td class='num'>{}</td><td class='num'>{}</td><td class='num'>{}</td><td class='num'>{}</td></tr>",
            idx+1,esc(s(item,"grade")),esc(s(item,"hsn")),esc(s(item,"quantity_m3")),
            esc(s(item,"rate_per_m3")),esc(s(item,"gst_rate")),
            esc(s(item,"taxable")),esc(s(item,"line_total"))
        ));
    }
    let mut challans = String::new();
    for ch in v["challans"].as_array().into_iter().flatten() {
        if let Some(c) = ch.as_str() {
            if !challans.is_empty() {
                challans.push_str(", ");
            }
            challans.push_str(&esc(c));
        }
    }
    let number = if draft {
        "DRAFT / NOT ISSUED"
    } else {
        s(v, "invoice_number")
    };
    let banner = if draft {
        "<div class='watermark'>DRAFT - NOT A TAX INVOICE</div>"
    } else {
        ""
    };
    let total = s(v, "total");
    format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>TrackMyRMC Tax Invoice</title><style>
    @page {{ size: A4 portrait; margin: 11mm; }}
    * {{ box-sizing: border-box; }}
    body {{ font-family: Arial, 'Noto Sans', sans-serif; font-size: 11px; color:#111; background:#f2f3f5; margin:0; }}
    article {{ width:190mm; min-height:270mm; margin:12px auto; padding:7mm; background:#fff; position:relative; box-shadow:0 2px 15px #bbb; }}
    h1 {{ font-size:19px; text-align:center; margin:0 0 13px; letter-spacing:0.5px; }}
    table {{ border-collapse:collapse; width:100%; table-layout:fixed; }}
    td,th {{ border:1px solid #444; padding:5px; vertical-align:top; overflow-wrap:anywhere; }}
    .details {{ display:grid; grid-template-columns:1fr 1fr; border-top:1px solid #444; border-left:1px solid #444; }}
    .details>div {{ padding:7px; min-height:90px; border-right:1px solid #444; border-bottom:1px solid #444; overflow-wrap:anywhere; }}
    .seller {{ font-size:12px; }}
    .label {{ color:#555; font-size:10px; margin-bottom:4px; }}
    .num {{ text-align:right; font-variant-numeric:tabular-nums; }}
    .items th {{ background:#f5f5f5; font-size:10px; text-align:left; }}
    .totals {{ margin-left:auto; width:55%; margin-top:12px; }}
    .totals td:first-child {{ font-weight:600; }}
    .total {{ font-weight:700; background:#f5f5f5; font-size:13px; }}
    .words {{ border:1px solid #444; border-top:0; padding:9px; }}
    .footer {{ display:flex; gap:8px; justify-content:space-between; margin-top:28px; min-height:64px; }}
    .footer>div {{ width:50%; border:1px solid #444; padding:7px; }}
    .signature {{ text-align:right; display:flex; flex-direction:column; justify-content:space-between; }}
    .watermark {{ position:absolute; top:50%; left:7%; transform:rotate(-23deg);font-size:27px;font-weight:700; color:#cd2c2c33; pointer-events:none; }}
    .screen-actions {{ text-align:center; padding:10px; }}
    .screen-actions button {{ padding:8px 16px; background:#24282d; color:#fff; border:0; border-radius:5px; }}
    @media print {{ body {{ background:#fff; }} article {{ width:auto; min-height:auto; padding:0; margin:0; box-shadow:none; }} .screen-actions {{ display:none; }} }}
    </style></head><body>
    <div class="screen-actions"><button onclick="window.print()">Print / Save as PDF</button></div>
    <article>{banner}<h1>TAX INVOICE</h1>
    <section class="details">
      <div class="seller"><strong>{seller_name}</strong><p>{seller_address}</p><p><b>GSTIN:</b> {seller_gstin} &nbsp; <b>State Code:</b> {seller_state}</p></div>
      <div><div class="label">Invoice No.</div><b>{number}</b><p><span class="label">Dated:</span> {invoice_date}</p><p><span class="label">Order Ref:</span> {order_number}</p></div>
      <div><div class="label">Buyer (Bill To)</div><b>{buyer_name}</b><p>{buyer_address}</p><p><b>GSTIN:</b> {buyer_gstin} &nbsp; <b>State Code:</b> {buyer_state}</p></div>
      <div><div class="label">Dispatch / Challan References</div><p>{challans}</p><p><b>Displayed Reference:</b> {display_reference}</p><p><b>Place of Supply:</b> {pos}</p></div>
    </section>
    <table class="items"><thead><tr><th style="width:5%">No.</th><th style="width:30%">Description</th><th style="width:13%">HSN</th><th style="width:10%">Qty m³</th><th style="width:11%">Rate ₹</th><th style="width:8%">GST %</th><th style="width:11%">Taxable ₹</th><th style="width:12%">Total ₹</th></tr></thead><tbody>{items}</tbody></table>
    <table class="totals"><tbody>
      <tr><td>Taxable value</td><td class="num">{subtotal}</td></tr>
      <tr><td>CGST</td><td class="num">{cgst}</td></tr>
      <tr><td>SGST</td><td class="num">{sgst}</td></tr>
      <tr><td>IGST</td><td class="num">{igst}</td></tr>
      <tr class="total"><td>Invoice Total (₹)</td><td class="num">{total}</td></tr>
    </tbody></table>
    <div class="words"><b>Amount in words:</b> {words}</div>
    <div class="footer"><div><b>Remarks</b><p>{note}</p><small>Computer-generated invoice. Subject to applicable jurisdiction and statutory requirements.</small></div>
      <div class="signature"><b>For {seller_name}</b><span>Authorized Signatory</span></div></div>
    </article></body></html>"#,
        banner = banner,
        seller_name = esc(s(seller, "name")),
        seller_address = esc(s(seller, "address")).replace('\n', "<br>"),
        seller_gstin = esc(s(seller, "gstin")),
        seller_state = esc(s(seller, "state_code")),
        number = esc(number),
        invoice_date = esc(s(v, "invoice_date")),
        order_number = esc(s(v, "order_number")),
        buyer_name = esc(s(buyer, "name")),
        buyer_address = esc(s(buyer, "address")).replace('\n', "<br>"),
        buyer_gstin = esc(s(buyer, "gstin")),
        buyer_state = esc(s(buyer, "state_code")),
        challans = challans,
        display_reference = esc(s(v, "challan_display_reference")),
        pos = esc(s(v, "place_of_supply")),
        items = items,
        subtotal = esc(s(v, "subtotal")),
        cgst = esc(s(v, "cgst")),
        sgst = esc(s(v, "sgst")),
        igst = esc(s(v, "igst")),
        total = esc(total),
        words = esc(&inr_words(total)),
        note = esc(s(v, "note")).replace('\n', "<br>")
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn render_is_escaped() {
        let v = serde_json::json!({"seller":{"name":"<script>alert(1)</script>"},"buyer":{},"items":[],"total":"0.00"});
        let result = render(&v, true);
        assert!(!result.contains("<script>"));
        assert!(result.contains("&lt;script&gt;"));
    }
    #[test]
    fn words_are_in_indian_groups() {
        assert_eq!(
            inr_words("2414026.00"),
            "Rupees Twenty Four Lakh Fourteen Thousand Twenty Six Only"
        );
    }
}
