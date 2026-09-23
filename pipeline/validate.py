"""Valida o grafo publicado contra site/data/shapes.ttl (SHACL).

Carrega o vocabulário e todos os dumps locais listados no catálogo numa
única união (as ligações ob:directTo moram em grafos nomeados). Sai com
código 1 se houver alguma sh:Violation; sh:Warning só é impressa.
"""

import sys
from pathlib import Path

from pyshacl import validate
from rdflib import Dataset, Graph, Namespace
from rdflib.namespace import SH, VOID

SITE_DIR = Path(__file__).resolve().parent.parent / "site"
BASE = "https://abiru.to/onibus/"


def main() -> None:
    catalog = Graph().parse(SITE_DIR / "data" / "catalog.ttl")
    union = Graph()
    for dump in sorted(set(catalog.objects(None, VOID.dataDump))):
        if not str(dump).startswith(BASE):
            continue  # grafos externos (levabici) não são nossos pra validar
        path = SITE_DIR / str(dump)[len(BASE):]
        fmt = "trig" if path.suffix == ".trig" else "turtle"
        ds = Dataset()
        ds.parse(path, format=fmt)
        for s, p, o, _ in ds.quads((None, None, None, None)):
            union.add((s, p, o))
        print(f"{path.name}: ok", file=sys.stderr)

    shapes = Graph().parse(SITE_DIR / "data" / "shapes.ttl")
    conforms, report, text = validate(union, shacl_graph=shapes, inference="rdfs", allow_warnings=True)
    warnings = len(list(report.subjects(SH.resultSeverity, SH.Warning)))
    violations = len(list(report.subjects(SH.resultSeverity, SH.Violation)))
    print(f"{len(union)} triplas; {violations} violações, {warnings} avisos", file=sys.stderr)
    if violations or warnings:
        print(text[:5000])
    sys.exit(0 if conforms else 1)


if __name__ == "__main__":
    main()
