"""
Tilak Raj and Sons Jewellers — Flask Billing Backend
=====================================================
Mirrors all features of the Tkinter desktop app:
  • Billing  : save invoice + generate PDF
  • History  : list invoices, search, show items
  • Reprint  : regenerate PDF for any past invoice
  • DB init  : auto-creates DB and tables on first run
"""

import os
import io
import json
from datetime import datetime
from flask import (Flask, render_template, request, jsonify,
                   send_file, abort)
import mysql.connector
from mysql.connector import Error as MySQLError

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.colors import HexColor
    from reportlab.pdfgen import canvas as rl_canvas
except ImportError:
    raise SystemExit("ERROR: Install reportlab →  pip install reportlab")

app = Flask(__name__)

# ── DB config — edit these or POST to /reconnect_db ────────────────────────
DB_CONFIG = {
    "host": os.getenv("MYSQLHOST"),
    "user": os.getenv("MYSQLUSER"),
    "password": os.getenv("MYSQLPASSWORD"),
    "database": os.getenv("MYSQLDATABASE"),
    "port": int(os.getenv("MYSQLPORT", 3306))
}

# Directory where PDFs are stored
PDF_DIR = os.path.join(os.path.dirname(__file__), "invoices")
os.makedirs(PDF_DIR, exist_ok=True)

# Logo image path — place logo.png in static/ folder
LOGO_PATH = os.path.join(os.path.dirname(__file__), "static", "logo.png")


# ═══════════════════════════════════════════════════════════════════════════════
# DATABASE
# ═══════════════════════════════════════════════════════════════════════════════

def get_conn():
    """Return a fresh connection; auto-creates DB + tables if needed."""
    cfg_no_db = {k: v for k, v in DB_CONFIG.items() if k != "database"}
    try:
        tmp = mysql.connector.connect(**cfg_no_db)
        cur = tmp.cursor()
        cur.execute(f"CREATE DATABASE IF NOT EXISTS `{DB_CONFIG['database']}`")
        tmp.commit()
        cur.close()
        tmp.close()
    except MySQLError as e:
        raise ConnectionError(str(e))

    conn = mysql.connector.connect(
        host=DB_CONFIG["host"],
        user=DB_CONFIG["user"],
        password=DB_CONFIG["password"],
        database=DB_CONFIG["database"],
        port=DB_CONFIG["port"],
        connection_timeout=5,
        autocommit=False
    )
    _create_tables(conn)
    return conn


