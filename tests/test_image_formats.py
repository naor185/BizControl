"""The pictures people send are read only as JPEG, PNG, WEBP or GIF (the pre-launch review, 2026-11-07): Pillow reads
many more formats, most of its open advisories are in those other decoders, and the version that fixes them needs a
newer Python than the server's. A picture of payment comes from anyone with the link."""
import io

import pytest
from PIL import Image, UnidentifiedImageError

from app.services.image_store import open_image


def _picture(fmt: str) -> io.BytesIO:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 30, 30)).save(buf, fmt)
    buf.seek(0)
    return buf


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP", "GIF"])
def test_photos_and_screenshots_open(fmt):
    assert open_image(_picture(fmt)).size == (8, 8)


@pytest.mark.parametrize("fmt", ["TIFF", "BMP", "ICO"])
def test_other_formats_are_not_read_at_all(fmt):
    with pytest.raises(UnidentifiedImageError):
        open_image(_picture(fmt))


def test_a_tiff_sent_as_proof_of_payment_is_refused_as_not_a_picture(db_session):
    from app.services import deposit_report

    class _Appt:            # save_proof reads only this before it opens the picture
        payment_verified_at = None
    with pytest.raises(Exception) as e:
        deposit_report.save_proof(db_session, _Appt(), _picture("TIFF").getvalue())
    assert getattr(e.value, "status_code", None) == 400
