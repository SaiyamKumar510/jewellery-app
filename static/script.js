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

    clearPreview();
}

function onModeChange() {
    document.getElementById("weight").value = "";
    document.getElementById("amount_input").value = "";
    clearPreview();
}

function clearPreview() {
    document.getElementById("live_preview").innerHTML = "<span style='color:#aaa;font-style:italic;'>—</span>";
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

/**
 * Compute grand total including making charges + GST (3%) for a given base metal amount.
 * Returns { baseAmt, makingAmt, taxable, gst, grand }
 */
function computeGrand(baseAmt) {
    const makingPct  = getMakingPct();
    const makingAmt  = baseAmt * makingPct / 100;
    const taxable    = baseAmt + makingAmt;
    const gst        = taxable * 0.03;   // 3% GST (CGST 1.5% + SGST 1.5%)
    const grand      = taxable + gst;
    return { baseAmt, makingAmt, makingPct, taxable, gst, grand };
}

/**
 * Given a grand total (amount entered by user), back-calculate the pure base metal value.
 * grand = baseAmt * (1 + makingPct/100) * 1.03
 * => baseAmt = grand / ((1 + makingPct/100) * 1.03)
 */
function baseAmtFromGrand(grand) {
    const makingPct = getMakingPct();
    const divisor   = (1 + makingPct / 100) * 1.03;
    return grand / divisor;
}

function livePreviewWeight() {
    const mode = document.querySelector('input[name="input_mode"]:checked').value;
    if (mode !== "Weight") return;

    const w    = parseFloat(document.getElementById("weight").value);
    const rate = getRatePer10g();

    if (!isNaN(w) && w > 0 && rate > 0) {
        const baseAmt = (w / 10) * rate;
        const breakdown = computeGrand(baseAmt);
        setPreviewHTML(breakdown, w);
    } else {
        clearPreview();
    }
}

function livePreviewAmount() {
    const mode = document.querySelector('input[name="input_mode"]:checked').value;
    if (mode !== "Amount") return;

    const enteredAmt = parseFloat(document.getElementById("amount_input").value);
    const rate       = getRatePer10g();

    if (!isNaN(enteredAmt) && enteredAmt > 0 && rate > 0) {
        // Entered amount is the GRAND TOTAL — back-calculate base metal
        const baseAmt = baseAmtFromGrand(enteredAmt);
        const w       = (baseAmt / rate) * 10;
        const breakdown = computeGrand(baseAmt);
        setPreviewHTML(breakdown, w);
    } else {
        clearPreview();
    }
}

/**
 * Renders a detailed step-by-step breakdown in the live preview box.
 * Shows: Metal Value → + Making charges → + GST → = Grand Total
 */
function setPreviewHTML(breakdown, weightG) {
    const { baseAmt, makingAmt, makingPct, gst, grand } = breakdown;
    const el = document.getElementById("live_preview");

    // Weight line (always shown)
    const wtLine = `<div class="pb-weight">⚖ Weight: ${weightG.toFixed(4)} g</div>`;

    // Base metal row
    const baseRow = `
        <div class="pb-row">
            <span class="pb-label">Metal Value</span>
            <span class="pb-value">Rs. ${fmt(baseAmt)}</span>
        </div>`;

    // Making charges row (only if > 0)
    const makingRow = makingPct > 0 ? `
        <div class="pb-row pb-making">
            <span class="pb-label">+ Making (${makingPct}%)</span>
            <span class="pb-value">Rs. ${fmt(makingAmt)}</span>
        </div>` : `
        <div class="pb-row pb-nil">
            <span class="pb-label">Making Charges</span>
            <span class="pb-value nil">Nil</span>
        </div>`;

    // GST rows — split into CGST 1.5% + SGST 1.5%
    const cgst = gst / 2;
    const sgst = gst / 2;
    const gstRow = `
        <div class="pb-row pb-gst">
            <span class="pb-label">+ CGST (1.5%)</span>
            <span class="pb-value">Rs. ${fmt(cgst)}</span>
        </div>
        <div class="pb-row pb-gst">
            <span class="pb-label">+ SGST (1.5%)</span>
            <span class="pb-value">Rs. ${fmt(sgst)}</span>
        </div>`;

    // Divider + Grand Total
    const totalRow = `
        <div class="pb-divider"></div>
        <div class="pb-row pb-total">
            <span class="pb-label">Grand Total</span>
            <span class="pb-value grand">Rs. ${fmt(grand)}</span>
        </div>`;

    el.innerHTML = `<div class="preview-breakdown">${wtLine}${baseRow}${makingRow}${gstRow}${totalRow}</div>`;
}

function addItem() {
    const com  = document.getElementById("commodity").value;
    const rate = getRatePer10g();
    if (rate <= 0) { showToast("Please enter a valid " + com + " price.", "error"); return; }

    const carat  = (com === "Gold") ? document.getElementById("carat").value : "-";
    let   desc   = document.getElementById("description").value.trim();
    if (!desc)  desc = (com === "Gold") ? carat + " Gold" : "Silver";

    const hsn      = HSN[com];
    const mode     = document.querySelector('input[name="input_mode"]:checked').value;
    const makingPct = getMakingPct();

    let weight, baseAmount, displayAmount, pricePerGram;

    if (mode === "Weight") {
        weight = parseFloat(document.getElementById("weight").value);
        if (isNaN(weight) || weight <= 0) {
            showToast("Please enter a valid positive weight.", "error"); return;
        }
        baseAmount = (weight / 10) * rate;
        // displayAmount = base metal value + making charges (before GST)
        // This is the "item amount" shown in the table
        displayAmount = baseAmount * (1 + makingPct / 100);
        pricePerGram  = displayAmount / weight;  // price per gram incl. making charges
    } else {
        // Amount mode: entered value is the GRAND TOTAL (with making + GST)
        const enteredAmt = parseFloat(document.getElementById("amount_input").value);
        if (isNaN(enteredAmt) || enteredAmt <= 0) {
            showToast("Please enter a valid positive amount.", "error"); return;
        }
        // Strip GST only first to get taxable (metal + making)
        displayAmount = enteredAmt / 1.03;
        // Strip making to get base metal
        baseAmount    = displayAmount / (1 + makingPct / 100);
        weight        = (baseAmount / rate) * 10;
        pricePerGram  = displayAmount / weight;
    }

    items.push({
        commodity:    com,
        hsn,
        description:  desc,
        carat,
        weight,
        rate,             // pure metal rate per 10g
        amount:       baseAmount,        // pure metal value (stored, used for totals)
        displayAmount,                   // metal + making (shown in table)
        makingPct,
        pricePerGram                     // per gram incl. making charges
    });

    renderItemsTable();
    recalcTotals();

    // clear inputs
    document.getElementById("weight").value       = "";
    document.getElementById("amount_input").value = "";
    document.getElementById("description").value  = "";
    clearPreview();
}

function removeItem(idx) {
    items.splice(idx, 1);
    renderItemsTable();
    recalcTotals();
}

function renderItemsTable() {
    const tbody = document.getElementById("itemsBody");
    if (items.length === 0) {
        tbody.innerHTML = `<tr class="empty-row" id="emptyRow"><td colspan="11">No items added yet. Add an item above.</td></tr>`;
        return;
    }
    tbody.innerHTML = items.map((it, idx) => {
        const makingBadge = it.makingPct > 0
            ? `<span class="making-badge">+${it.makingPct}% MC</span>`
            : `<span class="making-badge nil">Nil</span>`;
        return `
        <tr>
            <td>${idx + 1}</td>
            <td>${it.commodity}</td>
            <td class="carat-cell">${it.carat}</td>
            <td style="text-align:left; padding-left:12px;">${it.description}</td>
            <td>${it.hsn}</td>
            <td>${it.weight.toFixed(4)}</td>
            <td>${fmtN(it.rate)}</td>
            <td class="price-per-gram-cell">Rs. ${fmtN(it.pricePerGram)}</td>
            <td>${makingBadge}</td>
            <td><strong class="amount-cell">Rs. ${fmtN(it.displayAmount)}</strong></td>
            <td><button class="btn-remove" onclick="removeItem(${idx})">🗑 Remove</button></td>
        </tr>
    `}).join("");
}

function recalcTotals() {
    // Sum of displayAmount = metal + making charges (pre-GST)
    const taxable    = items.reduce((s, i) => s + i.displayAmount, 0);
    const cgst       = taxable * 0.015;
    const sgst       = taxable * 0.015;
    const gst        = cgst + sgst;
    const grand      = taxable + gst;
    // subtotal for display = pure metal values
    const subtotal   = items.reduce((s, i) => s + i.amount, 0);
    const makingAmt  = taxable - subtotal;

    document.getElementById("display_subtotal").textContent = "Rs. " + fmt(taxable);
    document.getElementById("display_gst").textContent      = "Rs. " + fmt(gst);
    document.getElementById("display_total").textContent    = "Rs. " + fmt(grand);

    return { subtotal, makingAmt, cgst, sgst, gst, grand, taxable };
}

function clearAll() {
    if (items.length > 0 && !confirm("Clear all items?")) return;
    items = [];
    renderItemsTable();
    recalcTotals();
    document.getElementById("buyer").value          = "";
    document.getElementById("description").value    = "";
    document.getElementById("making_charges").value = "0";
    clearPreview();
}

function generateInvoice() {
    const buyer = document.getElementById("buyer").value.trim();
    if (!buyer) { showToast("Please enter buyer name.", "error"); return; }
    if (items.length === 0) { showToast("Please add at least one item.", "error"); return; }

    const { subtotal, makingAmt, cgst, sgst, gst, grand, taxable } = recalcTotals();

    // Use first item's makingPct (or 0). All items share same making charge selection.
    const makingPct = items[0]?.makingPct || 0;

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