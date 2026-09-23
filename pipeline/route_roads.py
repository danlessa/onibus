"""Traça cada ligação pela estrada, pra que trechos que dividem rodovia se sobreponham.

Dois grafos de roteamento, porque o osrm-extract da América do Sul inteira
com estradas até tertiary não cabe em 16 GB de RAM:
  brasil    extrato do Brasil, motorway…tertiary (+ _link, balsas) — detalhe
            pra chegar em cidade pequena; roteia os pares só com pontas no Brasil
  exterior  extrato da América do Sul só com motorway…secondary, recortado no
            Cone Sul + Bolívia; roteia os pares com alguma ponta no exterior
            (Buenos Aires, Montevidéu, Assunção, Santa Cruz…)

Etapas (cada uma refaz se a entrada for mais nova que a saída):
  1. filtro   data/raw/osm/<extrato>.osm.pbf → roads-<grafo>.osm.pbf
  2. osrm     extract/partition/customize no docker → data/raw/osm/osrm/<grafo>/
  3. rotas    osrm-routed de cada grafo → data/raw/routes/routes-<grafo>.jsonl.gz
  4. malha    junta todas as rotas num grafo de estradas, quebra nos nós de grau
              ≠ 2 e cada cadeia vira um ob:RoadSegment; cada rota vira a lista
              das cadeias por onde passa → site/data/estradas.ttl

Lê as localidades e as redes do próprio grafo publicado (site/data), então
roda depois do build_graph.py.
"""

import gzip
import json
import multiprocessing
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests
from rdflib import Dataset, Graph, Literal, Namespace, URIRef
from rdflib.namespace import RDF, XSD

ROOT = Path(__file__).resolve().parent.parent
OSM = ROOT / "data" / "raw" / "osm"
ROUTES_DIR = ROOT / "data" / "raw" / "routes"
OUT = ROOT / "site" / "data" / "estradas.ttl"
GEOFABRIK = "https://download.geofabrik.de/south-america"

