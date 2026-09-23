"""Raspa empresas e rotas do deonibus.com.

Saída: data/raw/deonibus/<AAAA-MM-DD>.json — snapshot bruto, sem
geocodificação. É a entrada do build_graph.py.

Educado de propósito: poucos workers, pausa entre requisições, User-Agent
identificável. Só visita /viacao e /viacao/<slug> (permitidos no robots.txt).
"""

import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://deonibus.com"
HEADERS = {"User-Agent": "mapa-onibus-br/0.1 (+https://github.com/danlessa/mapa-onibus-br)"}
WORKERS = 3
PAUSE_S = 1.0
RETRIES = 3

SELECTOR_COMPANIES = "#companies > div > a"
SELECTOR_ROUTES = ".tab-content > article.section-routes > a"
# Metade das viações não tem a lista completa, só "rotas populares":
# /viacao-breda/passagens-de-onibus/sao-paulo-sp-todos-para-bertioga-sp
POPULAR_RE = re.compile(r"^/viacao-[^/]+/passagens-de-onibus/(?P<path>[^/?#]+-para-[^/?#]+)$")
# "Curitiba - PR para São Paulo - SP"
LABEL_RE = re.compile(r"^(?P<o>.+) - (?P<ouf>[A-Z]{2}) para (?P<d>.+) - (?P<duf>[A-Z]{2})$")

OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "deonibus"

session = requests.Session()
session.headers.update(HEADERS)


def get(url: str) -> str:
    for attempt in range(RETRIES):
        try:
            r = session.get(url, timeout=60)
            if r.status_code == 200:
                return r.text
            print(f"HTTP {r.status_code} em {url}", file=sys.stderr)
        except requests.RequestException as e:
            print(f"{e!r} em {url}", file=sys.stderr)
        time.sleep(PAUSE_S * 5 * (attempt + 1))
    raise RuntimeError(f"falhou: {url}")


def list_companies() -> list[dict]:
    soup = BeautifulSoup(get(f"{BASE}/viacao"), "html.parser")
    companies = []
    for a in soup.select(SELECTOR_COMPANIES):
        title = a.select_one(".title")
        img = a.select_one("img")
        companies.append({
            "slug": a["href"].rstrip("/").split("/")[-1].strip().lower(),
            "name": (title.get_text(strip=True) if title else a.get("data-gtm-content-name", "")).strip(),
            "logo": img["src"] if img and img.has_attr("src") else None,
        })
    return companies


def company_routes(slug: str) -> dict:
    time.sleep(PAUSE_S)
    soup = BeautifulSoup(get(f"{BASE}/viacao/{slug}"), "html.parser")
    h1 = soup.find("h1")
    routes = []
    seen = set()
    for a in soup.select(SELECTOR_ROUTES):
        path = a["href"].rstrip("/").split("/")[-1]
        if path in seen:
            continue
        seen.add(path)
        route = {"path": path}
        m = LABEL_RE.match(a.get("data-gtm-content-name", "").strip())
        if m:
            route["origin"] = {"name": m["o"].strip(), "uf": m["ouf"]}
            route["destination"] = {"name": m["d"].strip(), "uf": m["duf"]}
        routes.append(route)
    listing = "full"
    if not routes:
        listing = "popular"
        for a in soup.find_all("a", href=True):
            m = POPULAR_RE.match(a["href"])
            if m and m["path"] not in seen:
                seen.add(m["path"])
                routes.append({"path": m["path"]})  # sem UF no rótulo; o build deduz do slug
    return {"title": h1.get_text(strip=True) if h1 else None, "listing": listing, "routes": routes}


def main() -> None:
    started = datetime.now(timezone.utc)
    companies = list_companies()
    print(f"{len(companies)} empresas", file=sys.stderr)

    failed = []
    with ThreadPoolExecutor(WORKERS) as pool:
        futures = {pool.submit(company_routes, c["slug"]): c for c in companies}
        for i, fut in enumerate(as_completed(futures), 1):
            c = futures[fut]
            try:
                c.update(fut.result())
            except Exception as e:  # noqa: BLE001 — registra e segue
                print(f"falhou {c['slug']}: {e}", file=sys.stderr)
                failed.append(c["slug"])
                c["routes"] = []
            if i % 25 == 0:
                print(f"{i}/{len(companies)}", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{started.date().isoformat()}.json"
    companies.sort(key=lambda c: c["slug"])
    payload = {
        "source": f"{BASE}/viacao",
        "scraped_at": started.isoformat(timespec="seconds"),
        "failed": failed,
        "companies": companies,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n")
    n = sum(len(c["routes"]) for c in companies)
    print(f"{out}: {len(companies)} empresas, {n} rotas, {len(failed)} falhas", file=sys.stderr)


if __name__ == "__main__":
    main()
