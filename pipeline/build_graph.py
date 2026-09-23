"""Gera o grafo RDF do site a partir do snapshot bruto mais recente.

Entradas (data/raw/):
  deonibus/<data>.json      — saída do scrape_deonibus.py
  ibge/municipios.csv       — municípios + coordenadas (kelvins/municipios-brasileiros, MIT)
  wikidata/municipios.csv   — código IBGE → item do Wikidata
  seed/coords-2022-12-17.json — geocodificação OSM do projeto semente (fallback)
  geocode-cache.json        — localidades que não são município (Nominatim), versionado.
                              Dá pra corrigir à mão: {"lat", "lon", "name"?, "country"?,
                              "source": "manual"} — o rótulo do deonibus às vezes erra
                              (p.ex. "Misiones - AR" é a rodoviária de Posadas).

Saídas (site/data/), cada uma um grafo nomeado descrito no catalog.ttl:
  municipios.ttl  — localidades usadas pelos trechos
  deonibus.trig   — empresas e, num grafo nomeado por empresa, suas ligações diretas
  levabici-links.ttl — owl:sameAs empresa ↔ empresa do levabici (void:Linkset)
  catalog.ttl     — catálogo DCAT/VoID de todos os dumps (inclui o grafo vivo do levabici)
"""

import csv
import difflib
import json
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import requests
from rdflib import BNode, Dataset, Graph, Literal, Namespace, URIRef
from rdflib.namespace import DCAT, DCTERMS, OWL, PROV, RDF, VOID, XSD

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "site" / "data"
ALIASES = Path(__file__).resolve().parent / "levabici_aliases.json"

SITE = "https://onibus.abiru.to/"
OB = Namespace(SITE + "def#")
OP = Namespace(SITE + "id/empresa/")
MUN = Namespace(SITE + "id/municipio/")
LOC = Namespace(SITE + "id/localidade/")
NET = Namespace(SITE + "id/rede/")
DS = Namespace(SITE + "id/dataset/")
DUMP = Namespace(SITE + "data/")
SCHEMA = Namespace("https://schema.org/")
WD = Namespace("http://www.wikidata.org/entity/")
LB = Namespace("https://id.pedalhidrografi.co/levabici/terms#")
EMP = Namespace("https://id.pedalhidrografi.co/levabici/empresa/")
LEVABICI_DUMP = URIRef("https://levabici.pedalhidrografi.co/data/reviews.ttl")

UA = {"User-Agent": "mapa-onibus-br/0.1 (+https://github.com/danlessa/mapa-onibus-br)"}
MUNICIPIOS_URL = "https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/municipios.csv"
ESTADOS_URL = "https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/estados.csv"
WIKIDATA_QUERY = "SELECT ?item ?ibge WHERE { ?item wdt:P1585 ?ibge . ?item wdt:P31 wd:Q3184121 . }"

UFS = set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split())
NEIGHBOURS = "ar,bo,cl,co,gf,gy,pe,py,sr,uy,ve"

# grafias que o deonibus usa e o IBGE não (ou vice-versa)
NAME_ALIASES = {
    ("parati", "RJ"): "paraty",
    ("embu", "SP"): "embu-das-artes",
    ("itapage", "CE"): "itapaje",
}


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def squash(s: str) -> str:
    return slugify(s).replace("-", "")


def graph(**extra: Namespace) -> Graph:
    g = Graph()
    for prefix, ns in {"ob": OB, "schema": SCHEMA, **extra}.items():
        g.bind(prefix, ns)
    return g


def cached(path: Path, url: str, headers: dict | None = None, **kw) -> Path:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        r = requests.get(url, headers={**UA, **(headers or {})}, timeout=120, **kw)
        r.raise_for_status()
        path.write_bytes(r.content)
    return path


# ---------------------------------------------------------------- entradas

def latest_snapshot() -> tuple[Path, dict]:
    snaps = sorted((RAW / "deonibus").glob("*.json"))
    if not snaps:
        sys.exit("nenhum snapshot em data/raw/deonibus — rode scrape_deonibus.py")
    return snaps[-1], json.loads(snaps[-1].read_text())


