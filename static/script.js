/* ═══════════════════════════════════════════════════════
   TILAK RAJ AND SONS — Billing System JavaScript
   Full feature parity with the Python/Tkinter desktop app
═══════════════════════════════════════════════════════ */

/* ─── State ────────────────────────────────────────────── */
let items = [];           // current bill items
let selectedInvoiceNo = null;  // selected in history

const HSN = { Gold: "711319", Silver: "711311" };

/* ─── On DOM Ready ─────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
    setStatusDate();
    initTabs();
    onCommodityChange();
    onRevModeChange();
});

/* ─── STATUS DATE ───────────────────────────────────────── */
function setStatusDate() {
    const now = new Date();
    const opts = { weekday: "long", day: "2-digit", month: "long", year: "numeric" };
    document.getElementById("status-date").textContent =
        "📅 " + now.toLocaleDateString("en-IN", opts);
}

/* ─── TABS ──────────────────────────────────────────────── */
function initTabs() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.tab;
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById("tab-" + target).classList.add("active");

            if (target === "history") loadHistory();
            if (target === "reverse") resetReverseCalc();
        });
    });
}

/* ═══════════════════════════════════════════════════════
   BILLING TAB
═══════════════════════════════════════════════════════ */

function onCommodityChange() {
    const com = document.getElementById("commodity").value;
    const hsnMap = { Gold: "711319", Silver: "711311" };
    document.getElementById("hsn").value = hsnMap[com];

    const caratGroup = document.getElementById("carat-group");
    caratGroup.style.display = (com === "Gold") ? "" : "none";

    document.getElementById("live_preview").textContent = "—";
}

function onModeChange() {
    document.getElementById("weight").value = "";
    document.getElementById("amount_input").value = "";
    document.getElementById("live_preview").textContent = "—";
}

function getRatePer10g() {
    const com = document.getElementById("commodity").value;
    if (com === "Gold") {
        return parseFloat(document.getElementById("gold_price").value) || 0;
    } else {
        // Silver: entered per 1000g → convert to per 10g
        return (parseFloat(document.getElementById("silver_price").value) || 0) / 100.0;
    }
}

function getMakingPct() {
    return parseFloat(document.getElementById("making_charges").value) || 0;
}

function livePreviewWeight() {
    const mode = document.querySelector('input[name="input_mode"]:checked').value;
    if (mode !== "Weight") return;
    const w    = parseFloat(document.getElementById("weight").value);
    const rate = getRatePer10g();
    if (!isNaN(w) && w > 0 && rate > 0) {
        const amt = (w / 10) * rate;
        document.getElementById("live_preview").textContent =
            "→ Amount: Rs. " + fmt(amt);
    } else {
        document.getElementById("live_preview").textContent = "—";
    }
}

function livePreviewAmount() {
    const mode = document.querySelector('input[name="input_mode"]:checked').value;
    if (mode !== "Amount") return;
    const amt  = parseFloat(document.getElementById("amount_input").value);
    const rate = getRatePer10g();
    if (!isNaN(amt) && amt > 0 && rate > 0) {
        const w = (amt / rate) * 10;
        document.getElementById("live_preview").textContent =
            "→ Weight: " + w.toFixed(4) + " g";
    } else {
        document.getElementById("live_preview").textContent = "—";
    }
}

