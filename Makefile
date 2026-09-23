.PHONY: all scrape build roads validate serve

all: build roads validate

# raspa o deonibus.com (~7 min, educado de propósito) → data/raw/deonibus/<data>.json
scrape:
	uv run python pipeline/scrape_deonibus.py

# snapshot mais recente → grafo RDF em site/data/ (+ data/build-report.json)
build:
	uv run python pipeline/build_graph.py

# pares do grafo → rotas pela estrada (OSRM local via docker) → site/data/estradas.ttl
# precisa de data/raw/osm/{brazil,south-america}-latest.osm.pbf (Geofabrik, ~6 GB); 1ª vez ~30 min
roads:
	uv run python pipeline/route_roads.py

# SHACL (site/data/shapes.ttl) sobre a união de todos os dumps do catálogo
validate:
	uv run python pipeline/validate.py

serve:
	python3 -m http.server 8000 -d site