def load_municipios() -> tuple[dict, dict]:
    estados = {}
    with open(cached(RAW / "ibge" / "estados.csv", ESTADOS_URL), encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            estados[row["codigo_uf"]] = row["uf"]
    wikidata = {}
    wd_path = cached(RAW / "wikidata" / "municipios.csv", "https://query.wikidata.org/sparql",
                     headers={"Accept": "text/csv"}, params={"query": WIKIDATA_QUERY})
    with open(wd_path) as f:
        for row in csv.DictReader(f):
            wikidata[row["ibge"]] = row["item"].rsplit("/", 1)[-1]

    by_key = {}
    by_uf = defaultdict(dict)
    with open(cached(RAW / "ibge" / "municipios.csv", MUNICIPIOS_URL), encoding="utf-8") as f:
        for row in csv.DictReader(f):
            uf = estados[row["codigo_uf"]]
            m = {
                "ibge": row["codigo_ibge"],
                "name": row["nome"],
                "uf": uf,
                "lat": row["latitude"],
                "lon": row["longitude"],
                "wikidata": wikidata.get(row["codigo_ibge"]),
            }
            by_key[(squash(row["nome"]), uf)] = m
            by_uf[uf][squash(row["nome"])] = m
    return by_key, by_uf


class Geocoder:
    """(nome, UF) → município do IBGE; senão localidade via semente/Nominatim."""

    def __init__(self) -> None:
        self.by_key, self.by_uf = load_municipios()
        seed = json.loads((RAW / "seed" / "coords-2022-12-17.json").read_text())
        self.seed = {k: v for k, v in seed["coords"].items() if v and v[0] is not None}
        self.cache_path = RAW / "geocode-cache.json"
        self.cache = json.loads(self.cache_path.read_text()) if self.cache_path.exists() else {}
        self.stats = defaultdict(int)
        self.unresolved = set()

    def __call__(self, name: str, uf: str) -> dict | None:
        if uf not in UFS:  # o deonibus põe o país no lugar da UF (AR, PY, UY…)
            return self.abroad(name, uf)
        slug = slugify(name)
        key = squash(NAME_ALIASES.get((slug, uf), slug))
        if m := self.by_key.get((key, uf)):
            self.stats["ibge"] += 1
            return {"kind": "municipality", **m}
        close = difflib.get_close_matches(key, self.by_uf[uf].keys(), n=1, cutoff=0.92)
        if close:
            self.stats["ibge~"] += 1
            return {"kind": "municipality", **self.by_uf[uf][close[0]]}
        loc_id = f"{slug}-{uf.lower()}"
        if loc_id in self.cache:
            hit = self.cache[loc_id]
        elif loc_id in self.seed:
            lon, lat = self.seed[loc_id]
            hit = {"lat": str(round(lat, 5)), "lon": str(round(lon, 5)), "source": "seed-osm-2022"}
            self.cache[loc_id] = hit
        else:
            hit = self.nominatim(name, uf)
            self.cache[loc_id] = hit
        if hit is None:
            self.unresolved.add(f"{name} - {uf}")
            return None
        self.stats[hit["source"]] += 1
        return {"kind": "locality", "id": loc_id, "name": hit.get("name", name), "uf": uf,
                "lat": hit["lat"], "lon": hit["lon"]}

    def abroad(self, name: str, country: str) -> dict | None:
        loc_id = f"{slugify(name)}-{country.lower()}"
        if loc_id not in self.cache:
            # primeiro no país do rótulo; ele às vezes está errado (Villa María - UY é na
            # AR), então sem resultado busca na vizinhança toda. Só povoados: sem isso
            # "Rocha" vira o centroide do departamento e "Paraná" vira o rio.
            self.cache[loc_id] = (self.nominatim(name, countrycodes=country.lower(), featuretype="settlement")
                                  or self.nominatim(name, countrycodes=NEIGHBOURS, featuretype="settlement"))
        hit = self.cache[loc_id]
        if hit is None:
            self.unresolved.add(f"{name} - {country}")
            return None
        self.stats["exterior"] += 1
        return {"kind": "locality", "id": loc_id, "name": hit.get("name", name), "country": hit.get("country", country),
                "lat": hit["lat"], "lon": hit["lon"]}

    def nominatim(self, name: str, uf: str | None = None, countrycodes: str = "br",
                  featuretype: str | None = None) -> dict | None:
        time.sleep(1.1)  # política de uso: ≤ 1 req/s
        params = {"q": f"{name}, {uf}, Brasil" if uf else name, "format": "jsonv2", "limit": 1,
                  "countrycodes": countrycodes, "addressdetails": 1}
        if featuretype:
            params["featureType"] = featuretype
        r = requests.get("https://nominatim.openstreetmap.org/search", headers=UA, timeout=60, params=params)
        hits = r.json() if r.status_code == 200 else []
        if not hits:
            return None
        hit = hits[0]
        return {"lat": str(round(float(hit["lat"]), 5)), "lon": str(round(float(hit["lon"]), 5)),
                "country": hit.get("address", {}).get("country_code", "br").upper(),
                "source": "nominatim"}

    def save(self) -> None:
        self.cache_path.write_text(json.dumps(dict(sorted(self.cache.items())), ensure_ascii=False, indent=1) + "\n")


def split_path(path: str, route: dict) -> None:
    """Rótulo ausente: deduz nome/UF do slug (o-slug-uf[-estacao]-para-...)."""
    ufs = [u.lower() for u in UFS] + ["ar", "bo", "cl", "py", "uy"]  # "pe" fica sendo Pernambuco
    for m in re.finditer("-para-", path):
        a, b = path[:m.start()], path[m.end():]
        ends = []
        for part in (a, b):
            toks = part.split("-")
            idx = next((i for i in range(1, len(toks)) if toks[i] in ufs), None)
            if idx is None:
                break
            ends.append({"name": " ".join(toks[:idx]), "uf": toks[idx].upper()})
        if len(ends) == 2:
            route["origin"], route["destination"] = ends
            return


# ---------------------------------------------------------------- grafos

def locality_iri(place: dict) -> URIRef:
    return MUN[place["ibge"]] if place["kind"] == "municipality" else LOC[place["id"]]


def add_locality(g: Graph, place: dict) -> None:
    s = locality_iri(place)
    if place["kind"] == "municipality":
        g.add((s, RDF.type, OB.Municipality))
        g.add((s, OB.ibgeCode, Literal(place["ibge"])))
        if place.get("wikidata"):
            g.add((s, SCHEMA.sameAs, WD[place["wikidata"]]))
    else:
        g.add((s, RDF.type, OB.Locality))
    g.add((s, SCHEMA.name, Literal(place["name"])))
    if place.get("country", "BR") != "BR":
        g.add((s, SCHEMA.addressCountry, Literal(place["country"])))
    else:
        g.add((s, OB.uf, Literal(place["uf"])))
    g.add((s, SCHEMA.latitude, Literal(Decimal(place["lat"]))))
    g.add((s, SCHEMA.longitude, Literal(Decimal(place["lon"]))))


def levabici_companies() -> dict[str, dict]:
    g = Graph()
    try:
        g.parse(str(LEVABICI_DUMP), format="turtle")
    except Exception as e:  # noqa: BLE001 — sem rede o build segue, sem links
        print(f"aviso: não consegui ler o levabici ({e!r}); links ficam vazios", file=sys.stderr)
        return {}
    out = {}
    for c in g.subjects(RDF.type, LB.Company):
        slug = str(c).rsplit("/", 1)[-1]
        out[slug] = {"iri": c, "name": str(g.value(c, SCHEMA.name) or slug),
                     "mode": str(g.value(c, LB.mode) or "")}
    return out


def link_levabici(operators: dict[str, dict]) -> list[tuple[str, str, str]]:
    """(slug nosso, slug levabici, regra) — slug igual, nome igual ou alias manual."""
    lb = levabici_companies()
    aliases = json.loads(ALIASES.read_text()) if ALIASES.exists() else {}
    aliases.pop("_comment", None)
    by_name = {squash(c["name"]): s for s, c in lb.items()}
    links = []
    for slug, op in operators.items():
        if slug in aliases:
            target, rule = aliases[slug], "alias"
        elif slug in lb:
            target, rule = slug, "slug"
        elif squash(op["name"]) in by_name:
            target, rule = by_name[squash(op["name"])], "nome"
        else:
            continue
        if target:  # alias null = "não é a mesma empresa"
            links.append((slug, target, rule))
    linked = {t for _, t, _ in links}
    bus_unlinked = sorted(s for s, c in lb.items() if s not in linked and c["mode"].endswith("modeBus"))
    if bus_unlinked:
        print(f"levabici: empresas de ônibus sem par no deonibus: {', '.join(bus_unlinked)}", file=sys.stderr)
        # sugestões pra levabici_aliases.json (grafias parecidas: Marron × Marrom); não liga sozinho
        ours = {squash(op["name"]): slug for slug, op in operators.items()}
        for s in bus_unlinked:
            close = difflib.get_close_matches(squash(lb[s]["name"]), ours.keys(), n=3, cutoff=0.8)
            if close:
                print(f"  {s}: parecido com " + ", ".join(ours[c] for c in close), file=sys.stderr)
    return links


def dataset(cat: Graph, ds: URIRef, title: str, dump: URIRef, g: Graph | Dataset, generated: str,
            source: URIRef | None = None, desc: str | None = None) -> None:
    cat.add((DS.catalogo, DCAT.dataset, ds))
    cat.add((ds, RDF.type, DCAT.Dataset))
    cat.add((ds, RDF.type, VOID.Dataset))
    cat.add((ds, DCTERMS.title, Literal(title, lang="pt")))
    if desc:
        cat.add((ds, DCTERMS.description, Literal(desc, lang="pt")))
    cat.add((ds, VOID.dataDump, dump))
    cat.add((ds, PROV.generatedAtTime, Literal(generated, datatype=XSD.dateTime)))
    if source is not None:
        cat.add((ds, DCTERMS.source, source))
    quads = list(g.quads((None, None, None, None))) if isinstance(g, Dataset) else [(*t, None) for t in g]
    cat.add((ds, VOID.triples, Literal(len(quads))))
    counts = defaultdict(int)
    for _, p, o, _ in quads:
        if p == RDF.type:
            counts[o] += 1
    for cls, n in sorted(counts.items()):
        part = BNode()
        cat.add((ds, VOID.classPartition, part))
        cat.add((part, VOID["class"], cls))
        cat.add((part, VOID.entities, Literal(n)))
    for prop, n in sorted(Counter(p for _, p, _, _ in quads if p == OB.directTo).items()):
        part = BNode()
        cat.add((ds, VOID.propertyPartition, part))
        cat.add((part, VOID.property, prop))
        cat.add((part, VOID.triples, Literal(n)))


def drop_description(cat: Graph, s: URIRef) -> Graph:
    """Tira (e devolve) a descrição de s no catálogo, com os nós em branco dela."""
    removed = Graph()
    stack = [s]
    while stack:
        node = stack.pop()
        for t in list(cat.triples((node, None, None))):
            removed.add(t)
            cat.remove(t)
            if isinstance(t[2], BNode):
                stack.append(t[2])
    cat.remove((None, DCAT.dataset, s))
    return removed


def write(g: Graph | Dataset, name: str, fmt: str = "turtle") -> None:
    path = OUT / name
    g.serialize(path, format=fmt)
    n = len(list(g.quads((None, None, None, None)))) if isinstance(g, Dataset) else len(g)
    print(f"{path.relative_to(ROOT)}: {n} triplas, {path.stat().st_size / 1e6:.2f} MB", file=sys.stderr)


def main() -> None:
    snap_path, snap = latest_snapshot()
    geocode = Geocoder()

    operators = {}
    networks = defaultdict(lambda: defaultdict(set))  # empresa → origem → {destinos}
    places = {}
    for c in snap["companies"]:
        if not c["routes"]:
            continue
        operators[c["slug"]] = c
        for route in c["routes"]:
            if "origin" not in route:
                split_path(route["path"], route)
            if "origin" not in route:
                geocode.unresolved.add(route["path"])
                continue
            o = geocode(**route["origin"])
            d = geocode(**route["destination"])
            if o is None or d is None:
                continue
            oi, di = locality_iri(o), locality_iri(d)
            if oi == di:
                continue  # estações da mesma cidade
            places[oi], places[di] = o, d
            networks[c["slug"]][oi].add(di)
    geocode.save()

    OUT.mkdir(parents=True, exist_ok=True)
    generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    scraped = snap["scraped_at"]

    g_mun = graph(mun=MUN, loc=LOC, wd=WD)
    for place in places.values():
        add_locality(g_mun, place)

    # Um grafo nomeado por rede (empresa × fonte), só com triplas
    # `origem ob:directTo destino`; a descrição das redes e das empresas
    # fica no grafo padrão do dump.
    d_deo = Dataset()
    for prefix, ns in {"ob": OB, "schema": SCHEMA, "op": OP, "mun": MUN, "loc": LOC,
                       "prov": PROV, "ds": DS, "rede": NET}.items():
        d_deo.bind(prefix, ns)
    n_links = 0
    for slug, c in operators.items():
        net = NET[f"deonibus/{slug}"]
        links = networks.get(slug, {})
        count = sum(len(ds_) for ds_ in links.values())
        n_links += count
        d_deo.add((net, RDF.type, OB.Network))
        d_deo.add((net, OB.operator, OP[slug]))
        d_deo.add((net, PROV.wasDerivedFrom, DS.deonibus))
        d_deo.add((net, OB.complete, Literal(c.get("listing", "full") == "full")))
        d_deo.add((net, OB.linkCount, Literal(count)))
        g_net = d_deo.graph(net)
        for oi, dests in links.items():
            for di in dests:
                g_net.add((oi, OB.directTo, di))

        s = OP[slug]
        d_deo.add((s, RDF.type, OB.Operator))
        d_deo.add((s, SCHEMA.name, Literal(c["name"])))
        if c.get("title") and c["title"] != c["name"]:
            d_deo.add((s, SCHEMA.alternateName, Literal(c["title"])))
        d_deo.add((s, SCHEMA.url, URIRef(f"https://deonibus.com/viacao/{slug}")))
        if c.get("logo"):
            d_deo.add((s, SCHEMA.logo, URIRef(c["logo"])))

    g_links = graph(op=OP, emp=EMP, owl=OWL)
    for ours, theirs, _rule in link_levabici(operators):
        g_links.add((OP[ours], OWL.sameAs, EMP[theirs]))

    cat = graph(ds=DS, dcat=DCAT, dcterms=DCTERMS, void=VOID, prov=PROV)
    cat.add((DS.catalogo, RDF.type, DCAT.Catalog))
    cat.add((DS.catalogo, DCTERMS.title, Literal("Grafo do mapa de ônibus rodoviários do Brasil", lang="pt")))
    cat.add((DS.catalogo, DCTERMS.license, URIRef("https://opendatacommons.org/licenses/odbl/1-0/")))
    cat.add((DS.catalogo, DCAT.landingPage, URIRef(SITE)))
    cat.add((DS.vocab, RDF.type, DCAT.Dataset))
    cat.add((DS.vocab, DCTERMS.title, Literal("Vocabulário", lang="pt")))
    cat.add((DS.vocab, VOID.dataDump, DUMP["vocab.ttl"]))
    cat.add((DS.catalogo, DCAT.dataset, DS.vocab))
    dataset(cat, DS.municipios, "Localidades servidas", DUMP["municipios.ttl"], g_mun, generated,
            URIRef("https://github.com/kelvins/municipios-brasileiros"),
            "Municípios (IBGE, com coordenadas e item do Wikidata) e demais localidades que aparecem nas redes.")
    dataset(cat, DS.deonibus, "Redes das empresas — deonibus.com", DUMP["deonibus.trig"], d_deo, scraped,
            URIRef(snap["source"]),
            "Ligações diretas listadas na página de cada viação no deonibus.com, agregadas por município. "
            "Um grafo nomeado por empresa.")
    dataset(cat, DS["levabici-links"], "Empresas ↔ levabici", DUMP["levabici-links.ttl"], g_links, generated,
            desc="Identidade (owl:sameAs) entre as empresas deste grafo e as do levabici.")
    cat.add((DS["levabici-links"], RDF.type, VOID.Linkset))
    cat.add((DS["levabici-links"], VOID.linkPredicate, OWL.sameAs))
    cat.add((DS["levabici-links"], VOID.subjectsTarget, DS.deonibus))
    cat.add((DS["levabici-links"], VOID.objectsTarget, DS.levabici))
    # grafo externo, lido ao vivo pelo navegador: é daqui que vêm as notas
    cat.add((DS.catalogo, DCAT.dataset, DS.levabici))
    cat.add((DS.levabici, RDF.type, DCAT.Dataset))
    cat.add((DS.levabici, RDF.type, VOID.Dataset))
    cat.add((DS.levabici, DCTERMS.title, Literal("levabici — avaliações de transporte de bicicleta", lang="pt")))
    cat.add((DS.levabici, DCAT.landingPage, URIRef("https://levabici.pedalhidrografi.co/")))
    cat.add((DS.levabici, VOID.dataDump, LEVABICI_DUMP))

    # a geometria (estradas.ttl) é do route_roads.py, que roda depois: mantém a descrição dela
    old_cat = OUT / "catalog.ttl"
    if old_cat.exists() and (OUT / "estradas.ttl").exists():
        kept = drop_description(Graph().parse(old_cat), DS.estradas)
        if len(kept):
            cat += kept
            cat.add((DS.catalogo, DCAT.dataset, DS.estradas))

    write(g_mun, "municipios.ttl")
    write(d_deo, "deonibus.trig", "trig")
    write(g_links, "levabici-links.ttl")
    write(cat, "catalog.ttl")

    report = {
        "snapshot": snap_path.name,
        "operators": len(operators),
        "operators_partial": sorted(s for s, c in operators.items() if c.get("listing") == "popular"),
        "operators_without_routes": sorted(c["slug"] for c in snap["companies"] if not c["routes"]),
        "links": n_links,
        "localities": len(places),
        "geocoding": dict(geocode.stats),
        "unresolved": sorted(geocode.unresolved),
        "levabici_links": len(g_links),
    }
    (ROOT / "data" / "build-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in report.items()}, ensure_ascii=False),
          file=sys.stderr)


if __name__ == "__main__":
    main()