function addItem() {
    const com  = document.getElementById("commodity").value;
    const rate = getRatePer10g();
    if (rate <= 0) { showToast("Please enter a valid " + com + " price.", "error"); return; }

    const carat  = (com === "Gold") ? document.getElementById("carat").value : "-";
    let   desc   = document.getElementById("description").value.trim();
    if (!desc)  desc = (com === "Gold") ? carat + " Gold" : "Silver";

    const hsn  = HSN[com];
    const mode = document.querySelector('input[name="input_mode"]:checked').value;

    let weight, amount;
    if (mode === "Weight") {
        weight = parseFloat(document.getElementById("weight").value);
        if (isNaN(weight) || weight <= 0) {
            showToast("Please enter a valid positive weight.", "error"); return;
        }
        amount = (weight / 10) * rate;
    } else {
        amount = parseFloat(document.getElementById("amount_input").value);
        if (isNaN(amount) || amount <= 0) {
            showToast("Please enter a valid positive amount.", "error"); return;
        }
        weight = (amount / rate) * 10;
    }

    items.push({ commodity: com, hsn, description: desc, carat, weight, rate, amount });
    renderItemsTable();
    recalcTotals();

    // clear inputs
    document.getElementById("weight").value       = "";
    document.getElementById("amount_input").value = "";
    document.getElementById("description").value  = "";
    document.getElementById("live_preview").textContent = "—";
}

function removeItem(idx) {
    items.splice(idx, 1);
    renderItemsTable();
    recalcTotals();
}

function renderItemsTable() {
    const tbody = document.getElementById("itemsBody");
    if (items.length === 0) {
        tbody.innerHTML = `<tr class="empty-row" id="emptyRow"><td colspan="9">No items added yet. Add an item above.</td></tr>`;
        return;
    }
    tbody.innerHTML = items.map((it, idx) => `
        <tr>
            <td>${idx + 1}</td>
            <td>${it.commodity}</td>
            <td class="carat-cell">${it.carat}</td>
            <td style="text-align:left; padding-left:12px;">${it.description}</td>
            <td>${it.hsn}</td>
            <td>${it.weight.toFixed(4)}</td>
            <td>${fmtN(it.rate)}</td>
            <td><strong>${fmtN(it.amount)}</strong></td>
            <td><button class="btn-remove" onclick="removeItem(${idx})">🗑 Remove</button></td>
        </tr>
    `).join("");
}

function recalcTotals() {
    const subtotal   = items.reduce((s, i) => s + i.amount, 0);
    const makingPct  = getMakingPct();
    const makingAmt  = subtotal * makingPct / 100;
    const taxable    = subtotal + makingAmt;
    const cgst       = taxable * 0.015;
    const sgst       = taxable * 0.015;
    const gst        = cgst + sgst;
    const grand      = taxable + gst;

    document.getElementById("display_subtotal").textContent = "Rs. " + fmt(subtotal);
    document.getElementById("display_gst").textContent      = "Rs. " + fmt(gst);
    document.getElementById("display_total").textContent    = "Rs. " + fmt(grand);

    return { subtotal, makingPct, makingAmt, cgst, sgst, gst, grand };
}

function clearAll() {
    if (items.length > 0 && !confirm("Clear all items?")) return;
    items = [];
    renderItemsTable();
    recalcTotals();
    document.getElementById("buyer").value          = "";
    document.getElementById("description").value    = "";
    document.getElementById("making_charges").value = "0";
    document.getElementById("live_preview").textContent = "—";
}

function generateInvoice() {
    const buyer = document.getElementById("buyer").value.trim();
    if (!buyer) { showToast("Please enter buyer name.", "error"); return; }
    if (items.length === 0) { showToast("Please add at least one item.", "error"); return; }

    const { subtotal, makingPct, makingAmt, cgst, sgst, gst, grand } = recalcTotals();

    const payload = {
        buyer_name:  buyer,
        items:       items,
        subtotal:    subtotal,
        making_pct:  makingPct,
        making_amt:  makingAmt,
        cgst:        cgst,
        sgst:        sgst,
        gst:         gst,
        grand_total: grand
    };

    showToast("Generating invoice...");

    fetch("/save_invoice", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) {
            showToast("Error: " + data.error, "error");
        } else {
            showToast("✅ Invoice " + data.invoice_no + " saved! PDF downloading...", "success");
            // Trigger PDF download
            window.location.href = "/download_pdf/" + encodeURIComponent(data.invoice_no);
            clearAll();
        }
    })
    .catch(err => showToast("Network error: " + err, "error"));
}


