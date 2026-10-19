"""CSV export helper shared by the export endpoints and the report service."""

from __future__ import annotations

import csv
import io
from typing import Any, Iterable, Sequence

from fastapi import Response


def csv_bytes(headers: Sequence[str], rows: Iterable[Sequence[Any]]) -> bytes:
    """Render ``rows`` as UTF-8 CSV (with a BOM so Excel opens it correctly)."""
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(headers)
    for row in rows:
        writer.writerow(["" if value is None else value for value in row])
    return buffer.getvalue().encode("utf-8-sig")


def csv_response(*, filename: str, headers: Sequence[str], rows: Iterable[Sequence[Any]]) -> Response:
    """Return a downloadable CSV attachment."""
    return Response(
        content=csv_bytes(headers, rows),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
