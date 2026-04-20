from io import BytesIO
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import white, black

SRC = '/Users/argjendbektesi/Documents/New project/pdf_work/original.pdf'
OUT = '/Users/argjendbektesi/Documents/New project/pdf_work/Mietvertrag_Gewerberaum_geaendert.pdf'

reader = PdfReader(SRC)
writer = PdfWriter()

PAGE_W = 595.28
PAGE_H = 841.89


def top_to_baseline(bottom_from_top: float, nudge: float = 1.2) -> float:
    return PAGE_H - bottom_from_top + nudge


def draw_replacement(c, x0, top, x1, bottom, text, fontsize=12, pad=2, baseline_nudge=1.2):
    # White patch over old text
    rect_x = x0 - pad
    rect_y = PAGE_H - bottom - pad
    rect_w = (x1 - x0) + 2 * pad
    rect_h = (bottom - top) + 2 * pad
    c.setFillColor(white)
    c.setStrokeColor(white)
    c.rect(rect_x, rect_y, rect_w, rect_h, stroke=1, fill=1)

    # New text
    c.setFillColor(black)
    c.setFont('Helvetica', fontsize)
    c.drawString(x0, top_to_baseline(bottom, baseline_nudge), text)


for i, page in enumerate(reader.pages):
    packet = BytesIO()
    c = canvas.Canvas(packet, pagesize=(PAGE_W, PAGE_H))
    edited = False

    # Page 1 edits
    if i == 0:
        edited = True
        # Tenant identity/address line
        draw_replacement(
            c,
            x0=56.69,
            top=170.69,
            x1=470.0,
            bottom=182.69,
            text='Tarik Selim, Vogelweg 3, 51147 Koeln Wahnheide',
            fontsize=12,
        )

        # Start date + term
        draw_replacement(
            c,
            x0=56.69,
            top=758.69,
            x1=560.0,
            bottom=770.69,
            text='1.Das Mietverhältnis beginnt am 15.04.2026 und hat eine Laufzeit von 5 Jahren plus Option.',
            fontsize=12,
        )

        # Clarify that the unit is rented without inventory
        draw_replacement(
            c,
            x0=56.69,
            top=282.69,
            x1=560.0,
            bottom=294.69,
            text='Die Vermietung erfolgt zum Betrieb als italienische Gastronomie ohne Inventar. Der Mieter trägt die',
            fontsize=12,
        )

    # Page 2 edits
    if i == 1:
        edited = True
        # a. Grundmiete
        draw_replacement(
            c,
            x0=132.73,
            top=86.69,
            x1=182.0,
            bottom=98.69,
            text='1.300,00',
            fontsize=12,
        )
        # b. Betriebskosten
        draw_replacement(
            c,
            x0=366.22,
            top=100.69,
            x1=406.0,
            bottom=112.69,
            text='300,00',
            fontsize=12,
        )
        # c. Kaution = 2 x Grundmiete
        draw_replacement(
            c,
            x0=318.84,
            top=114.69,
            x1=369.0,
            bottom=126.69,
            text='2.600,00',
            fontsize=12,
        )

    # Page 3 edits
    if i == 2:
        edited = True
        # Nebenkostenvorauszahlung
        draw_replacement(
            c,
            x0=56.69,
            top=506.69,
            x1=97.0,
            bottom=518.69,
            text='300,00',
            fontsize=12,
        )

    c.save()
    if edited:
        packet.seek(0)
        overlay = PdfReader(packet)
        page.merge_page(overlay.pages[0])
    writer.add_page(page)

with open(OUT, 'wb') as f:
    writer.write(f)

print(OUT)