LINKS = {"motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
MAJOR = {"motorway", "trunk", "primary", "secondary"}
GRAPHS = {
    "brasil": {
        "extract": OSM / "brazil-latest.osm.pbf", "url": f"{GEOFABRIK}/brazil-latest.osm.pbf",
        "keep": MAJOR | {"tertiary"} | LINKS, "bbox": None, "port": 5055,
    },
    "exterior": {
        "extract": OSM / "south-america-latest.osm.pbf", "url": f"{GEOFABRIK}-latest.osm.pbf",
        "keep": MAJOR | LINKS, "bbox": (-74.5, -36.0, -34.0, 6.0), "port": 5056,
    },
}

OSRM_IMAGE = "ghcr.io/project-osrm/osrm-backend:latest"
SNAP_CONNECTOR_M = 3000  # ponto longe da estrada filtrada: liga em reta
SIMPLIFY_DEG = 0.002  # ~200 m; suficiente até zoom ~9

SITE = "https://onibus.abiru.to/"
OB = Namespace(SITE + "def#")
MUN = Namespace(SITE + "id/municipio/")
LOC = Namespace(SITE + "id/localidade/")
EST = Namespace(SITE + "id/estrada/")
ROTA = Namespace(SITE + "id/rota/")
SCHEMA = Namespace("https://schema.org/")
GEO = Namespace("http://www.opengis.net/ont/geosparql#")


def log(*a) -> None:
    print(*a, file=sys.stderr, flush=True)


def stale(output: Path, source: Path) -> bool:
    return not output.exists() or output.stat().st_mtime < source.stat().st_mtime


def roads_file(name: str) -> Path:
    return OSM / f"roads-{name}.osm.pbf"


def osrm_base(name: str) -> Path:
    return OSM / "osrm" / name / "roads.osrm"


def routes_file(name: str) -> Path:
    return ROUTES_DIR / f"routes-{name}.jsonl.gz"


# ---------------------------------------------------------------- 1. filtro

def _keep_ways(src: Path, out: Path, keep: set, bbox=None) -> None:
    import osmium

    tmp = out.with_suffix(".tmp.pbf")
    if bbox:
        # coordenadas precisam dos nós; o EntityFilter (em C++) segura os nós
        # e só as vias chegam no laço em Python
        fp = (osmium.FileProcessor(str(src), osmium.osm.NODE | osmium.osm.WAY).with_locations()
              .with_filter(osmium.filter.EntityFilter(osmium.osm.WAY)))
    else:
        fp = osmium.FileProcessor(str(src), osmium.osm.WAY)
    fp = fp.with_filter(osmium.filter.KeyFilter("highway", "route"))
    x0, y0, x1, y1 = bbox or (-180, -90, 180, 90)
    with osmium.BackReferenceWriter(str(tmp), ref_src=str(src), overwrite=True) as writer:
        for w in fp:
            if not (w.tags.get("highway") in keep or w.tags.get("route") == "ferry"):
                continue
            if bbox and not any(n.location.valid() and x0 <= n.lon <= x1 and y0 <= n.lat <= y1 for n in w.nodes):
                continue
            writer.add(w)
    tmp.rename(out)


def _filter(name: str) -> None:
    """Roda num processo filho: o pyosmium não devolve a memória, e o OSRM vem logo depois."""
    cfg = GRAPHS[name]
    out = roads_file(name)
    log(f"filtrando {cfg['extract'].name} → {out.name}…")
    t0 = time.time()
    if cfg["bbox"]:
        # 1º só as classes (sem coordenadas: o índice de nós do continente não
        # cabe em memória); depois o recorte, já num arquivo pequeno
        classes = out.with_name(f"roads-{name}-all.osm.pbf")
        if stale(classes, cfg["extract"]):
            _keep_ways(cfg["extract"], classes, cfg["keep"])
        _keep_ways(classes, out, cfg["keep"], cfg["bbox"])
    else:
        _keep_ways(cfg["extract"], out, cfg["keep"])
    log(f"  {out.stat().st_size / 1e6:.0f} MB em {time.time() - t0:.0f}s")


def filter_roads(name: str) -> None:
    if not stale(roads_file(name), GRAPHS[name]["extract"]):
        return
    proc = multiprocessing.get_context("fork").Process(target=_filter, args=(name,))
    proc.start()
    proc.join()
    if proc.exitcode != 0:
        raise RuntimeError(f"filtro {name} falhou ({proc.exitcode})")


# ---------------------------------------------------------------- 2. osrm

def docker(*args: str) -> None:
    subprocess.run(["docker", "run", "--rm", "-v", f"{OSM}:/data", OSRM_IMAGE, *args], check=True)


def prepare_osrm(name: str) -> None:
    base = osrm_base(name)
    if not stale(base.with_suffix(".osrm.mldgr"), roads_file(name)):
        return
    base.parent.mkdir(parents=True, exist_ok=True)
    pbf = base.with_suffix(".osm.pbf")
    pbf.unlink(missing_ok=True)
    pbf.hardlink_to(roads_file(name))
    inside = f"/data/osrm/{name}"
    t0 = time.time()
    docker("osrm-extract", "-p", "/opt/car.lua", f"{inside}/roads.osm.pbf")
    docker("osrm-partition", f"{inside}/roads.osrm")
    docker("osrm-customize", f"{inside}/roads.osrm")
    log(f"osrm {name} pronto em {time.time() - t0:.0f}s")


class OsrmServer:
    def __init__(self, name: str):
        self.graph, self.port = name, GRAPHS[name]["port"]
        self.container = f"mapa-onibus-osrm-{name}"

    def __enter__(self):
        subprocess.run(["docker", "rm", "-f", self.container], capture_output=True)
        subprocess.run(["docker", "run", "-d", "--rm", "--name", self.container, "-p", f"127.0.0.1:{self.port}:5000",
                        "-v", f"{OSM}:/data", OSRM_IMAGE, "osrm-routed", "--algorithm", "mld",
                        f"/data/osrm/{self.graph}/roads.osrm"], check=True, capture_output=True)
        for _ in range(120):
            try:
                requests.get(f"http://127.0.0.1:{self.port}/nearest/v1/driving/-46.6,-23.5", timeout=2)
                return self
            except requests.RequestException:
                time.sleep(1)
        raise RuntimeError(f"osrm-routed {self.graph} não subiu")

    def __exit__(self, *exc):
        subprocess.run(["docker", "rm", "-f", self.container], capture_output=True)


# ---------------------------------------------------------------- 3. rotas

def read_graph() -> tuple[dict, dict]:
    """Localidades (iri → lon, lat) e pares não direcionais do grafo, separados por grafo de roteamento."""
    g = Graph().parse(ROOT / "site" / "data" / "municipios.ttl")
    places = {}
    for s in set(g.subjects(SCHEMA.latitude, None)):
        places[str(s)] = (float(g.value(s, SCHEMA.longitude)), float(g.value(s, SCHEMA.latitude)))
    abroad = {str(s) for s, c in g.subject_objects(SCHEMA.addressCountry) if str(c) != "BR"}
    ds = Dataset()
    ds.parse(ROOT / "site" / "data" / "deonibus.trig", format="trig")
    pairs = {name: set() for name in GRAPHS}
    for s, _, o, _ in ds.quads((None, OB.directTo, None, None)):
        a, b = sorted((str(s), str(o)))
        if a in places and b in places:
            pairs["exterior" if a in abroad or b in abroad else "brasil"].add((a, b))
    return places, pairs


def route_all(name: str, places: dict, pairs: set) -> None:
    cache = routes_file(name)
    if cache.exists() and stale(cache, osrm_base(name).with_suffix(".osrm.mldgr")):
        log(f"malha {name} mudou: roteando tudo de novo")
        cache.unlink()
    done = set()
    if cache.exists():
        with gzip.open(cache, "rt") as f:
            for line in f:
                r = json.loads(line)
                done.add((r["a"], r["b"]))
    todo = sorted(pairs - done)
    if not todo:
        return
    with OsrmServer(name) as server:
        route_pairs(server.port, cache, places, todo, len(done))


def route_pairs(port: int, cache: Path, places: dict, todo: list, cached: int) -> None:
    log(f"roteando {len(todo)} pares em {cache.name} ({cached} já em cache)…")
    cache.parent.mkdir(parents=True, exist_ok=True)
    session = requests.Session()

    def one(pair):
        a, b = pair
        (x1, y1), (x2, y2) = places[a], places[b]
        url = (f"http://127.0.0.1:{port}/route/v1/driving/{x1},{y1};{x2},{y2}"
               "?overview=full&geometries=polyline6&steps=false&alternatives=false")
        try:
            j = session.get(url, timeout=60).json()
        except (requests.RequestException, ValueError):
            j = {}
        if j.get("code") != "Ok":
            return {"a": a, "b": b, "ok": False}
        rt = j["routes"][0]
        return {"a": a, "b": b, "ok": True, "km": round(rt["distance"] / 1000, 1),
                "h": round(rt["duration"] / 3600, 2), "geom": rt["geometry"],
                "snap": [round(w["distance"]) for w in j["waypoints"]]}

    t0 = time.time()
    with gzip.open(cache, "at") as f, ThreadPoolExecutor(8) as pool:
        for i, r in enumerate(pool.map(one, todo), 1):
            f.write(json.dumps(r) + "\n")
            if i % 2000 == 0:
                log(f"  {i}/{len(todo)} ({i / (time.time() - t0):.0f}/s)")


# ---------------------------------------------------------------- 4. malha
#
# São ~36 mil rotas com ~5 mil pontos cada (geometria completa, pra que o
# mesmo nó OSM caia na mesma coordenada em todas as rotas que passam por
# ele). Tudo vetorizado em numpy e em três passadas pelo arquivo, pra
# caber em memória: nós únicos → arestas únicas → sequência de cadeias.

def decode_np(s: str) -> np.ndarray:
    """polyline6 → array (n, 2) int64 de [lon·1e6, lat·1e6]."""
    b = np.frombuffer(s.encode("ascii"), dtype=np.uint8).astype(np.int64) - 63
    is_end = b < 0x20
    starts = np.flatnonzero(np.concatenate(([True], is_end[:-1])))
    grp = np.concatenate(([0], np.cumsum(is_end)[:-1]))
    pos = np.arange(len(b)) - starts[grp]
    vals = np.add.reduceat((b & 0x1F) << (5 * pos), starts)
    d = np.where(vals & 1, ~(vals >> 1), vals >> 1)
    return np.stack([np.cumsum(d[1::2]), np.cumsum(d[0::2])], axis=1)


def pack(xy: np.ndarray) -> np.ndarray:
    return ((xy[:, 0] + 180_000_000) << 28) | (xy[:, 1] + 90_000_000)


def unpack(keys: np.ndarray) -> np.ndarray:
    return np.stack([(keys >> 28) - 180_000_000, (keys & ((1 << 28) - 1)) - 90_000_000], axis=1)


def route_keys(r: dict, places: dict) -> np.ndarray:
    """Chaves dos nós da rota, com conectores em reta se a ponta ficou longe da estrada."""
    pa = np.array([[round(v * 1e6) for v in places[r["a"]]]], dtype=np.int64)
    pb = np.array([[round(v * 1e6) for v in places[r["b"]]]], dtype=np.int64)
    if r["ok"]:
        parts = [decode_np(r["geom"])]
        if r["snap"][0] > SNAP_CONNECTOR_M:
            parts.insert(0, pa)
        if r["snap"][1] > SNAP_CONNECTOR_M:
            parts.append(pb)
        xy = np.concatenate(parts)
    else:
        xy = np.concatenate([pa, pb])
    k = pack(xy)
    k = k[np.concatenate(([True], k[1:] != k[:-1]))]
    if len(k) < 2:  # rota curtinha que cabe numa célula da grade
        k = pack(np.concatenate([pa, pb]))
    return k


def iter_routes(pairs: set):
    for name in GRAPHS:
        yield from _iter_cache(routes_file(name), pairs)


def _iter_cache(path: Path, pairs: set):
    if not path.exists():
        return
    with gzip.open(path, "rt") as f:
        for line in f:
            r = json.loads(line)
            if (r["a"], r["b"]) not in pairs:  # par que sumiu do grafo (ou é do outro grafo)
                continue
            if r["ok"] and r["km"] <= 0:
                # as duas pontas caíram no mesmo ponto da malha (longe de qualquer
                # estrada): não é rota, é reta
                r["ok"] = False
            yield r


def simplify(xy: np.ndarray, tol: float) -> np.ndarray:
    """Douglas-Peucker mantendo as pontas (as cadeias têm de se encontrar)."""
    n = len(xy)
    if n < 3:
        return xy
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    tol2 = (tol * 1e6) ** 2
    pts = xy.astype(np.float64)
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j - i < 2:
            continue
        seg = pts[i + 1:j]
        a, b = pts[i], pts[j]
        d = b - a
        norm = d @ d
        if norm == 0:
            dist = ((seg - a) ** 2).sum(1)
        else:
            t = np.clip(((seg - a) @ d) / norm, 0, 1)
            dist = ((seg - a - t[:, None] * d) ** 2).sum(1)
        k = int(dist.argmax())
        if dist[k] > tol2:
            k += i + 1
            keep[k] = True
            stack += [(i, k), (k, j)]
    return xy[keep]


def encode_ids(seq: list[int]) -> str:
    """[5, 6, 7, 8, 20, 19, 18, 3] → "5-8 20-18 3" (faixas de ids seguidos, subindo ou descendo)."""
    out, i = [], 0
    while i < len(seq):
        j = i
        if i + 1 < len(seq) and abs(seq[i + 1] - seq[i]) == 1:
            step = seq[i + 1] - seq[i]
            while j + 1 < len(seq) and seq[j + 1] - seq[j] == step:
                j += 1
        out.append(f"{seq[i]}-{seq[j]}" if j > i else str(seq[i]))
        i = j + 1
    return " ".join(out)


def build_network(places: dict, pairs: set) -> None:
    t0 = time.time()
    # 1ª passada: nós únicos
    nodes = np.empty(0, dtype=np.int64)
    buf = []
    for i, r in enumerate(iter_routes(pairs), 1):
        buf.append(np.unique(route_keys(r, places)))
        if i % 3000 == 0:
            nodes = np.union1d(nodes, np.unique(np.concatenate(buf)))
            buf = []
    nodes = np.union1d(nodes, np.unique(np.concatenate(buf)))
    N = len(nodes)
    log(f"  {N} nós ({time.time() - t0:.0f}s)")

    # 2ª passada: arestas únicas (não orientadas, chave min·N+max) e pontas das rotas
    edges = np.empty(0, dtype=np.int64)
    ends = []
    conn = []  # arestas que são reta de ligação, não estrada
    buf = []
    for i, r in enumerate(iter_routes(pairs), 1):
        idx = np.searchsorted(nodes, route_keys(r, places))
        ends += [idx[0], idx[-1]]
        if not r["ok"]:
            conn.append(min(idx[0], idx[-1]) * N + max(idx[0], idx[-1]))
        else:
            # a ponta da reta no lado da estrada também quebra a cadeia, pra
            # reta virar um segmento só dela
            if r["snap"][0] > SNAP_CONNECTOR_M:
                ends.append(idx[1])
                conn.append(min(idx[0], idx[1]) * N + max(idx[0], idx[1]))
            if r["snap"][1] > SNAP_CONNECTOR_M:
                ends.append(idx[-2])
                conn.append(min(idx[-2], idx[-1]) * N + max(idx[-2], idx[-1]))
        u, v = idx[:-1], idx[1:]
        buf.append(np.unique(np.minimum(u, v) * N + np.maximum(u, v)))
        if i % 3000 == 0:
            edges = np.union1d(edges, np.unique(np.concatenate(buf)))
            buf = []
    edges = np.union1d(edges, np.unique(np.concatenate(buf)))
    M = len(edges)
    is_conn = np.zeros(M, dtype=bool)
    is_conn[np.searchsorted(edges, np.unique(np.array(conn, dtype=np.int64)))] = True
    eu, ev = edges // N, edges % N
    deg = np.bincount(eu, minlength=N) + np.bincount(ev, minlength=N)
    is_break = deg != 2
    is_break[np.array(ends)] = True
    log(f"  {M} arestas, {int(is_break.sum())} quebras ({time.time() - t0:.0f}s)")

    # adjacência CSR, com o índice da aresta de cada vizinho
    src = np.concatenate([eu, ev])
    dst = np.concatenate([ev, eu])
    eid = np.concatenate([np.arange(M), np.arange(M)])
    order = np.argsort(src, kind="stable")
    indptr = np.concatenate(([0], np.cumsum(np.bincount(src, minlength=N)))).tolist()
    nbr = dst[order].tolist()
    nbr_e = eid[order].tolist()
    brk = is_break.tolist()
    del src, dst, eid, order

    # cadeias: de quebra em quebra, por nós de grau 2
    edge_chain = [-1] * M
    chains = []
    for s in np.flatnonzero(is_break).tolist():
        for p in range(indptr[s], indptr[s + 1]):
            if edge_chain[nbr_e[p]] != -1:
                continue
            cid = len(chains)
            chain = [s, nbr[p]]
            edge_chain[nbr_e[p]] = cid
            prev, cur = s, nbr[p]
            while not brk[cur]:
                a, b = indptr[cur], indptr[cur] + 1
                q = b if nbr[a] == prev else a
                if edge_chain[nbr_e[q]] != -1:
                    break
                edge_chain[nbr_e[q]] = cid
                prev, cur = cur, nbr[q]
                chain.append(cur)
            chains.append(np.array(chain, dtype=np.int64))
    edge_chain = np.array(edge_chain, dtype=np.int64)
    off_road = set(edge_chain[is_conn].tolist())
    del nbr, nbr_e, indptr, brk
    log(f"  {len(chains)} cadeias ({time.time() - t0:.0f}s)")

    # 3ª passada: cada rota → sequência de cadeias
    routes = []
    used = set()
    for r in iter_routes(pairs):
        idx = np.searchsorted(nodes, route_keys(r, places))
        u, v = idx[:-1], idx[1:]
        cids = edge_chain[np.searchsorted(edges, np.minimum(u, v) * N + np.maximum(u, v))]
        seq = cids[np.concatenate(([True], cids[1:] != cids[:-1]))].tolist()
        routes.append((r["a"], r["b"], r.get("km") if r["ok"] else None, seq))
        used.update(seq)
    # renumera pela ordem em que aparecem nas rotas, das mais longas pras mais
    # curtas: trechos seguidos de estrada ganham ids seguidos, e a lista de cada
    # rota vira poucas faixas "a-b"
    new_id = {}
    for *_, seq in sorted(routes, key=lambda r: -len(r[3])):
        for c in seq:
            if c not in new_id:
                new_id[c] = len(new_id)
    order = sorted(used, key=new_id.get)
    geoms = [simplify(unpack(nodes[chains[cid]]), SIMPLIFY_DEG) for cid in order]
    npts = sum(len(g) for g in geoms)
    log(f"  {len(order)} cadeias usadas, {npts} pontos depois de simplificar ({time.time() - t0:.0f}s)")

    g = Graph()
    for prefix, ns in {"ob": OB, "schema": SCHEMA, "geo": GEO, "est": EST, "rota": ROTA, "mun": MUN, "loc": LOC}.items():
        g.bind(prefix, ns)
    for i, xy in enumerate(geoms):
        s = EST[str(i)]
        wkt = "LINESTRING(" + ",".join(f"{x / 1e6:.5f} {y / 1e6:.5f}" for x, y in xy.tolist()) + ")"
        g.add((s, RDF.type, OB.RoadSegment))
        g.add((s, GEO.asWKT, Literal(wkt, datatype=GEO.wktLiteral)))
        if order[i] in off_road:
            g.add((s, OB.offRoad, Literal(True)))
    for a, b, km, seq in routes:
        s = ROTA[f"{a.rsplit('/', 1)[-1]}--{b.rsplit('/', 1)[-1]}"]
        g.add((s, RDF.type, OB.Route))
        g.add((s, OB.endpoint, URIRef(a)))
        g.add((s, OB.endpoint, URIRef(b)))
        g.add((s, OB.roadSegments, Literal(encode_ids([new_id[c] for c in seq]), datatype=OB.idList)))
        if km is not None:
            g.add((s, OB.roadDistanceKm, Literal(km, datatype=XSD.decimal)))
        else:
            g.add((s, OB.straightLine, Literal(True)))
    g.serialize(OUT, format="turtle")
    log(f"{OUT.relative_to(ROOT)}: {len(g)} triplas, {OUT.stat().st_size / 1e6:.1f} MB")
    log(f"sem rota (reta): {sum(1 for *_, km, _ in routes if km is None)}; segmentos fora da estrada: {len(off_road)}")
    register_in_catalog(g)


def register_in_catalog(g: Graph) -> None:
    import build_graph as bg
    from datetime import datetime, timezone

    path = bg.OUT / "catalog.ttl"
    cat = Graph().parse(path)
    for prefix, ns in {"ob": bg.OB, "schema": bg.SCHEMA, "ds": bg.DS, "dcat": bg.DCAT, "dcterms": bg.DCTERMS,
                       "void": bg.VOID, "prov": bg.PROV}.items():
        cat.bind(prefix, ns)
    bg.drop_description(cat, bg.DS.estradas)
    bg.dataset(cat, bg.DS.estradas, "Rotas pela estrada", bg.DUMP["estradas.ttl"], g,
               datetime.now(timezone.utc).isoformat(timespec="seconds"),
               URIRef("https://www.openstreetmap.org/copyright"),
               "Caminho pela estrada de cada par de localidades das redes, em segmentos compartilhados "
               "(OSRM sobre o OpenStreetMap, rodovias até tertiary).")
    cat.serialize(path, format="turtle")


def main() -> None:
    missing = [cfg for cfg in GRAPHS.values() if not cfg["extract"].exists()]
    if missing:
        sys.exit("baixe em data/raw/osm/: " + " ".join(cfg["url"] for cfg in missing))
    places, pairs = read_graph()
    log(", ".join(f"{len(p)} pares ({n})" for n, p in pairs.items()))
    for name in GRAPHS:
        filter_roads(name)
        prepare_osrm(name)
        route_all(name, places, pairs[name])
    build_network(places, set().union(*pairs.values()))


if __name__ == "__main__":
    main()