/* ═══════════════════════════════════════════════════════
   HISTORY TAB
═══════════════════════════════════════════════════════ */

function loadHistory(search = "") {
    const url = search ? `/get_invoices?search=${encodeURIComponent(search)}` : "/get_invoices";
    fetch(url)
        .then(r => r.json())
        .then(data => renderHistoryTable(data.invoices || []))
        .catch(() => showToast("Could not load history.", "error"));
}

function searchInvoices() {
    const q = document.getElementById("search_input").value.trim();
    loadHistory(q);
}

function renderHistoryTable(invoices) {
    const tbody = document.getElementById("historyBody");
    if (invoices.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No invoices found.</td></tr>`;
        return;
    }
    tbody.innerHTML = invoices.map(inv => `
        <tr onclick="selectInvoice('${inv.invoice_no}', this)" style="cursor:pointer;" data-inv="${inv.invoice_no}">
            <td><strong>${inv.invoice_no}</strong></td>
            <td>${inv.buyer_name}</td>
            <td>${inv.date}</td>
            <td>${fmtN(inv.subtotal)}</td>
            <td>${fmtN(inv.gst)}</td>
            <td><strong>${fmtN(inv.grand_total)}</strong></td>
            <td><button class="btn-remove" style="background:var(--btn-blue);"
                onclick="event.stopPropagation(); reprintInvoiceNo('${inv.invoice_no}')">🖨 Reprint</button></td>
        </tr>
    `).join("");
}

function selectInvoice(invoiceNo, rowEl) {
    selectedInvoiceNo = invoiceNo;

    // Highlight row
    document.querySelectorAll("#historyBody tr").forEach(r => r.classList.remove("history-row-selected"));
    rowEl.classList.add("history-row-selected");

    document.getElementById("selected_invoice_no").textContent = invoiceNo;
    document.getElementById("items-section-header").style.display = "";
    document.getElementById("invoice-items-card").style.display  = "";

    fetch("/get_invoice_items/" + encodeURIComponent(invoiceNo))
        .then(r => r.json())
        .then(data => renderInvoiceItems(data.items || []))
        .catch(() => showToast("Could not load items.", "error"));
}

function renderInvoiceItems(itemsList) {
    const tbody = document.getElementById("invoiceItemsBody");
    if (itemsList.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No items found.</td></tr>`;
        return;
    }
    tbody.innerHTML = itemsList.map((it, idx) => `
        <tr>
            <td>${it.commodity}</td>
            <td class="carat-cell">${it.carat || "-"}</td>
            <td style="text-align:left; padding-left:12px;">${it.description}</td>
            <td>${it.hsn}</td>
            <td>${parseFloat(it.weight).toFixed(4)}</td>
            <td>${fmtN(it.rate)}</td>
            <td><strong>${fmtN(it.amount)}</strong></td>
        </tr>
    `).join("");
}

function reprintInvoice() {
    if (!selectedInvoiceNo) { showToast("Please select an invoice first.", "error"); return; }
    reprintInvoiceNo(selectedInvoiceNo);
}

function reprintInvoiceNo(invoiceNo) {
    showToast("Generating reprint PDF...");
    fetch("/reprint_invoice/" + encodeURIComponent(invoiceNo), { method: "POST" })
        .then(r => r.json())
        .then(data => {
            if (data.error) { showToast("Error: " + data.error, "error"); return; }
            showToast("✅ Reprint ready. Downloading...", "success");
            window.location.href = "/download_pdf/" + encodeURIComponent(invoiceNo) + "?reprint=1";
        })
        .catch(() => showToast("Network error.", "error"));
}


/* ═══════════════════════════════════════════════════════
   REVERSE CALCULATOR TAB
═══════════════════════════════════════════════════════ */

const GST_RATE = 0.03;