def _create_tables(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS invoices (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            invoice_no  VARCHAR(30) UNIQUE NOT NULL,
            buyer_name  VARCHAR(200) NOT NULL,
            date        DATE NOT NULL,
            subtotal    DECIMAL(12,2) NOT NULL,
            making_pct  DECIMAL(5,2)  NOT NULL DEFAULT 0,
            making_amt  DECIMAL(12,2) NOT NULL DEFAULT 0,
            cgst        DECIMAL(12,2) NOT NULL,
            sgst        DECIMAL(12,2) NOT NULL,
            gst         DECIMAL(12,2) NOT NULL,
            grand_total DECIMAL(12,2) NOT NULL,
            pdf_path    VARCHAR(500)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)
    for sql in [
        "ALTER TABLE invoices ADD COLUMN making_pct DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER subtotal",
        "ALTER TABLE invoices ADD COLUMN making_amt DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER making_pct",
    ]:
        try: cur.execute(sql)
        except MySQLError: pass

    cur.execute("""
        CREATE TABLE IF NOT EXISTS invoice_items (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            invoice_id  INT NOT NULL,
            commodity   VARCHAR(20) NOT NULL,
            hsn         VARCHAR(10) NOT NULL,
            description VARCHAR(200) NOT NULL DEFAULT '',
            carat       VARCHAR(10)  NOT NULL DEFAULT '',
            weight      DECIMAL(10,4) NOT NULL,
            rate        DECIMAL(12,2) NOT NULL,
            amount      DECIMAL(12,2) NOT NULL,
            FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)
    for sql in [
        "ALTER TABLE invoice_items ADD COLUMN description VARCHAR(200) NOT NULL DEFAULT '' AFTER hsn",
        "ALTER TABLE invoice_items ADD COLUMN carat VARCHAR(10) NOT NULL DEFAULT '' AFTER description",
    ]:
        try: cur.execute(sql)
        except MySQLError: pass

    conn.commit()
    cur.close()


def next_invoice_no(cur):
    year   = datetime.now().strftime("%Y")
    prefix = f"TRS{year}"
    cur.execute(
        "SELECT invoice_no FROM invoices WHERE invoice_no LIKE %s ORDER BY id DESC LIMIT 1",
        (f"{prefix}%",)
    )
    row = cur.fetchone()
    num = int(row[0].replace(prefix, "")) + 1 if row else 1
    return f"{prefix}{num:04d}"


# ═══════════════════════════════════════════════════════════════════════════════
# PDF GENERATOR
# ═══════════════════════════════════════════════════════════════════════════════

class PDFGenerator:
    PAGE_W, PAGE_H = A4
    C_GOLD   = HexColor("#DAA520")
    C_DGOLD  = HexColor("#996515")
    C_BROWN  = HexColor("#7B3F00")
    C_HBROWN = HexColor("#5C2E00")
    C_CREAM  = HexColor("#FFF8F0")
    C_OFF    = HexColor("#FFF5E4")
    C_WHITE  = colors.white
    C_BLACK  = colors.black
    C_GREY   = HexColor("#555555")
    C_LTGREY = HexColor("#CCCCCC")
    MARGIN   = 15 * mm

    def generate(self, data: dict, filepath: str):
        c = rl_canvas.Canvas(filepath, pagesize=A4)
        W, H = self.PAGE_W, self.PAGE_H
        M = self.MARGIN
        y = H
        y = self._draw_header(c, W, H, y)
        y = self._draw_invoice_meta(c, W, M, y, data)
        y = self._draw_items_table(c, W, M, y, data["items"], data.get("making_pct", 0))
        self._draw_totals(c, W, M, y, data)
        self._draw_footer(c, W, M)
        c.showPage()
        c.save()
        return filepath

    def _draw_header(self, c, W, H, y):
        band_h = 42 * mm
        c.setFillColor(self.C_HBROWN)
        c.rect(0, H - band_h, W, band_h, fill=1, stroke=0)
        c.setStrokeColor(self.C_GOLD)
        c.setLineWidth(3)
        c.line(0, H - 1.5, W, H - 1.5)
        c.setLineWidth(2)
        c.line(0, H - band_h, W, H - band_h)
        c.setLineWidth(0.8)
        c.line(0, H - band_h + 3.5*mm, W, H - band_h + 3.5*mm)

        # ── Logo images on each side (if logo.png exists) ──
        logo_size = 22 * mm
        logo_y    = H - band_h + (band_h - logo_size) / 2  # vertically centred in band
        if os.path.exists(LOGO_PATH):
            # Left logo
            c.drawImage(LOGO_PATH,
                        self.MARGIN, logo_y,
                        width=logo_size, height=logo_size,
                        preserveAspectRatio=True, mask="auto")
            # Right logo
            c.drawImage(LOGO_PATH,
                        W - self.MARGIN - logo_size, logo_y,
                        width=logo_size, height=logo_size,
                        preserveAspectRatio=True, mask="auto")

        # ── Shop name & details (centred between the two logos) ──
        c.setFillColor(self.C_GOLD)
        c.setFont("Helvetica-Bold", 22)
        c.drawCentredString(W / 2, H - 13*mm, "TILAK RAJ AND SONS JEWELLERS")
        c.setFont("Helvetica", 10)
        c.setFillColor(self.C_CREAM)
        c.drawCentredString(W / 2, H - 20*mm, "Gold  •  Silver  •  Diamond  •  Precious Jewellery")
        c.setFont("Helvetica", 8)
        c.setFillColor(HexColor("#E0C060"))
        c.drawCentredString(W / 2, H - 26*mm, "GSTIN: 07XXXXX1234X1ZX  |  BIS Hallmark Certified")
        c.drawCentredString(W / 2, H - 31*mm, "123, Jewellers Market, Indra Nagar, New Delhi - 110033")
        c.drawCentredString(W / 2, H - 36*mm, "Phone: +91-98100-XXXXX   |   Email: info@tilakrajjewellers.in")
        return H - band_h - 5*mm

    def _draw_invoice_meta(self, c, W, M, y, data):
        usable = W - 2 * M
        box_h  = 24*mm
        lw = usable * 0.56
        c.setFillColor(self.C_OFF)
        c.rect(M, y - box_h, lw, box_h, fill=1, stroke=0)
        c.setStrokeColor(self.C_GOLD)
        c.setLineWidth(0.8)
        c.rect(M, y - box_h, lw, box_h, fill=0, stroke=1)
        c.setFillColor(self.C_HBROWN)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(M + 3*mm, y - 6.5*mm, "BILL TO:")
        c.setFillColor(self.C_BLACK)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(M + 3*mm, y - 13*mm, data["buyer_name"])
        c.setFont("Helvetica", 8)
        c.setFillColor(self.C_GREY)
        c.drawString(M + 3*mm, y - 19*mm, "Valued Customer")

        gap = usable * 0.03
        rx  = M + lw + gap
        rw  = usable - lw - gap
        c.setFillColor(self.C_CREAM)
        c.rect(rx, y - box_h, rw, box_h, fill=1, stroke=0)
        c.setStrokeColor(self.C_GOLD)
        c.rect(rx, y - box_h, rw, box_h, fill=0, stroke=1)
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(self.C_HBROWN)
        c.drawString(rx + 3*mm, y - 6.5*mm, "INVOICE NO:")
        c.setFont("Helvetica-Bold", 12)
        c.setFillColor(self.C_BLACK)
        c.drawString(rx + 3*mm, y - 13*mm, data["invoice_no"])
        c.setFont("Helvetica", 9)
        c.setFillColor(self.C_GREY)
        c.drawString(rx + 3*mm, y - 19.5*mm, f"Date: {data['date']}")

        label_y = y - box_h - 8*mm
        c.setFillColor(self.C_GOLD)
        c.setFont("Helvetica-Bold", 13)
        c.drawCentredString(W / 2, label_y, "★   TAX INVOICE   ★")
        c.setStrokeColor(self.C_GOLD)
        c.setLineWidth(1.5)
        c.line(M, label_y - 3*mm, W - M, label_y - 3*mm)
        return label_y - 7*mm

    def _draw_items_table(self, c, W, M, y, items, making_pct=0):
        usable_w = W - 2 * M
        col_widths = [8*mm, 48*mm, 22*mm, 16*mm, 18*mm, 20*mm, 28*mm, 28*mm]
        scale = usable_w / sum(col_widths)
        col_widths = [cw * scale for cw in col_widths]
        headers = ["#", "Description", "Commodity", "Carat", "HSN", "Wt (g)", "Rate/10g (Rs.)", "Amount (Rs.)"]
        table_w = usable_w
        row_h   = 8.5*mm
        hdr_h   = 9.5*mm

        c.setFillColor(self.C_HBROWN)
        c.rect(M, y - hdr_h, table_w, hdr_h, fill=1, stroke=0)
        c.setStrokeColor(self.C_GOLD)
        c.setLineWidth(1)
        c.rect(M, y - hdr_h, table_w, hdr_h, fill=0, stroke=1)
        c.setFillColor(self.C_GOLD)
        c.setFont("Helvetica-Bold", 7.5)
        x = M
        for h, cw in zip(headers, col_widths):
            c.drawCentredString(x + cw / 2, y - hdr_h + 3.2*mm, h)
            x += cw

        c.setStrokeColor(HexColor("#996515"))
        c.setLineWidth(0.4)
        x = M
        for cw in col_widths[:-1]:
            x += cw
            c.line(x, y - hdr_h, x, y)

        cur_y = y - hdr_h
        for idx, item in enumerate(items):
            bg = self.C_CREAM if idx % 2 == 0 else HexColor("#FFF0D0")
            c.setFillColor(bg)
            c.rect(M, cur_y - row_h, table_w, row_h, fill=1, stroke=0)
            c.setStrokeColor(self.C_LTGREY)
            c.setLineWidth(0.4)
            c.rect(M, cur_y - row_h, table_w, row_h, fill=0, stroke=1)

            # ── Rate/10g and Amount both include making charges ──────────────
            display_rate   = item["rate"] * (1 + making_pct / 100)
            display_amount = item["amount"] * (1 + making_pct / 100)

            carat = item.get("carat", "-") or "-"
            desc  = item.get("description", "")
            vals  = [
                str(idx + 1), desc, item["commodity"], carat,
                item["hsn"], f"{item['weight']:.3f}",
                f"{display_rate:,.2f}", f"{display_amount:,.2f}",
            ]
            c.setFillColor(self.C_BLACK)
            c.setFont("Helvetica", 7.5)
            x = M
            for i, (v, cw) in enumerate(zip(vals, col_widths)):
                centre_cols = {0, 3, 4, 5, 6, 7}
                if i in centre_cols:
                    if i == 3:
                        c.setFillColor(self.C_BROWN)
                        c.setFont("Helvetica-Bold", 7.5)
                    c.drawCentredString(x + cw / 2, cur_y - row_h + 3*mm, v)
                    c.setFillColor(self.C_BLACK)
                    c.setFont("Helvetica", 7.5)
                else:
                    max_chars = max(int(cw / 2.0), 6)
                    if len(v) > max_chars:
                        v = v[:max_chars - 1] + "…"
                    c.drawString(x + 2*mm, cur_y - row_h + 3*mm, v)
                x += cw

            c.setStrokeColor(self.C_LTGREY)
            c.setLineWidth(0.3)
            x = M
            for cw in col_widths[:-1]:
                x += cw
                c.line(x, cur_y - row_h, x, cur_y)
            cur_y -= row_h

        c.setStrokeColor(self.C_HBROWN)
        c.setLineWidth(1.2)
        c.line(M, cur_y, M + table_w, cur_y)
        return cur_y - 5*mm

    def _draw_totals(self, c, W, M, y, data):
        usable  = W - 2 * M
        box_w   = usable * 0.46
        box_x   = W - M - box_w
        line_h  = 7.5*mm
        pad_l   = 4*mm
        pad_r   = 5*mm

        # Subtotal shown here = metal value + making charges
        # This matches the sum of Amount column in the items table
        making_pct = float(data.get("making_pct", 0))
        subtotal_display = data["subtotal"] * (1 + making_pct / 100)

        rows = [
            ("Subtotal (incl. Making Charges)", subtotal_display),
            ("CGST @ 1.5%",                     data["cgst"]),
            ("SGST @ 1.5%",                     data["sgst"]),
        ]
        total_box_h = len(rows) * line_h + 14*mm + 4*mm
        c.setFillColor(self.C_OFF)
        c.rect(box_x, y - total_box_h, box_w, total_box_h, fill=1, stroke=0)
        c.setStrokeColor(self.C_GOLD)
        c.setLineWidth(0.8)
        c.rect(box_x, y - total_box_h, box_w, total_box_h, fill=0, stroke=1)

        cur_y = y - line_h * 0.5
        c.setFont("Helvetica", 9)
        for label, val in rows:
            c.setFillColor(self.C_GREY)
            c.drawString(box_x + pad_l, cur_y, label)
            c.setFillColor(self.C_BLACK)
            c.drawRightString(box_x + box_w - pad_r, cur_y, f"Rs. {val:,.2f}")
            c.setStrokeColor(self.C_LTGREY)
            c.setLineWidth(0.3)
            c.line(box_x + pad_l, cur_y - 2*mm, box_x + box_w - pad_r, cur_y - 2*mm)
            cur_y -= line_h

        gt_h = 13*mm
        c.setFillColor(self.C_HBROWN)
        c.rect(box_x, cur_y - gt_h + 2*mm, box_w, gt_h, fill=1, stroke=0)
        c.setStrokeColor(self.C_GOLD)
        c.setLineWidth(1.5)
        c.rect(box_x, cur_y - gt_h + 2*mm, box_w, gt_h, fill=0, stroke=1)
        mid_y = cur_y - gt_h / 2 + 2*mm
        c.setFillColor(self.C_GOLD)
        c.setFont("Helvetica-Bold", 9.5)
        c.drawString(box_x + pad_l, mid_y, "GRAND TOTAL (Incl. GST)")
        c.setFont("Helvetica-Bold", 10)
        c.drawRightString(box_x + box_w - pad_r, mid_y, f"Rs. {data['grand_total']:,.2f}")

    def _draw_footer(self, c, W, M):
        c.setStrokeColor(self.C_GOLD)
        c.setLineWidth(1)
        c.line(M, 32*mm, W - M, 32*mm)
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(self.C_BROWN)
        c.drawCentredString(W / 2, 27*mm, "Terms & Conditions")
        c.setFont("Helvetica-Oblique", 7.5)
        c.setFillColor(self.C_GREY)
        c.drawCentredString(W / 2, 22*mm,
            "This is a computer-generated invoice and does not require a physical signature.")
        c.drawCentredString(W / 2, 17*mm,
            "Goods once sold will not be taken back. Subject to Delhi jurisdiction.")
        c.setFillColor(self.C_GOLD)
        c.setFont("Helvetica-Bold", 9)
        c.drawCentredString(W / 2, 12*mm, "✦  Thank you for your valued purchase!  ✦")
        c.setFillColor(self.C_GREY)
        c.setFont("Helvetica", 7)
        c.drawCentredString(W / 2, 7*mm,
            "Tilak Raj and Sons Jewellers  |  GSTIN: 07XXXXX1234X1ZX  |  BIS Hallmark Certified")


pdf_gen = PDFGenerator()


# ═══════════════════════════════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/test")
def test():
    return "OK"

# ── Save invoice + generate PDF ─────────────────────────────────────────────
@app.route("/save_invoice", methods=["POST"])
def save_invoice():
    data = request.get_json()
    try:
        conn = get_conn()
        cur  = conn.cursor()

        invoice_no  = next_invoice_no(cur)
        buyer_name  = data["buyer_name"]
        date_str    = datetime.now().strftime("%Y-%m-%d")
        items       = data["items"]
        subtotal    = float(data["subtotal"])
        making_pct  = float(data.get("making_pct", 0))
        making_amt  = float(data.get("making_amt", 0))
        cgst        = float(data["cgst"])
        sgst        = float(data["sgst"])
        gst         = float(data["gst"])
        grand_total = float(data["grand_total"])

        pdf_path = os.path.join(PDF_DIR, f"Invoice_{invoice_no}_{buyer_name.replace(' ','_')}.pdf")

        pdf_data = dict(
            invoice_no=invoice_no,
            buyer_name=buyer_name,
            date=datetime.now().strftime("%d-%m-%Y"),
            items=items,
            subtotal=subtotal,
            making_pct=making_pct, making_amt=making_amt,
            cgst=cgst, sgst=sgst,
            gst=gst, grand_total=grand_total
        )
        pdf_gen.generate(pdf_data, pdf_path)

        cur.execute("""
            INSERT INTO invoices
              (invoice_no, buyer_name, date, subtotal,
               making_pct, making_amt, cgst, sgst, gst, grand_total, pdf_path)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (invoice_no, buyer_name, date_str,
              subtotal, making_pct, making_amt,
              cgst, sgst, gst, grand_total, pdf_path))

        invoice_id = cur.lastrowid
        for it in items:
            cur.execute("""
                INSERT INTO invoice_items
                  (invoice_id, commodity, hsn, description, carat, weight, rate, amount)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """, (invoice_id, it["commodity"], it["hsn"],
                  it.get("description", ""),
                  it.get("carat", ""),
                  float(it["weight"]), float(it["rate"]), float(it["amount"])))

        conn.commit()
        cur.close()
        conn.close()

        return jsonify({"ok": True, "invoice_no": invoice_no, "pdf_path": pdf_path})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Download PDF ─────────────────────────────────────────────────────────────
@app.route("/download_pdf/<invoice_no>")
def download_pdf(invoice_no):
    try:
        conn = get_conn()
        cur  = conn.cursor()
        cur.execute("SELECT pdf_path FROM invoices WHERE invoice_no=%s", (invoice_no,))
        row = cur.fetchone()
        cur.close()
        conn.close()
        if not row or not row[0] or not os.path.exists(row[0]):
            abort(404)
        return send_file(row[0], as_attachment=True,
                         download_name=os.path.basename(row[0]),
                         mimetype="application/pdf")
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── List invoices (history) ──────────────────────────────────────────────────
@app.route("/get_invoices")
def get_invoices():
    search = request.args.get("search", "").strip()
    try:
        conn = get_conn()
        cur  = conn.cursor()
        if search:
            cur.execute("""
                SELECT invoice_no, buyer_name, date, subtotal, gst, grand_total
                FROM invoices WHERE buyer_name LIKE %s ORDER BY id DESC
            """, (f"%{search}%",))
        else:
            cur.execute("""
                SELECT invoice_no, buyer_name, date, subtotal, gst, grand_total
                FROM invoices ORDER BY id DESC
            """)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        invoices = [
            {
                "invoice_no":  r[0],
                "buyer_name":  r[1],
                "date":        str(r[2]),
                "subtotal":    float(r[3]),
                "gst":         float(r[4]),
                "grand_total": float(r[5]),
            }
            for r in rows
        ]
        return jsonify({"invoices": invoices})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Get items for an invoice ─────────────────────────────────────────────────
@app.route("/get_invoice_items/<invoice_no>")
def get_invoice_items(invoice_no):
    try:
        conn = get_conn()
        cur  = conn.cursor()
        cur.execute("""
            SELECT ii.commodity, ii.hsn, ii.description, ii.carat, ii.weight, ii.rate, ii.amount
            FROM invoice_items ii
            JOIN invoices i ON ii.invoice_id = i.id
            WHERE i.invoice_no = %s
        """, (invoice_no,))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        items = [
            {
                "commodity":   r[0],
                "hsn":         r[1],
                "description": r[2],
                "carat":       r[3] or "-",
                "weight":      float(r[4]),
                "rate":        float(r[5]),
                "amount":      float(r[6]),
            }
            for r in rows
        ]
        return jsonify({"items": items})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Reprint invoice ───────────────────────────────────────────────────────────
@app.route("/reprint_invoice/<invoice_no>", methods=["POST"])
def reprint_invoice(invoice_no):
    try:
        conn = get_conn()
        cur  = conn.cursor()
        cur.execute("SELECT * FROM invoices WHERE invoice_no=%s", (invoice_no,))
        rec = cur.fetchone()
        if not rec:
            cur.close()
            conn.close()
            return jsonify({"error": "Invoice not found"}), 404

        # columns: id,invoice_no,buyer_name,date,subtotal,making_pct,making_amt,
        #          cgst,sgst,gst,grand_total,pdf_path
        invoice_no_db = rec[1]
        buyer_name    = rec[2]
        date_obj      = rec[3]
        subtotal      = float(rec[4])
        making_pct    = float(rec[5]) if rec[5] is not None else 0.0
        making_amt    = float(rec[6]) if rec[6] is not None else 0.0
        cgst          = float(rec[7])
        sgst          = float(rec[8])
        gst           = float(rec[9])
        grand_total   = float(rec[10])
        date_str = date_obj.strftime("%d-%m-%Y") if hasattr(date_obj, "strftime") else str(date_obj)

        cur.execute("""
            SELECT commodity, hsn, description, carat, weight, rate, amount
            FROM invoice_items
            WHERE invoice_id = %s
        """, (rec[0],))
        item_rows = cur.fetchall()
        items = [
            dict(commodity=r[0], hsn=r[1], description=r[2],
                 carat=r[3] or "-", weight=float(r[4]),
                 rate=float(r[5]), amount=float(r[6]))
            for r in item_rows
        ]

        pdf_path = os.path.join(PDF_DIR, f"REPRINT_{invoice_no_db}.pdf")
        pdf_data = dict(
            invoice_no=invoice_no_db,
            buyer_name=buyer_name,
            date=date_str,
            items=items,
            subtotal=subtotal,
            making_pct=making_pct, making_amt=making_amt,
            cgst=cgst, sgst=sgst,
            gst=gst, grand_total=grand_total
        )
        pdf_gen.generate(pdf_data, pdf_path)

        cur.execute("UPDATE invoices SET pdf_path=%s WHERE invoice_no=%s",
                    (pdf_path, invoice_no_db))
        conn.commit()
        cur.close()
        conn.close()

        return jsonify({"ok": True, "pdf_path": pdf_path})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Reconnect DB ─────────────────────────────────────────────────────────────
@app.route("/reconnect_db", methods=["POST"])
def reconnect_db():
    global DB_CONFIG
    data = request.get_json()
    new_cfg = {
        "host":     data.get("host", "localhost"),
        "user":     data.get("user", "root"),
        "password": data.get("password", ""),
        "database": data.get("database", "jewellery_db"),
    }
    try:
        DB_CONFIG = new_cfg
        conn = get_conn()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ═══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    # Attempt initial DB connection; on failure the frontend modal handles it
    try:
        c = get_conn(); c.close()
        print("✅ MySQL connected.")
    except Exception as e:
        print(f"⚠️  DB not connected at startup: {e}\n   Use the in-app DB config modal.")
    app.run(debug=True, host="0.0.0.0", port=5000)