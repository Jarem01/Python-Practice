"""Small helpers used in the Data Analysis notebooks.

Imported in class with `from analyticskit import *`, so everything defined here
is meant to be used unqualified. Only the standard library plus pandas/numpy —
which matters because the notebooks also run in the browser, where the Python
runtime ships pandas and numpy but no Excel writers.
"""

from __future__ import annotations

import datetime as _datetime
import math
import numbers
import zipfile
from xml.sax.saxutils import escape as _xml_escape

import numpy as np
import pandas as pd

__all__ = [
    "winsorize",
    "truncate",
    "describe_columns",
    "standardize",
    "to_series",
    "read_excel",
    "to_excel",
]


def to_series(values):
    """Accept a list, a numpy array or a Series and return a Series."""
    if isinstance(values, pd.Series):
        return values
    return pd.Series(values)


def winsorize(values, lower_percentile=0.05, upper_percentile=0.95):
    """Cap a variable at two percentiles, keeping every observation.

    Values below the lower percentile are set to the lower percentile's value and
    values above the upper percentile are set to the upper percentile's value,
    so the sample size never changes.
    """
    series = to_series(values).astype(float)
    low = series.quantile(lower_percentile)
    high = series.quantile(upper_percentile)
    return series.clip(lower=low, upper=high)


def truncate(values, lower_percentile=0.05, upper_percentile=0.95):
    """Drop the observations outside two percentiles.

    Unlike winsorize(), the outliers are removed rather than capped, so the
    result is shorter than the input.
    """
    series = to_series(values).astype(float)
    low = series.quantile(lower_percentile)
    high = series.quantile(upper_percentile)
    return series[(series >= low) & (series <= high)]


def standardize(values):
    """z-scores: (x - mean) / standard deviation."""
    series = to_series(values).astype(float)
    return (series - series.mean()) / series.std(ddof=0)


# --------------------------------------------------------------- Excel I/O --


def read_excel(path, **kwargs):
    """`pd.read_excel()` with an engine that is actually installed.

    Reading an .xlsx needs openpyxl or python-calamine; the in-browser Python
    ships python-calamine but not openpyxl, while a typical class laptop has the
    other way round. Pick whichever is present so the same line works in both.
    """
    if "engine" not in kwargs:
        try:
            import python_calamine  # noqa: F401  (import proves it is installed)

            kwargs["engine"] = "calamine"
        except ImportError:
            pass
    return pd.read_excel(path, **kwargs)


def _column_letters(position):
    """0 -> A, 25 -> Z, 26 -> AA (the spreadsheet column names)."""
    letters = ""
    position += 1
    while position:
        position, remainder = divmod(position - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def _is_blank(value):
    """True for None, NaN and NaT, but never for a string or a timestamp."""
    return value is None or (not isinstance(value, (str, bytes)) and bool(pd.isna(value)))


def _cell_xml(reference, value):
    """One <c> element: numbers as numbers, everything else as inline text."""
    if _is_blank(value):
        return f'<c r="{reference}"/>'
    if isinstance(value, (bool, np.bool_)):
        return f'<c r="{reference}" t="b"><v>{1 if value else 0}</v></c>'
    if isinstance(value, numbers.Number):
        number = float(value)
        if not math.isfinite(number):
            return f'<c r="{reference}"/>'
        if isinstance(value, numbers.Integral):
            return f'<c r="{reference}"><v>{int(value)}</v></c>'
        return f'<c r="{reference}"><v>{number!r}</v></c>'
    if isinstance(value, pd.Timestamp):
        value = value.to_pydatetime()
    if isinstance(value, _datetime.datetime):
        value = value.isoformat(sep=" ")
    elif isinstance(value, (_datetime.date, _datetime.time)):
        value = value.isoformat()
    # Control characters are not legal in XML at all.
    text = _xml_escape("".join(c for c in str(value) if c >= " " or c in "\t\n"))
    return f'<c r="{reference}" t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c>'


def to_excel(frame, path, sheet_name="Sheet1", index=False):
    """Write a DataFrame to a real .xlsx workbook, with no third-party packages.

    pandas' own `to_excel()` needs openpyxl or xlsxwriter; neither is available
    in the in-browser Python. An .xlsx file is only a zip of small XML parts, so
    this builds one directly from the standard library and the file opens in
    Excel, Numbers and LibreOffice like any other workbook.
    """
    if not isinstance(frame, pd.DataFrame):
        raise TypeError("to_excel() expects a pandas DataFrame")

    header = list(frame.columns)
    if index:
        header = [frame.index.name or "index"] + header

    rows = ['<row r="1">' + "".join(_cell_xml(f"{_column_letters(c)}1", name) for c, name in enumerate(header)) + "</row>"]
    for row_number, values in enumerate(frame.itertuples(index=index, name=None), start=2):
        cells = "".join(_cell_xml(f"{_column_letters(c)}{row_number}", value) for c, value in enumerate(values))
        rows.append(f'<row r="{row_number}">{cells}</row>')

    # Excel rejects these characters in a sheet name.
    sheet = "".join(ch for ch in str(sheet_name) if ch not in "[]:*?/\\")
    sheet = (sheet or "Sheet1")[:31]

    parts = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            "</Types>"
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>"
        ),
        "xl/workbook.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f'<sheets><sheet name="{_xml_escape(sheet)}" sheetId="1" r:id="rId1"/></sheets>'
            "</workbook>"
        ),
        "xl/_rels/workbook.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            "</Relationships>"
        ),
        "xl/worksheets/sheet1.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            "<sheetData>" + "".join(rows) + "</sheetData></worksheet>"
        ),
    }

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in parts.items():
            archive.writestr(name, content)
    return path


def describe_columns(frame, columns=None, percentiles=(0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99)):
    """describe() with a friendlier set of percentiles, transposed by default."""
    columns = list(columns) if columns is not None else list(frame.select_dtypes("number").columns)
    return frame[columns].describe(percentiles=list(percentiles)).transpose()