function onRevModeChange() {
    const mode = document.querySelector('input[name="rev_mode"]:checked').value;

    // "Final Amount" field: shown for Gold/Silver, hidden for Both
    document.getElementById("rev-final-group").style.display =
        (mode === "Both") ? "none" : "";

    // Gold section visibility
    document.getElementById("rev-gold-section").style.display =
        (mode === "Silver") ? "none" : "";

    // Silver section visibility
    document.getElementById("rev-silver-section").style.display =
        (mode === "Gold") ? "none" : "";

    // Per-section amount fields (only shown in "Both" mode)
    document.getElementById("rev-gold-amount-group").style.display =
        (mode === "Both") ? "" : "none";
    document.getElementById("rev-silver-amount-group").style.display =
        (mode === "Both") ? "" : "none";

    resetReverseResult();
}

function reverseCalculate() {
    const mode = document.querySelector('input[name="rev_mode"]:checked').value;
    let lines = [];

    try {
        if (mode === "Gold" || mode === "Silver") {
            const final = parseFloat(document.getElementById("rev_final").value);
            if (isNaN(final) || final <= 0) throw new Error("invalid");

            const base  = final / (1 + GST_RATE);
            const gst   = final - base;
            const cgst  = base * 0.015;
            const sgst  = base * 0.015;

            if (mode === "Gold") {
                const rate10 = parseFloat(document.getElementById("rev_g_rate").value);
                if (isNaN(rate10) || rate10 <= 0) throw new Error("invalid rate");
                const weight = (base / rate10) * 10;
                lines = [
                    "  ═══════════════════════════════",
                    "  GOLD REVERSE CALCULATION",
                    "  ═══════════════════════════════",
                    `  Grand Total (paid) : Rs. ${fmt(final)}`,
                    "  ─────────────────────────────",
                    `  Base Value (ex-GST): Rs. ${fmt(base)}`,
                    `  CGST @ 1.5%        : Rs. ${fmt(cgst)}`,
                    `  SGST @ 1.5%        : Rs. ${fmt(sgst)}`,
                    `  Total GST          : Rs. ${fmt(gst)}`,
                    "  ─────────────────────────────",
                    `  Gold Rate / 10g    : Rs. ${fmt(rate10)}`,
                    `  Gold Weight        : ${weight.toFixed(4)} grams`,
                    "  ═══════════════════════════════",
                ];
            } else {
                const rate1k = parseFloat(document.getElementById("rev_s_rate").value);
                if (isNaN(rate1k) || rate1k <= 0) throw new Error("invalid rate");
                const rate10 = rate1k / 100.0;
                const weight = (base / rate10) * 10;
                lines = [
                    "  ═══════════════════════════════",
                    "  SILVER REVERSE CALCULATION",
                    "  ═══════════════════════════════",
                    `  Grand Total (paid) : Rs. ${fmt(final)}`,
                    "  ─────────────────────────────",
                    `  Base Value (ex-GST): Rs. ${fmt(base)}`,
                    `  CGST @ 1.5%        : Rs. ${fmt(cgst)}`,
                    `  SGST @ 1.5%        : Rs. ${fmt(sgst)}`,
                    `  Total GST          : Rs. ${fmt(gst)}`,
                    "  ─────────────────────────────",
                    `  Silver Rate / 1 kg : Rs. ${fmt(rate1k)}`,
                    `  Silver Rate / 10g  : Rs. ${fmt(rate10)}`,
                    `  Silver Weight      : ${weight.toFixed(4)} grams`,
                    "  ═══════════════════════════════",
                ];
            }
        } else {
            // Both
            const gAmt   = parseFloat(document.getElementById("rev_g_amount").value);
            const sAmt   = parseFloat(document.getElementById("rev_s_amount").value);
            const gRate  = parseFloat(document.getElementById("rev_g_rate").value);
            const sRate1k= parseFloat(document.getElementById("rev_s_rate").value);
            if ([gAmt,sAmt,gRate,sRate1k].some(v => isNaN(v) || v <= 0)) throw new Error("invalid");

            const sRate10 = sRate1k / 100.0;

            function reverseOne(amt, rate10) {
                const base   = amt / (1 + GST_RATE);
                const gst    = amt - base;
                const weight = (base / rate10) * 10;
                return { base, gst, weight };
            }

            const g = reverseOne(gAmt, gRate);
            const s = reverseOne(sAmt, sRate10);

            lines = [
                "  ═══════════════════════════════════",
                "  GOLD + SILVER REVERSE CALCULATION",
                "  ═══════════════════════════════════",
                "",
                "  ── GOLD ──────────────────────────",
                `  Amount (incl. GST) : Rs. ${fmt(gAmt)}`,
                `  Base Value         : Rs. ${fmt(g.base)}`,
                `  GST (3%)           : Rs. ${fmt(g.gst)}`,
                `  Rate / 10g         : Rs. ${fmt(gRate)}`,
                `  Gold Weight        : ${g.weight.toFixed(4)} grams`,
                "",
                "  ── SILVER ────────────────────────",
                `  Amount (incl. GST) : Rs. ${fmt(sAmt)}`,
                `  Base Value         : Rs. ${fmt(s.base)}`,
                `  GST (3%)           : Rs. ${fmt(s.gst)}`,
                `  Rate / 1kg         : Rs. ${fmt(sRate1k)}`,
                `  Silver Weight      : ${s.weight.toFixed(4)} grams`,
                "",
                "  ── COMBINED ──────────────────────",
                `  Total Paid         : Rs. ${fmt(gAmt + sAmt)}`,
                `  Total Base         : Rs. ${fmt(g.base + s.base)}`,
                `  Total GST          : Rs. ${fmt(g.gst + s.gst)}`,
                "  ═══════════════════════════════════",
            ];
        }
    } catch(e) {
        showToast("Please fill in all required fields with valid numbers.", "error");
        return;
    }

    const panel = document.getElementById("rev_result");
    panel.style.display = "";
    document.getElementById("rev_result_text").textContent = lines.join("\n");
}

