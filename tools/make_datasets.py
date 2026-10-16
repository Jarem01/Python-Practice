#!/usr/bin/env python3
"""Create the practice datasets that live in materials/datasets/.

Every notebook in this repository opens a data file by name — `violations.csv`,
`invoices.xlsx`, `insurance.csv`, `compustat.csv`, `avocados.txt`, … Those files
are not part of the original repository, so this script builds a complete,
deterministic set of them: the same command always writes byte-identical files,
and the numbers the class notebooks quote (68,841 violations rows, 25,337 of
them with a zip code, a median invoice of $1,949.87, …) come out right.

    python3 tools/make_datasets.py            # write into materials/datasets/
    python3 tools/make_datasets.py --verify   # only check what is already there

`insurance.csv` is the well-known public Medical Cost Personal Dataset
(1,338 rows, most recent copy fetched once and stored here at full size).

The generated files are committed, so you only need to run this again if you
want to change a dataset. Writing the Excel files needs one extra package:

    python3 -m pip install openpyxl

Standard library only otherwise.
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
OUT = ROOT / "materials" / "datasets"
SEED = 20260115


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def writer(path: Path, header: list[str]):
    """A csv writer that always uses \\n, so the files are identical everywhere."""
    handle = open(path, "w", encoding="utf-8", newline="")
    out = csv.writer(handle, lineterminator="\n")
    out.writerow(header)
    return handle, out


def money(value: float) -> float:
    return round(float(value) + 1e-9, 2)


# --------------------------------------------------------------------------- #
# violations.csv — the one Data Analysis 1 and 2 work from
# --------------------------------------------------------------------------- #

COMPANIES = [
    ("Microsoft", "MSFT"), ("Apple", "AAPL"), ("Amazon.com", "AMZN"), ("Alphabet", "GOOGL"),
    ("Meta Platforms", "META"), ("Tesla", "TSLA"), ("NVIDIA", "NVDA"), ("Intel", "INTC"),
    ("Oracle", "ORCL"), ("IBM", "IBM"), ("Salesforce", "CRM"), ("Adobe", "ADBE"),
    ("JPMorgan Chase", "JPM"), ("Bank of America", "BAC"), ("Wells Fargo", "WFC"),
    ("Citigroup", "C"), ("Goldman Sachs", "GS"), ("Morgan Stanley", "MS"),
    ("American Express", "AXP"), ("Capital One", None), ("U.S. Bancorp", "USB"),
    ("PNC Financial", "PNC"), ("Charles Schwab", "SCHW"), ("BlackRock", "BLK"),
    ("Johnson & Johnson", "JNJ"), ("Pfizer", "PFE"), ("Merck", "MRK"), ("AbbVie", "ABBV"),
    ("Eli Lilly", "LLY"), ("Bristol-Myers Squibb", "BMY"), ("Amgen", "AMGN"),
    ("Gilead Sciences", "GILD"), ("Thermo Fisher", "TMO"), ("Medtronic", "MDT"),
    ("Boeing", "BA"), ("Lockheed Martin", "LMT"), ("Northrop Grumman", "NOC"),
    ("Raytheon Technologies", "RTX"), ("General Dynamics", "GD"), ("Honeywell", "HON"),
    ("Caterpillar", "CAT"), ("Deere & Company", "DE"), ("General Electric", "GE"),
    ("General Motors", "GM"), ("Ford Motor", "F"), ("Cummins", "CMI"),
    ("Walmart", "WMT"), ("Target", "TGT"), ("The Kroger Co.", "KR"), ("Costco", "COST"),
    ("Home Depot", "HD"), ("Lowe's", "LOW"), ("Best Buy", "BBY"), ("Macy's", "M"),
    ("Kohl's", None), ("Nordstrom", "JWN"), ("Dollar General", "DG"), ("Dollar Tree", "DLTR"),
    ("Chevron", "CVX"), ("Exxon Mobil", "XOM"), ("ConocoPhillips", "COP"),
    ("Marathon Petroleum", "MPC"), ("Valero Energy", "VLO"), ("Phillips 66", "PSX"),
    ("Duke Energy", "DUK"), ("Dominion Energy", "D"), ("Exelon", "EXC"), ("Southern Company", "SO"),
    ("American Airlines", "AAL"), ("Delta Air Lines", "DAL"), ("United Airlines", "UAL"),
    ("Southwest Airlines", "LUV"), ("FedEx", "FDX"), ("United Parcel Service", "UPS"),
    ("Union Pacific", "UNP"), ("CSX", "CSX"), ("Norfolk Southern", "NSC"),
    ("AT&T", "T"), ("Verizon", "VZ"), ("T-Mobile US", "TMUS"), ("Comcast", "CMCSA"),
    ("Charter Communications", "CHTR"), ("Dish Network", "DISH"),
    ("Walt Disney", "DIS"), ("Netflix", "NFLX"), ("Paramount Global", "PARA"),
    ("Warner Bros. Discovery", "WBD"), ("Fox Corporation", "FOXA"),
    ("Marriott International", "MAR"), ("Hilton Worldwide", "HLT"), ("MGM Resorts", "MGM"),
    ("Starbucks", "SBUX"), ("McDonald's", "MCD"), ("Yum! Brands", "YUM"),
    ("Chipotle Mexican Grill", "CMG"), ("Darden Restaurants", "DRI"),
    ("Procter & Gamble", "PG"), ("Colgate-Palmolive", "CL"), ("Kimberly-Clark", "KMB"),
    ("Kraft Heinz", "KHC"), ("Mondelez International", "MDLZ"), ("General Mills", "GIS"),
    ("PepsiCo", "PEP"), ("Coca-Cola", "KO"), ("Keurig Dr Pepper", "KDP"),
    ("Nike", "NKE"), ("Under Armour", "UAA"), ("VF Corporation", "VFC"),
    ("Whirlpool", "WHR"), ("Stanley Black & Decker", "SWK"), ("3M", "MMM"),
    ("Dow", "DOW"), ("DuPont", "DD"), ("LyondellBasell", "LYB"), ("Eastman Chemical", "EMN"),
    ("Freeport-McMoRan", "FCX"), ("Newmont", "NEM"), ("Nucor", "NUE"),
    ("United States Steel", "X"), ("Cleveland-Cliffs", "CLF"), ("Alcoa", "AA"),
    ("Norfolk Industries", None), ("Cascade Energy Group", None), ("Redwood Financial", None),
    ("Summit Healthcare Partners", None), ("Lakeshore Logistics", None),
    ("Pinnacle Construction", None), ("Ironwood Manufacturing", None),
    ("Bluegrass Foods", None), ("Harbor Point Shipping", None), ("Stonebridge Insurance", None),
    ("Cedar Valley Utilities", None), ("Meridian Analytics", None), ("Copperline Mining", None),
    ("Rosewood Hotels", None), ("Great Plains Grain", None), ("Tidewater Chemicals", None),
    ("Alpine Pharmaceuticals", None), ("Frontier Telecom", None), ("Beacon Retail Group", None),
    ("Vantage Auto Parts", None), ("Silverlake Credit Union", None), ("Northgate Hospital", None),
    ("Prescott Aerospace", None), ("Willow Creek Farms", None), ("Ironclad Security", None),
    ("Kestrel Data Systems", None), ("Lumen Medical Devices", None), ("Onyx Petroleum", None),
    ("Prairie Wind Energy", None), ("Quarry Ridge Cement", None), ("Riverton Steel", None),
    ("Sable Logistics", None), ("Thornfield Textiles", None), ("Ute Pass Beverages", None),
]

AGENCIES = [
    "SEC", "Department of Justice", "Environmental Protection Agency", "OSHA",
    "Equal Employment Opportunity Commission", "Federal Trade Commission",
    "Consumer Financial Protection Bureau", "Department of Labor", "Food and Drug Administration",
    "Internal Revenue Service", "Department of Health and Human Services", "Federal Aviation Administration",
    "Office of the Comptroller of the Currency", "Federal Communications Commission",
    "Securities and Exchange Commission", "Department of Transportation", "Customs and Border Protection",
    "National Labor Relations Board", "Commodity Futures Trading Commission", "Department of Energy",
]

OWNERSHIP = ["publicly traded", "private", "subsidiary", "government", "non-profit"]
OWNERSHIP_WEIGHTS = [46, 28, 15, 6, 5]

CIVIL_CRIMINAL = ["Civil", "Criminal"]
CIVIL_CRIMINAL_WEIGHTS = [82, 18]

#: Rows and exact figures the class notebooks state.
VIOLATIONS_ROWS = 68841
VIOLATIONS_MICROSOFT_ROWS = 5
VIOLATIONS_DEC_PUBLIC_ROWS = 3027
VIOLATIONS_ZIP_ROWS = 25337
VIOLATIONS_ROW_107_PENALTY = "$8,800 "
VIOLATIONS_FIRST_PENALTY = "$45,000 "


def penalty_text(rng: random.Random) -> str:
    roll = rng.random()
    if roll < 0.44:
        return ""
    if roll < 0.78:
        amount = rng.randrange(5_000, 500_000, 500)
    elif roll < 0.93:
        amount = rng.randrange(500_000, 5_000_000, 25_000)
    elif roll < 0.99:
        amount = rng.randrange(5_000_000, 60_000_000, 250_000)
    else:
        amount = rng.randrange(60_000_000, 900_000_000, 1_000_000)
    return f"${amount:,} "


def build_violations() -> list[list[str]]:
    rng = random.Random(SEED)
    order = list(range(VIOLATIONS_ROWS))
    rng.shuffle(order)
    cursor = 0
    microsoft_rows = set(order[cursor:cursor + VIOLATIONS_MICROSOFT_ROWS])
    cursor += VIOLATIONS_MICROSOFT_ROWS
    december_public = set(order[cursor:cursor + VIOLATIONS_DEC_PUBLIC_ROWS])
    cursor += VIOLATIONS_DEC_PUBLIC_ROWS
    with_zip = set(order[cursor:cursor + VIOLATIONS_ZIP_ROWS])

    start = dt.date(2000, 1, 3)
    span = (dt.date(2024, 12, 31) - start).days
    rows: list[list[str]] = []

    for index in range(VIOLATIONS_ROWS):
        company, ticker = COMPANIES[rng.randrange(len(COMPANIES))]
        while company == "Microsoft" and index not in microsoft_rows:
            # Microsoft appears exactly five times, as the notebook states.
            company, ticker = COMPANIES[rng.randrange(len(COMPANIES))]
        if index in microsoft_rows:
            company, ticker = "Microsoft", "MSFT"

        if index in december_public:
            ownership = "publicly traded"
            day = dt.date(rng.randrange(2000, 2025), 12, rng.randrange(1, 28))
        else:
            ownership = rng.choices(OWNERSHIP, weights=OWNERSHIP_WEIGHTS)[0]
            day = start + dt.timedelta(days=rng.randrange(span))
            # The December/publicly-traded count is exact: no other row may add to it.
            while ownership == "publicly traded" and day.month == 12:
                day = start + dt.timedelta(days=rng.randrange(span))

        if index == 107:
            penalty = VIOLATIONS_ROW_107_PENALTY
        elif index == 0:
            penalty = VIOLATIONS_FIRST_PENALTY
        else:
            penalty = penalty_text(rng)

        zip_code = ""
        if index in with_zip:
            zip_code = f"{rng.randrange(1000, 99999):05d}"

        gvkey = f"{rng.randrange(100000, 399999)}" if rng.random() < 0.62 else ""
        if company == "Microsoft":
            ticker, gvkey = "MSFT", "109076"

        rows.append([
            f"V{rng.randrange(1, 999999):06d}",
            company,
            penalty,
            day.isoformat(),
            AGENCIES[rng.randrange(len(AGENCIES))],
            ticker or "",
            gvkey,
            rng.choices(CIVIL_CRIMINAL, weights=CIVIL_CRIMINAL_WEIGHTS)[0],
            ownership,
            zip_code,
            str(day.year),
        ])
    return rows


VIOLATIONS_HEADER = [
    "case_id", "company", "penalty", "date", "agency", "ticker", "gvkey",
    "civil/criminal", "ownership structure", "zip", "year",
]


# --------------------------------------------------------------------------- #
# invoices.xlsx — the one Data Analysis 3 works from
# --------------------------------------------------------------------------- #

#: (PartName, Model, unit price, how often it is bought). Mouse leads by a mile.
PARTS = [
    ("Mouse", "ProMouse X1", 29.99, 9), ("Mouse", "ProMouse X2", 39.99, 6),
    ("Mouse", "ProMouse Wireless", 49.99, 5),
    ("Keyboard", "ProKeyboard K1", 49.99, 4), ("Keyboard", "ProKeyboard K2", 69.99, 3),
    ("Cable", "ProCable USB-C", 12.99, 4), ("Cable", "ProCable HDMI 2m", 9.99, 3),
    ("Webcam", "ProCam 1080", 79.99, 2), ("Headset", "ProSound H3", 119.99, 2),
    ("Router", "ProNet R2", 89.99, 2), ("Dock", "ProDock 12", 179.99, 2),
    ("Printer", "ProPrint 300", 149.99, 2), ("Monitor", "ProView 24", 189.99, 2),
    ("Monitor", "ProView 27", 249.99, 2), ("Storage", "ProStorage 1TB v4.7", 99.99, 2),
    ("Storage", "ProStorage 3TB v4.7", 259.99, 2), ("Tablet", "ProTab 11", 549.99, 1),
    ("Laptop", "ProBook 15", 999.99, 1), ("Laptop", "ProBook 17", 1449.99, 1),
    ("Phone", "ProPhone 7", 799.99, 1), ("Server", "ProServer Rack 8", 259.99, 1),
]
PARTS_PRICE = {model: price for _part, model, price, _weight in PARTS}
PARTS_WEIGHTS = [weight for _part, _model, _price, weight in PARTS]

INVOICE_ROWS = 5000
INVOICE_MEDIAN = 1949.87
INVOICE_MAX = 1299950.00

#: The bulk July order the notebook investigates, and its invoice number.
JULY_BULK = [
    ("Mouse", "ProMouse X1", 8000),
    ("Keyboard", "ProKeyboard K2", 6000),
    ("Cable", "ProCable USB-C", 10000),
    ("Monitor", "ProView 27", 5000),
]
JULY_BULK_INVOICE = "T13839563"


def build_invoices() -> tuple[list[str], list[list]]:
    """5,000 invoices with an exact median of $1,949.87 and max of $1,299,950.

    The rows are built in three blocks — 2,499 below the median, the two median
    rows, 2,499 above it — so pandas' median lands on exactly $1,949.87 while
    every row still satisfies Amount = Quantity x Price.
    """
    rng = random.Random(SEED + 1)
    half = (INVOICE_ROWS - 2) // 2

    def part_for(rng: random.Random, below: bool) -> tuple[str, str, float]:
        for _ in range(40):
            part = rng.choices(PARTS, weights=PARTS_WEIGHTS, k=1)[0]
            if below and part[2] > 1500:
                continue
            if not below:
                return part[0], part[1], part[2]
            if part[2] < 1600:
                return part[0], part[1], part[2]
        return "Mouse", "ProMouse X1", 29.99

    def make_row(below: bool) -> list:
        while True:
            name, model, price = part_for(rng, below)
            if below:
                limit = max(1, min(40, int(1930 // price)))
                quantity = rng.randrange(1, limit + 1)
            else:
                floor_quantity = int(1950 // price) + 1
                spread = 60 if rng.random() < 0.25 else 6
                ceiling = max(floor_quantity + 1, min(12000, floor_quantity * spread))
                quantity = rng.randrange(floor_quantity, ceiling + 1)
            amount = money(quantity * price)
            if below and amount >= INVOICE_MEDIAN:
                continue
            if not below and amount <= INVOICE_MEDIAN:
                continue
            return [name, model, quantity, price, amount]

    rows: list[list] = []
    for index in range(INVOICE_ROWS):
        if index < half:
            rows.append(make_row(True))
        elif index < half + 2:
            rows.append(["Mouse", "ProMouse X1", 1, INVOICE_MEDIAN, INVOICE_MEDIAN])
        else:
            rows.append(make_row(False))

    # The largest invoice of all: 5,000 units of a $259.99 part.
    max_index = INVOICE_ROWS - 1
    rows[max_index] = ["Server", "ProServer Rack 8", 5000, 259.99, INVOICE_MAX]
    # One unusually large July order, 5,000–10,000 units per part. These rows are
    # replaced in place and stay above the median, so the median does not move.
    bulk_indices = list(range(max_index - len(JULY_BULK), max_index))
    for index, (name, model, quantity) in zip(bulk_indices, JULY_BULK):
        price = PARTS_PRICE[model]
        rows[index] = [name, model, quantity, price, money(quantity * price)]
    # A ProStorage purchase in May, the one row Data Analysis 3 looks for.
    rows[half - 1] = ["Storage", "ProStorage 3TB v4.7", 2, 259.99, money(2 * 259.99)]

    start = dt.date(2023, 1, 2)
    span = (dt.date(2024, 12, 20) - start).days
    invoice_ids = [f"T{rng.randrange(10000000, 99999999)}" for _ in range(INVOICE_ROWS)]
    dates = [start + dt.timedelta(days=rng.randrange(span)) for _ in range(INVOICE_ROWS)]
    for index in [*bulk_indices, max_index]:
        dates[index] = dt.date(2024, 7, rng.randrange(3, 27))
        invoice_ids[index] = JULY_BULK_INVOICE
    dates[max_index] = dt.date(2024, 7, 18)
    dates[half - 1] = dt.date(2024, 5, 14)

    high_price_rows = set(rng.sample(range(INVOICE_ROWS), int(round(INVOICE_ROWS * 0.18))))
    out = [
        [
            invoice_ids[index], dates[index], row[0], row[1], row[2], row[3], row[4],
            1 if index in high_price_rows else 0,
        ]
        for index, row in enumerate(rows)
    ]
    return ["InvoiceID", "Date", "PartName", "Model", "Quantity", "Price", "Amount", "High Price"], out


# --------------------------------------------------------------------------- #
# compustat.csv + sic_indnames.csv — Data Analysis 5
# --------------------------------------------------------------------------- #

SIC_INDUSTRIES = {
    "3571": "Computers",
    "6020": "Banks",
    "4924": "Natural Gas Distribution",
    "1040": "Gold and Silver Ores",
    "5812": "Eating Places",
    "3760": "Guided Missiles and Space Vehicles",
    "5411": "Grocery Stores",
    "1311": "Crude Petroleum and Natural Gas",
    "3674": "Semiconductors",
    "7372": "Prepackaged Software",
    "2836": "Biological Products",
    "3711": "Motor Vehicles",
    "4813": "Telephone Communications",
    "4512": "Air Transportation",
    "2000": "Food and Kindred Products",
    "2911": "Petroleum Refining",
    "6798": "Real Estate Investment Trusts",
    "6199": "Finance Services",
    "8062": "General Medical and Surgical Hospitals",
    "2711": "Newspapers",
    "3949": "Sporting and Athletic Goods",
    "2086": "Bottled and Canned Soft Drinks",
    "5311": "Department Stores",
    "7011": "Hotels and Motels",
    "4213": "Trucking",
    "1389": "Oil and Gas Field Services",
    "3826": "Laboratory Analytical Instruments",
    "3841": "Surgical and Medical Instruments",
    "3559": "Special Industry Machinery",
    "5065": "Electronic Parts and Equipment",
}

COMPUSTAT_ROWS_PER_INDUSTRY = 320
COMPUSTAT_OTHER_ROWS = 1200


def build_compustat() -> tuple[list[str], list[list]]:
    rng = random.Random(SEED + 2)
    rows: list[list] = []
    gvkey = 100000

    def firm(rng: random.Random, sic: str) -> None:
        nonlocal gvkey
        gvkey += rng.randrange(3, 40)
        # Size class: most firms are small, a rare few are enormous.
        roll = rng.random()
        if roll < 0.88:
            assets = rng.uniform(90, 7_000)
        elif roll < 0.97:
            assets = rng.uniform(7_000, 30_000)
        else:
            assets = rng.uniform(30_000, 120_000)
        leverage = rng.uniform(0.74, 0.94) if sic in {"6020", "6199"} else rng.uniform(0.18, 0.68)
        liabilities = assets * leverage
        # Market cap is far more skewed than book assets — that is the point of
        # the winsorize/truncate exercise, so most firms stay well under $14bn
        # while a handful of giants dwarf the 99th percentile.
        if roll < 0.88:
            market_cap = assets * rng.uniform(0.3, 1.8)
        elif roll < 0.97:
            market_cap = assets * rng.uniform(0.35, 1.7)
        else:
            market_cap = assets * rng.uniform(1.0, 2.0)
        for year in range(2016, 2025):
            rows.append([
                str(gvkey),
                f"{year}-12-31",
                int(sic),
                round(assets * rng.uniform(0.94, 1.06), 3),
                round(liabilities * rng.uniform(0.96, 1.04), 3),
                round(max(8.0, market_cap * rng.uniform(0.92, 1.08)), 3),
            ])

    for sic in SIC_INDUSTRIES:
        for _ in range(max(4, COMPUSTAT_ROWS_PER_INDUSTRY // 9)):
            firm(rng, sic)
    for _ in range(max(6, COMPUSTAT_OTHER_ROWS // 9)):
        firm(rng, rng.choice([s for s in SIC_INDUSTRIES if s not in {"3571", "6020", "4924", "1040", "5812", "3760", "5411"}]))

    # A handful of mega caps ($1.9tn–$3.3tn), so the maximum really does dwarf
    # the 99th percentile, exactly as the notebook comments describe.
    for factor in (1_900_000, 2_300_000, 2_700_000, 3_000_000, 3_300_000):
        rows[-rng.randrange(1, 40)][5] = round(factor * rng.uniform(0.97, 1.03), 3)

    return ["gvkey", "datadate", "sic", "at", "lt", "mktcap"], rows


def build_sic_names() -> tuple[list[str], list[list]]:
    return ["sic", "industry"], [[int(code), name] for code, name in sorted(SIC_INDUSTRIES.items())]


# --------------------------------------------------------------------------- #
# earnings.csv / exchange.csv / company_names.csv — Data Analysis 4
# --------------------------------------------------------------------------- #

TICKERS = [
    ("AAPL", "Apple Inc"), ("MSFT", "Microsoft Corp"), ("AMZN", "Amazon.com Inc"),
    ("GOOGL", "Alphabet Inc"), ("META", "Meta Platforms Inc"), ("TSLA", "Tesla Inc"),
    ("NVDA", "NVIDIA Corp"), ("INTC", "Intel Corp"), ("ORCL", "Oracle Corp"),
    ("IBM", "International Business Machines"), ("CRM", "Salesforce Inc"),
    ("ADBE", "Adobe Inc"), ("JPM", "JPMorgan Chase & Co"), ("BAC", "Bank of America Corp"),
    ("WFC", "Wells Fargo & Co"), ("C", "Citigroup Inc"), ("GS", "Goldman Sachs Group"),
    ("MS", "Morgan Stanley"), ("AXP", "American Express Co"), ("BLK", "BlackRock Inc"),
    ("JNJ", "Johnson & Johnson"), ("PFE", "Pfizer Inc"), ("MRK", "Merck & Co"),
    ("ABBV", "AbbVie Inc"), ("LLY", "Eli Lilly & Co"), ("AMGN", "Amgen Inc"),
    ("TMO", "Thermo Fisher Scientific"), ("MDT", "Medtronic PLC"),
    ("BA", "Boeing Co"), ("LMT", "Lockheed Martin Corp"), ("RTX", "RTX Corp"),
    ("GD", "General Dynamics Corp"), ("HON", "Honeywell International"),
    ("CAT", "Caterpillar Inc"), ("DE", "Deere & Co"), ("GE", "General Electric Co"),
    ("GM", "General Motors Co"), ("F", "Ford Motor Co"), ("WMT", "Walmart Inc"),
    ("TGT", "Target Corp"), ("COST", "Costco Wholesale Corp"), ("HD", "Home Depot Inc"),
    ("LOW", "Lowe's Companies Inc"), ("CVX", "Chevron Corp"), ("XOM", "Exxon Mobil Corp"),
    ("COP", "ConocoPhillips"), ("DUK", "Duke Energy Corp"), ("SO", "Southern Co"),
    ("DAL", "Delta Air Lines Inc"), ("UAL", "United Airlines Holdings"),
    ("FDX", "FedEx Corp"), ("UPS", "United Parcel Service"), ("UNP", "Union Pacific Corp"),
    ("T", "AT&T Inc"), ("VZ", "Verizon Communications"), ("TMUS", "T-Mobile US Inc"),
    ("CMCSA", "Comcast Corp"), ("DIS", "Walt Disney Co"), ("NFLX", "Netflix Inc"),
    ("SBUX", "Starbucks Corp"), ("MCD", "McDonald's Corp"), ("PG", "Procter & Gamble Co"),
    ("KO", "Coca-Cola Co"), ("PEP", "PepsiCo Inc"), ("NKE", "Nike Inc"),
    ("MMM", "3M Co"), ("DOW", "Dow Inc"), ("FCX", "Freeport-McMoRan Inc"),
]

EXCHANGES = [
    ("NASDAQ", "Nasdaq Stock Market"), ("NYSE", "New York Stock Exchange"),
    ("AMEX", "NYSE American"),
]


def build_earnings() -> tuple[list[str], list[list]]:
    rng = random.Random(SEED + 3)
    rows: list[list] = []
    for ticker, _name in TICKERS:
        base_eps = rng.uniform(-1.4, 6.5)
        base_revenue = rng.uniform(900, 90_000)
        for quarter in range(8):
            year = 2022 + quarter // 4
            month = (quarter % 4) * 3 + 3
            rows.append([
                ticker,
                f"{year}-{month:02d}-30",
                round(base_eps * rng.uniform(0.82, 1.2), 2),
                round(base_revenue * rng.uniform(0.9, 1.12), 1),
            ])
    return ["ticker", "fpe", "eps", "revenue"], rows


def build_exchange() -> tuple[list[str], list[list]]:
    rng = random.Random(SEED + 4)
    rows = []
    for index, (ticker, _name) in enumerate(TICKERS):
        code, name = EXCHANGES[index % len(EXCHANGES)]
        rows.append([ticker, code, name, rng.choice(["US", "US", "US", "CA"])])
    return ["ticker", "exchg", "exchange", "country"], rows


def build_company_names() -> tuple[list[str], list[list]]:
    rng = random.Random(SEED + 5)
    rows = []
    for index, (ticker, name) in enumerate(TICKERS):
        rows.append([ticker, name, f"{rng.randrange(1, 999999999):09d}", f"{index // 4 + 1}"])
    return ["tic", "conm", "cusip", "sic"], rows


def build_degrees(part: int) -> tuple[list[str], list[list]]:
    rng = random.Random(SEED + 6 + part)
    majors = [
        ("Petroleum Engineering", "Engineering", 94_500, 176_900, 88),
        ("Operations Research", "Engineering", 84_800, 173_600, 71),
        ("Actuarial Mathematics", "Mathematics", 79_700, 160_700, 100),
        ("Computer Science", "Computing", 78_300, 155_900, 62),
        ("Electrical Engineering", "Engineering", 76_900, 153_600, 94),
        ("Chemical Engineering", "Engineering", 75_800, 151_400, 92),
        ("Statistics", "Mathematics", 74_500, 149_700, 100),
        ("Aerospace Engineering", "Engineering", 74_200, 148_900, 91),
        ("Public Accounting", "Business", 72_100, 145_600, 21),
        ("Economics", "Business", 69_800, 142_100, 33),
        ("Finance", "Business", 68_400, 139_800, 28),
        ("Nursing", "Health", 67_200, 138_400, 32),
        ("Management Information Systems", "Computing", 66_800, 137_900, 64),
        ("Construction Management", "Engineering", 65_900, 136_500, 55),
        ("Accounting", "Business", 64_300, 134_700, 19),
        ("Mechanical Engineering", "Engineering", 64_100, 133_200, 95),
        ("Biomedical Engineering", "Engineering", 63_400, 132_600, 97),
        ("Civil Engineering", "Engineering", 62_800, 131_400, 92),
        ("Mathematics", "Mathematics", 62_100, 130_800, 87),
        ("Supply Chain Management", "Business", 61_400, 129_600, 41),
        ("Computer Engineering", "Engineering", 60_900, 128_700, 96),
        ("Marketing", "Business", 55_100, 124_300, 12),
        ("Information Systems", "Computing", 54_800, 123_800, 58),
        ("Political Science", "Humanities", 52_600, 121_400, 7),
        ("Business Administration", "Business", 51_900, 120_600, 15),
        ("Biology", "Science", 50_100, 119_300, 62),
        ("Chemistry", "Science", 49_400, 118_700, 84),
        ("Advertising", "Communications", 48_300, 117_600, 11),
        ("Philosophy", "Humanities", 47_100, 116_400, 4),
        ("Communications", "Communications", 45_600, 114_200, 9),
        ("Psychology", "Social Science", 44_300, 112_800, 15),
        ("Sociology", "Social Science", 42_500, 110_600, 8),
        ("Biology Education", "Education", 41_900, 109_400, 41),
        ("History", "Humanities", 41_200, 108_700, 5),
        ("English", "Humanities", 40_800, 107_900, 3),
        ("Animal Science", "Science", 39_700, 106_300, 46),
        ("Criminal Justice", "Social Science", 38_900, 105_600, 12),
        ("Education", "Education", 38_400, 104_900, 9),
        ("Health Administration", "Health", 38_100, 104_200, 18),
        ("Social Work", "Social Science", 36_800, 102_400, 6),
    ]
    per_file = len(majors) // 2
    chunk = majors[part * per_file: part * per_file + per_file]
    rows = []
    for offset, (major, degree, early, mid, stem) in enumerate(chunk):
        rows.append([
            part * per_file + offset + 1,
            major,
            degree,
            early + rng.randrange(-400, 401, 100),
            mid + rng.randrange(-700, 701, 100),
            stem,
        ])
    return ["Rank", "Major", "Degree", "Early Career Pay", "Mid Career Pay", "% STEM"], rows


# --------------------------------------------------------------------------- #
# avocados.txt — Intro to Python 3
# --------------------------------------------------------------------------- #

def build_avocados() -> str:
    rng = random.Random(SEED + 8)
    lines = ["Date|AveragePrice"]
    price = 1.24
    day = dt.date(2015, 1, 1)
    end = dt.date(2018, 3, 1)
    while day <= end:
        price = min(2.75, max(0.72, price + rng.uniform(-0.05, 0.052)))
        lines.append(f"{day.month}/{day.day}/{day.year}|{price:.2f}")
        day += dt.timedelta(days=1)
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# store_sales.csv — a bigger, everyday dataset for practice exercises
# --------------------------------------------------------------------------- #

def build_store_sales() -> tuple[list[str], list[list]]:
    rng = random.Random(SEED + 9)
    regions = ["West", "Midwest", "South", "Northeast"]
    products = [
        ("Widget", 9.99), ("Gadget", 24.50), ("Doohickey", 4.75), ("Gizmo", 15.00),
        ("Sprocket", 32.25), ("Cog", 7.50), ("Bracket", 12.40), ("Lever", 19.95),
    ]
    reps = ["Avery", "Blair", "Casey", "Devon", "Emery", "Finley", "Harper", "Jordan", "Kai", "Rowan"]
    rows = []
    for month_index in range(36):
        year = 2024 + month_index // 12
        month = month_index % 12 + 1
        for region in regions:
            for product, price in products:
                quantity = max(0, int(rng.gauss(140, 60)))
                if quantity == 0:
                    continue
                rows.append([
                    f"{year}-{month:02d}",
                    region,
                    product,
                    price,
                    quantity,
                    money(price * quantity),
                    rng.choice(reps),
                ])
    return ["month", "region", "product", "unit_price", "units", "revenue", "sales_rep"], rows


# --------------------------------------------------------------------------- #
# analyticskit.py — the helper module Data Analysis 5 imports
# --------------------------------------------------------------------------- #

#: A raw literal: the module contains escape sequences of its own ("\t\n" in
#: _cell_xml), and those must land in the written file exactly as written.
ANALYTICSKIT = r'''"""Small helpers used in the Data Analysis notebooks.

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
'''


# --------------------------------------------------------------------------- #
# writing
# --------------------------------------------------------------------------- #

def write_excel(path: Path, header: list[str], rows: list[list]) -> None:
    from openpyxl import Workbook  # imported here so --verify needs no package

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "data"
    sheet.append(header)
    for row in rows:
        sheet.append(list(row))
    from openpyxl.styles import Font

    for cell in sheet[1]:
        cell.font = Font(bold=True)
    widths = {"InvoiceID": 12, "Date": 12, "PartName": 12, "Model": 24, "Quantity": 10, "Price": 10, "Amount": 13, "High Price": 11}
    for index, name in enumerate(header, start=1):
        sheet.column_dimensions[sheet.cell(row=1, column=index).column_letter].width = widths.get(name, 12)
    for row in sheet.iter_rows(min_row=2, min_col=2, max_col=2):
        for cell in row:
            cell.number_format = "yyyy-mm-dd"
    workbook.save(path)


# --------------------------------------------------------------------------- #
# verification — every figure the class notebooks quote, checked
# --------------------------------------------------------------------------- #

def verify() -> int:
    """Check the generated files against the numbers the notebooks quote."""
    import pandas as pd  # imported late so writing needs only the standard library

    failures: list[str] = []

    def check(label: str, ok: bool, detail: str = "") -> None:
        print(f"  {'ok  ' if ok else 'FAIL'} {label}{'' if ok else f'  ({detail})'}")
        if not ok:
            failures.append(label)

    # The helper module is written from a literal in this file, so a stray escape
    # sequence would ship broken code into every notebook that imports it.
    kit = (ROOT / "materials" / "analyticskit.py").read_text(encoding="utf-8")
    try:
        compile(kit, "analyticskit.py", "exec")
        check("analyticskit.py compiles", True)
    except SyntaxError as error:
        check("analyticskit.py compiles", False, f"line {error.lineno}: {error.msg}")

    violations = pd.read_csv(OUT / "violations.csv", parse_dates=["date"], dtype={"zip": str, "gvkey": str})
    check("violations.csv has 68,841 rows and 11 columns", violations.shape == (68841, 11), str(violations.shape))
    check("25,337 rows have a zip code", int(violations["zip"].notna().sum()) == 25337, str(violations["zip"].notna().sum()))
    check("Microsoft has exactly 5 rows", int((violations["company"] == "Microsoft").sum()) == 5)
    public_december = violations[(violations["ownership structure"] == "publicly traded") & (violations["date"].dt.month == 12)]
    check("3,027 publicly traded rows in December", len(public_december) == 3027, str(len(public_december)))
    check("row 107 (the 108th) has an $8,800 penalty", violations.loc[107, "penalty"] == "$8,800 ", repr(violations.loc[107, "penalty"]))
    raw = pd.read_csv(OUT / "violations.csv", usecols=["penalty"], dtype=str)["penalty"]
    check("the first penalty is '$45,000 ' (the astype(float) exercise)", raw.iloc[0] == "$45,000 ", repr(raw.iloc[0]))
    cleaned = raw.fillna("0").str.strip().str.replace("$", "", regex=False).str.replace(",", "", regex=False).astype(float)
    check("penalties convert to floats after stripping $ and ,", cleaned.notna().all())

    invoices = pd.read_excel(OUT / "invoices.xlsx")
    check("invoices.xlsx opens with 5,000 rows and 8 columns", invoices.shape == (5000, 8), str(invoices.shape))
    check("the maximum amount is $1,299,950.00", money(invoices["Amount"].max()) == INVOICE_MAX, str(invoices["Amount"].max()))
    check("the median amount is $1,949.87", money(invoices["Amount"].median()) == INVOICE_MEDIAN, str(invoices["Amount"].median()))
    check("the most common PartName is Mouse", invoices["PartName"].value_counts().idxmax() == "Mouse", invoices["PartName"].value_counts().idxmax())
    check("18% of rows have High Price = 1", abs(invoices["High Price"].mean() - 0.18) < 0.001, str(invoices["High Price"].mean()))
    check("Date is a real datetime column", str(invoices["Date"].dtype).startswith("datetime"), str(invoices["Date"].dtype))
    may_storage = invoices[(invoices["Date"].dt.month == 5) & (invoices["Model"] == "ProStorage 3TB v4.7")]
    check("a May ProStorage 3TB v4.7 row exists", len(may_storage) >= 1, str(len(may_storage)))
    july_bulk = invoices[(invoices["InvoiceID"] == JULY_BULK_INVOICE) & (invoices["Date"].dt.month == 7)]
    check("July has the 5,000–10,000 unit invoice", len(july_bulk) >= 4 and july_bulk["Quantity"].min() >= 5000, str(len(july_bulk)))
    monthly = invoices.groupby(invoices["Date"].dt.month)["Amount"].max()
    check("the monthly maximum jumps highest in July", int(monthly.idxmax()) == 7, str(monthly.idxmax()))

    insurance = pd.read_csv(OUT / "insurance.csv")
    check("insurance.csv has the 1,338-row public dataset", insurance.shape == (1338, 7), str(insurance.shape))
    check("average age is about 39.2", abs(insurance["age"].mean() - 39.2) < 0.1, str(round(insurance["age"].mean(), 2)))
    check("about 50.5% are male", abs((insurance["sex"] == "male").mean() - 0.505) < 0.005, str(round((insurance["sex"] == "male").mean(), 3)))
    check("about 20.5% are smokers", abs((insurance["smoker"] == "yes").mean() - 0.205) < 0.005, str(round((insurance["smoker"] == "yes").mean(), 3)))

    compustat = pd.read_csv(OUT / "compustat.csv", parse_dates=["datadate"])
    names = pd.read_csv(OUT / "sic_indnames.csv")
    merged = compustat.merge(names, on="sic", how="left")
    wanted = {3571, 6020, 4924, 1040, 5812, 3760, 5411}
    check("compustat covers every industry the notebook filters on", wanted.issubset(set(compustat["sic"])), str(sorted(wanted - set(compustat["sic"]))))
    check("the merge gives every row an industry name", merged["industry"].notna().all())
    check("mktcap has a heavy right tail", compustat["mktcap"].max() > 8 * compustat["mktcap"].quantile(0.99))
    check("most market caps are below $14bn", (compustat["mktcap"] < 14000).mean() > 0.8, str(round((compustat["mktcap"] < 14000).mean(), 3)))

    earnings = pd.read_csv(OUT / "earnings.csv", parse_dates=["fpe"])
    exchange = pd.read_csv(OUT / "exchange.csv")
    company = pd.read_csv(OUT / "company_names.csv").rename(columns={"tic": "ticker"})
    joined = earnings.merge(exchange, on="ticker").merge(company, on="ticker")
    check("earnings x exchange x company_names merge on ticker", len(joined) == len(earnings) and len(joined) > 0, str(len(joined)))

    degrees = pd.concat([
        pd.read_csv(OUT / "degrees-that-pay-back-a.csv"),
        pd.read_csv(OUT / "degrees-that-pay-back-b.csv"),
    ], ignore_index=True)
    check("the two degrees files concatenate cleanly", len(degrees) == 40, str(len(degrees)))

    lines = (OUT / "avocados.txt").read_text(encoding="utf-8").splitlines()
    in_2017 = [line for line in lines[1:] if "/2017" in line]
    check("avocados.txt has a full year of 2017 prices", len(in_2017) == 365, str(len(in_2017)))
    check("each avocados line splits on '|' into a date and a price", all(len(line.split("|")) == 2 for line in in_2017))

    store = pd.read_csv(OUT / "store_sales.csv")
    check("store_sales.csv is a comprehensive practice set", len(store) > 1000 and store["revenue"].sum() > 0, str(len(store)))

    if failures:
        print(f"\n{len(failures)} check(s) failed.")
        return 1
    print("\nAll dataset checks passed.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--verify", action="store_true", help="only check the existing files")
    args = parser.parse_args()

    if args.verify:
        return verify()

    OUT.mkdir(parents=True, exist_ok=True)
    made: list[str] = []

    def csv_file(name: str, header: list[str], rows: list[list]) -> None:
        handle, out = writer(OUT / name, header)
        out.writerows(rows)
        handle.close()
        made.append(f"{name} ({len(rows)} rows)")

    csv_file("violations.csv", VIOLATIONS_HEADER, build_violations())
    csv_file("compustat.csv", *build_compustat())
    csv_file("sic_indnames.csv", *build_sic_names())
    csv_file("earnings.csv", *build_earnings())
    csv_file("exchange.csv", *build_exchange())
    csv_file("company_names.csv", *build_company_names())
    csv_file("degrees-that-pay-back-a.csv", *build_degrees(0))
    csv_file("degrees-that-pay-back-b.csv", *build_degrees(1))
    csv_file("store_sales.csv", *build_store_sales())

    (OUT / "avocados.txt").write_text(build_avocados(), encoding="utf-8")
    made.append("avocados.txt (daily prices 2015–2018)")

    header, rows = build_invoices()
    write_excel(OUT / "invoices.xlsx", header, rows)
    made.append(f"invoices.xlsx ({len(rows)} rows)")

    # insurance.csv is the public Medical Cost Personal Dataset. Keep the copy
    # that is already here; only create a placeholder if it is missing.
    insurance = OUT / "insurance.csv"
    if not insurance.exists():
        print("  ! insurance.csv is missing — download the public dataset from")
        print("    https://raw.githubusercontent.com/stedy/Machine-Learning-with-R-datasets/master/insurance.csv")
        return 1

    kit = ROOT / "materials" / "analyticskit.py"
    kit.write_text(ANALYTICSKIT, encoding="utf-8")
    made.append("analyticskit.py (winsorize, truncate, standardize)")

    for entry in made:
        print(f"  wrote materials/datasets/{entry}" if not entry.startswith("analyticskit") else f"  wrote materials/{entry}")

    try:
        return verify()
    except ImportError:
        print("\n(pandas is not installed, so the datasets were written but not verified)")
        return 0


if __name__ == "__main__":
    sys.exit(main())
