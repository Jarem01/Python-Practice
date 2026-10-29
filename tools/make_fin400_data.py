#!/usr/bin/env python3
"""Create the practice datasets that live in fin400/data/.

The FIN 400 practice exercises in fin400/practice/ are modeled on the skills the
handout's exercises ask for, but they never use the handout's own data: a few of those
files are only reachable from a link, one or two are implied rather than
supplied, and none of them can be committed here. So this script builds a small,
self-contained set instead — same shape, same column names a student will meet
in class, different numbers.

    python3 tools/make_fin400_data.py            # write into fin400/data/
    python3 tools/make_fin400_data.py --verify   # only check what is already there

Every file is deterministic: the same command writes byte-identical output, so
the answers the exercise checks assert against never drift. Standard library
only.

What it writes
--------------
fin400-survey.csv          one row per adult: seqn, age, gender, weight, height,
                           waist, hincome          (BMI analysis, logical indexing)
fin400-stock-panel.csv     ticker/fyear panel: ni, debt_lgterm, mcap, shr
                           (EPS, leverage ratios, groupby medians)
fin400-stock-panel-dupes.csv  the same panel with duplicate ticker-years added
                           (counting and dropping duplicates)
fin400-monthly-stocks.csv  permno/caldt panel: prc, ret, mcap
                           (equal- and value-weight portfolios, lags)
fin400-port-mcap.csv       monthly returns on four market-cap portfolios
fin400-port-beta.csv       monthly returns on ten beta-sorted portfolios
fin400-port-pe.csv         monthly returns on five P/E-sorted portfolios
fin400-factors.csv         monthly market and small-cap returns
fin400-mcap-emp.csv        firm size and employees
fin400-firms.csv           permno -> ticker, sector  (merge practice)
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import math
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "fin400" / "data"
SEED = 20261026

FIRST_MONTH = dt.date(1926, 1, 1)
MONTHS = 120          # ten years of monthly data: 1926-01 .. 1935-12
FIRST_FYEAR = 1980
LAST_FYEAR = 2024

SECTORS = ["Technology", "Financials", "Health Care", "Industrials", "Energy", "Consumer"]


def writer(path: Path, header: list[str]):
    """A csv writer that always uses \\n, so the files are identical everywhere."""
    handle = open(path, "w", encoding="utf-8", newline="")
    out = csv.writer(handle, lineterminator="\n")
    out.writerow(header)
    return handle, out


def money(value: float) -> float:
    return round(float(value) + 1e-9, 2)


def month_dates(count: int) -> list[dt.date]:
    dates = []
    year, month = FIRST_MONTH.year, FIRST_MONTH.month
    for _ in range(count):
        dates.append(dt.date(year, month, 1))
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return dates


# --------------------------------------------------------------------------- #
# fin400-survey.csv — the health-survey file
# --------------------------------------------------------------------------- #

def build_survey(rng: random.Random) -> list[dict]:
    rows = []
    for seqn in range(50001, 50001 + 900):
        age = int(min(84, max(18, rng.gauss(44, 16))))
        male = rng.random() < 0.49
        height = rng.gauss(177.5, 7.4) if male else rng.gauss(163.4, 6.9)
        height = min(203.0, max(145.0, height))
        bmi = min(52.0, max(16.5, rng.gauss(29.0, 6.2)))
        weight = bmi * (height / 100) ** 2
        waist = 0.42 * height + 0.50 * weight - 25.0 + rng.gauss(0, 3.2)
        waist = max(55.0, waist)
        p_high = 0.09 if age < 35 else 0.19
        rows.append({
            "seqn": seqn,
            "age": age,
            "gender": "male" if male else "female",
            "weight": round(weight, 1),
            "height": round(height, 1),
            "waist": round(waist, 1),
            "hincome": "high" if rng.random() < p_high else "not",
        })
    return rows


# --------------------------------------------------------------------------- #
# fin400-stock-panel.csv — the accounting panel
# --------------------------------------------------------------------------- #

def tickers(rng: random.Random, count: int, taken: set[str]) -> list[str]:
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    out = []
    while len(out) < count:
        name = "".join(rng.choice(letters) for _ in range(rng.choice([3, 4])))
        if name not in taken:
            taken.add(name)
            out.append(name)
    return out


def build_panel(rng: random.Random) -> tuple[list[dict], list[int]]:
    taken: set[str] = set()
    rows: list[dict] = []
    for ticker in tickers(rng, 70, taken):
        first = rng.randint(FIRST_FYEAR, 2004)
        size = math.exp(rng.gauss(7.2, 1.35))     # market cap, $ millions
        shares = max(0.5, size / rng.uniform(8.0, 95.0))  # shares outstanding, millions
        leverage_style = rng.choices(["low", "mid", "high", "none"],
                                     weights=[3, 4, 3, 1.2])[0]
        for fyear in range(first, LAST_FYEAR + 1):
            growth = rng.gauss(1.05, 0.22)
            size = max(12.0, size * max(0.35, growth))
            shares = max(0.4, shares * rng.gauss(1.01, 0.05))
            margin = rng.gauss(0.09, 0.09)
            ni = size * margin
            if leverage_style == "none":
                debt = 0.0
            else:
                ratio = {"low": rng.uniform(0.05, 0.25), "mid": rng.uniform(0.25, 0.5),
                         "high": rng.uniform(0.5, 0.85)}[leverage_style]
                ratio = min(0.92, max(0.01, ratio + rng.gauss(0, 0.05)))
                debt = size * ratio / (1 - ratio)
            rows.append({
                "ticker": ticker,
                "fyear": fyear,
                "ni": money(ni),
                "debt_lgterm": money(debt),
                "mcap": money(size),
                "shr": round(shares, 3),
            })
    rows.sort(key=lambda r: (r["ticker"], r["fyear"]))
    # A handful of duplicated ticker-years, so "count and drop the duplicates"
    # is a real task rather than a guaranteed zero.
    duplicated = sorted(rng.sample(range(len(rows)), 12))
    return rows, duplicated


# --------------------------------------------------------------------------- #
# fin400-monthly-stocks.csv — the 1926-1935 stock-month panel
# --------------------------------------------------------------------------- #

def build_monthly(rng: random.Random) -> tuple[list[dict], list[dict]]:
    dates = month_dates(MONTHS)
    taken: set[str] = set()
    names = tickers(rng, 45, taken)
    stocks = []
    for index, ticker in enumerate(names, start=10001):
        stocks.append({
            "permno": index,
            "ticker": ticker,
            "price": rng.uniform(8.0, 90.0),
            "shares": rng.uniform(1.0, 60.0),
            "drift": rng.gauss(0.0006, 0.0022),
            "vol": rng.uniform(0.05, 0.14),
            "last_ret": 0.0,
        })

    rows: list[dict] = []
    for date in dates:
        market = rng.gauss(-0.001, 0.048)
        for stock in stocks:
            # A little momentum: last month's return carries into this one, so a
            # portfolio sorted on the lagged return behaves the way the class
            # discussion says it should.
            ret = (stock["drift"] + 1.05 * market + 0.08 * stock["last_ret"]
                   + rng.gauss(0, stock["vol"]))
            stock["last_ret"] = ret
            stock["price"] = max(0.5, stock["price"] * (1 + ret))
            mcap = stock["price"] * stock["shares"]
            rows.append({
                "permno": stock["permno"],
                "caldt": date.isoformat(),
                "ticker": stock["ticker"],
                "prc": round(stock["price"], 2),
                "ret": round(ret, 6),
                "mcap": round(mcap, 2),
            })

    # The four market-cap portfolios, same dates, so a student can compare a
    # single stock panel with portfolios built from it.
    portfolios: list[dict] = []
    for date in dates:
        market = rng.gauss(0.010, 0.045)
        portfolios.append({
            "caldt": date.isoformat(),
            "micro": round(rng.gauss(0.008, 0.075) + 0.9 * market, 6),
            "small": round(rng.gauss(0.007, 0.060) + 0.95 * market, 6),
            "mid": round(rng.gauss(0.006, 0.048) + 1.0 * market, 6),
            "large": round(rng.gauss(0.005, 0.040) + 1.02 * market, 6),
        })
    return rows, portfolios


# --------------------------------------------------------------------------- #
# factor and portfolio files
# --------------------------------------------------------------------------- #

def build_factors(rng: random.Random) -> tuple[list[dict], list[dict], list[dict]]:
    dates = month_dates(MONTHS)
    factors, beta, pe = [], [], []
    for date in dates:
        mkt = rng.gauss(0.0075, 0.044)
        small = rng.gauss(0.0025, 0.031)
        factors.append({"caldt": date.isoformat(), "mkt": round(mkt, 6), "small": round(small, 6)})
        row = {"caldt": date.isoformat()}
        for j in range(10):
            beta_j = 0.58 + 0.085 * j
            alpha = 0.0004 + 0.00012 * j
            row[f"p{j}"] = round(alpha + beta_j * mkt + rng.gauss(0, 0.012), 6)
        beta.append(row)
        row_pe = {"caldt": date.isoformat()}
        for j in range(5):
            alpha = 0.0012 - 0.0007 * j
            row_pe[f"p{j}"] = round(alpha + (1.05 - 0.05 * j) * mkt + 0.45 * small + rng.gauss(0, 0.011), 6)
        pe.append(row_pe)
    return factors, beta, pe


def build_firms(rng: random.Random) -> tuple[list[dict], list[dict]]:
    taken: set[str] = set()
    firms, mcap_emp = [], []
    for index, name in enumerate(tickers(rng, 600, taken), start=30001):
        sector = rng.choice(SECTORS)
        emp = max(0.05, math.exp(rng.gauss(1.55, 1.15)))      # thousands of employees
        size = 780 + 118 * emp + rng.gauss(0, 900)            # $ millions
        firms.append({"permno": index, "ticker": name, "sector": sector})
        mcap_emp.append({"permno": index, "fyear": 2024,
                         "mcap": money(max(15.0, size)),
                         "emp": round(emp, 3)})
    return firms, mcap_emp


# --------------------------------------------------------------------------- #
# writing and verifying
# --------------------------------------------------------------------------- #

def write_all() -> dict[str, int]:
    OUT.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)
    counts: dict[str, int] = {}

    survey = build_survey(rng)
    handle, out = writer(OUT / "fin400-survey.csv",
                         ["seqn", "age", "gender", "weight", "height", "waist", "hincome"])
    for row in survey:
        out.writerow([row["seqn"], row["age"], row["gender"], row["weight"],
                      row["height"], row["waist"], row["hincome"]])
    handle.close()
    counts["fin400-survey.csv"] = len(survey)

    panel, duplicated = build_panel(rng)
    fields = ["ticker", "fyear", "ni", "debt_lgterm", "mcap", "shr"]
    handle, out = writer(OUT / "fin400-stock-panel.csv", fields)
    for row in panel:
        out.writerow([row[f] for f in fields])
    handle.close()
    counts["fin400-stock-panel.csv"] = len(panel)

    with_dupes = panel + [dict(panel[i]) for i in duplicated]
    with_dupes.sort(key=lambda r: (r["ticker"], r["fyear"]))
    handle, out = writer(OUT / "fin400-stock-panel-dupes.csv", fields)
    for row in with_dupes:
        out.writerow([row[f] for f in fields])
    handle.close()
    counts["fin400-stock-panel-dupes.csv"] = len(with_dupes)

    monthly, portfolios = build_monthly(rng)
    fields = ["permno", "caldt", "ticker", "prc", "ret", "mcap"]
    handle, out = writer(OUT / "fin400-monthly-stocks.csv", fields)
    for row in monthly:
        out.writerow([row[f] for f in fields])
    handle.close()
    counts["fin400-monthly-stocks.csv"] = len(monthly)

    handle, out = writer(OUT / "fin400-port-mcap.csv", ["caldt", "micro", "small", "mid", "large"])
    for row in portfolios:
        out.writerow([row["caldt"], row["micro"], row["small"], row["mid"], row["large"]])
    handle.close()
    counts["fin400-port-mcap.csv"] = len(portfolios)

    factors, beta, pe = build_factors(rng)
    handle, out = writer(OUT / "fin400-factors.csv", ["caldt", "mkt", "small"])
    for row in factors:
        out.writerow([row["caldt"], row["mkt"], row["small"]])
    handle.close()
    counts["fin400-factors.csv"] = len(factors)

    handle, out = writer(OUT / "fin400-port-beta.csv", ["caldt"] + [f"p{j}" for j in range(10)])
    for row in beta:
        out.writerow([row["caldt"]] + [row[f"p{j}"] for j in range(10)])
    handle.close()
    counts["fin400-port-beta.csv"] = len(beta)

    handle, out = writer(OUT / "fin400-port-pe.csv", ["caldt"] + [f"p{j}" for j in range(5)])
    for row in pe:
        out.writerow([row["caldt"]] + [row[f"p{j}"] for j in range(5)])
    handle.close()
    counts["fin400-port-pe.csv"] = len(pe)

    firms, mcap_emp = build_firms(rng)
    handle, out = writer(OUT / "fin400-mcap-emp.csv", ["permno", "fyear", "mcap", "emp"])
    for row in mcap_emp:
        out.writerow([row["permno"], row["fyear"], row["mcap"], row["emp"]])
    handle.close()
    counts["fin400-mcap-emp.csv"] = len(mcap_emp)

    handle, out = writer(OUT / "fin400-firms.csv", ["permno", "ticker", "sector"])
    for row in firms:
        out.writerow([row["permno"], row["ticker"], row["sector"]])
    handle.close()
    counts["fin400-firms.csv"] = len(firms)

    return counts


EXPECTED = {
    "fin400-survey.csv": 900,
    "fin400-stock-panel.csv": None,          # firms start in different years
    "fin400-stock-panel-dupes.csv": None,
    "fin400-monthly-stocks.csv": MONTHS * 45,
    "fin400-port-mcap.csv": MONTHS,
    "fin400-factors.csv": MONTHS,
    "fin400-port-beta.csv": MONTHS,
    "fin400-port-pe.csv": MONTHS,
    "fin400-mcap-emp.csv": 600,
    "fin400-firms.csv": 600,
}


def verify() -> int:
    problems = 0
    for name, expected in EXPECTED.items():
        path = OUT / name
        if not path.exists():
            print(f"MISSING {name}")
            problems += 1
            continue
        with open(path, encoding="utf-8") as handle:
            rows = sum(1 for _ in handle) - 1
        if expected is not None and rows != expected:
            print(f"WRONG   {name}: {rows} rows, expected {expected}")
            problems += 1
        else:
            print(f"ok      {name}: {rows} rows")
    return 1 if problems else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Write the FIN 400 practice datasets")
    parser.add_argument("--verify", action="store_true", help="only check the files that exist")
    args = parser.parse_args()

    if args.verify:
        return verify()

    counts = write_all()
    for name, rows in counts.items():
        print(f"wrote fin400/data/{name}  ({rows} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