function resetReverseCalc() {
    document.querySelector('input[name="rev_mode"][value="Gold"]').checked = true;
    onRevModeChange();
    document.getElementById("rev_final").value    = "";
    document.getElementById("rev_g_amount").value = "";
    document.getElementById("rev_s_amount").value = "";
    document.getElementById("rev_g_rate").value   = "140000";
    document.getElementById("rev_s_rate").value   = "245000";
    resetReverseResult();
}

function resetReverseResult() {
    document.getElementById("rev_result").style.display = "none";
    document.getElementById("rev_result_text").textContent = "";
}


/* ═══════════════════════════════════════════════════════
   DB RECONNECT (modal)
═══════════════════════════════════════════════════════ */
function reconnectDB() {
    const cfg = {
        host:     document.getElementById("db_host").value,
        port:     document.getElementById("db_port").value,
        user:     document.getElementById("db_user").value,
        password: document.getElementById("db_pass").value,
        database: document.getElementById("db_name").value,
    };
    fetch("/reconnect_db", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(cfg)
    })
    .then(r => r.json())
    .then(data => {
        if (data.ok) {
            document.getElementById("dbModal").style.display = "none";
            showToast("✅ Database connected!", "success");
        } else {
            showToast("Connection failed: " + data.error, "error");
        }
    })
    .catch(() => showToast("Network error.", "error"));
}


/* ═══════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════ */

// Format number with Indian commas to 2 decimal places
function fmt(n) {
    if (isNaN(n)) return "0.00";
    return parseFloat(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Format number without "Rs." prefix (for table cells)
function fmtN(n) {
    return fmt(parseFloat(n));
}

// Toast notification
let toastTimer;
function showToast(msg, type = "") {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast show " + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3800);
}