"""A receipt's line shows the price the client paid — VAT included (owner, 2026-10-13: the tattoo showed ₪1,186.44 on
a ₪1,400 receipt)."""
from app.api.invoice_routes import add_prices_with_vat


def test_one_line_is_the_price_paid():
    items = [{"total_price_cents": 118644, "quantity": 1}]
    add_prices_with_vat(items, 21356)
    assert items[0]["total_with_vat_ils"] == 1400.00 and items[0]["unit_with_vat_ils"] == 1400.00


def test_several_lines_add_up_to_the_total_to_the_agora():
    items = [{"total_price_cents": 33333, "quantity": 1}, {"total_price_cents": 33333, "quantity": 2}, {"total_price_cents": 50001, "quantity": 1}]
    vat = round(sum(i["total_price_cents"] for i in items) * 0.18)
    add_prices_with_vat(items, vat)
    total = sum(round(i["total_with_vat_ils"] * 100) for i in items)
    assert total == sum(i["total_price_cents"] for i in items) + vat
    assert items[1]["unit_with_vat_ils"] == round(items[1]["total_with_vat_ils"] / 2, 2)


def test_no_vat_leaves_the_price():
    items = [{"total_price_cents": 50000, "quantity": 1}]
    add_prices_with_vat(items, 0)
    assert items[0]["total_with_vat_ils"] == 500.00
