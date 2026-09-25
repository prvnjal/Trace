#!/usr/bin/env python3
"""
Filter industrial facilities from a Geofabrik India OSM PBF extract.

Two-pass design (deliberately avoids osmium's whole-file node-location
index, which needs more RAM than a full-India extract allows):

  Pass 1: scan objects; emit matching nodes directly (coords are inline),
          record node-refs of matching ways.
  Pass 2: scan nodes again, keeping coordinates only for referenced ids.
  Then compute way centroids from the small lookup dict and write GeoJSON.

Usage:
    .venv/bin/python osm_filter_pbf.py [input.pbf] [output.geojson]

Tags kept (nodes and ways):
    power=plant             -> power_plant
    man_made=works          -> works (factory/industrial works)
    man_made=petroleum_well -> petroleum_well
    industrial=*            -> industrial_site
Relations are skipped.
"""
import json
import sys
import time
import osmium

IN_PBF = "data/india-latest.osm.pbf"
OUT_GEOJSON = "data/osm_facilities_india.geojson"


def classify(tags):
    if tags.get("power") == "plant":
        return "power_plant"
    if tags.get("man_made") == "works":
        return "works"
    if tags.get("man_made") == "petroleum_well":
        return "petroleum_well"
    if "industrial" in tags:
        return "industrial_site"
    return None


def props(osm_id, tags, kind):
    return {
        "osm_id": osm_id,
        "kind": kind,
        "name": tags.get("name"),
        "operator": tags.get("operator"),
        "power_source": tags.get("plant:source") or tags.get("power:source"),
        "industrial": tags.get("industrial"),
    }


class Pass1(osmium.SimpleHandler):
    """Collect matching nodes (emitted directly) and matching ways (node refs)."""

    def __init__(self):
        super().__init__()
        self.features = []
        self.way_refs = {}  # way_id -> (props, [node_refs])
        self.count = 0

    def node(self, n):
        kind = classify(n.tags)
        if kind and n.location.valid():
            self.features.append({
                "type": "Feature",
                "geometry": {"type": "Point",
                             "coordinates": [n.location.lon, n.location.lat]},
                "properties": props(f"n{n.id}", n.tags, kind),
            })
        self.count += 1
        if self.count % 50_000_000 == 0:
            print(f"pass1: {self.count//1_000_000}M objects...", flush=True)

    def way(self, w):
        kind = classify(w.tags)
        if kind:
            refs = [nd.ref for nd in w.nodes]
            self.way_refs[w.id] = (props(f"w{w.id}", w.tags, kind), refs)


class Pass2(osmium.SimpleHandler):
    """Keep coordinates only for node ids referenced by matched ways."""

    def __init__(self, wanted):
        super().__init__()
        self.wanted = wanted
        self.coords = {}

    def node(self, n):
        if n.id in self.wanted and n.location.valid():
            self.coords[n.id] = (n.location.lon, n.location.lat)


def main():
    in_pbf = sys.argv[1] if len(sys.argv) > 1 else IN_PBF
    out = sys.argv[2] if len(sys.argv) > 2 else OUT_GEOJSON
    t0 = time.time()

    p1 = Pass1()
    print(f"pass 1: scanning {in_pbf} ...", flush=True)
    p1.apply_file(in_pbf, locations=False)
    print(f"pass 1 done: {len(p1.features)} node facilities, "
          f"{len(p1.way_refs)} way facilities "
          f"({time.time()-t0:.0f}s)", flush=True)

    wanted = set()
    for _, refs in p1.way_refs.values():
        wanted.update(refs)
    print(f"pass 2: resolving {len(wanted)} node coords ...", flush=True)
    p2 = Pass2(wanted)
    p2.apply_file(in_pbf, locations=False)
    print(f"pass 2 done: resolved {len(p2.coords)} "
          f"({time.time()-t0:.0f}s)", flush=True)

    n_way_ok = 0
    for wid, (pr, refs) in p1.way_refs.items():
        lons, lats = [], []
        for r in refs:
            c = p2.coords.get(r)
            if c:
                lons.append(c[0])
                lats.append(c[1])
        if lons:
            n_way_ok += 1
            p1.features.append({
                "type": "Feature",
                "geometry": {"type": "Point",
                             "coordinates": [sum(lons)/len(lons),
                                             sum(lats)/len(lats)]},
                "properties": pr,
            })
    print(f"ways with geometry: {n_way_ok}/{len(p1.way_refs)}", flush=True)

    with open(out, "w") as f:
        json.dump({"type": "FeatureCollection",
                   "features": p1.features}, f)
    print(f"wrote {len(p1.features)} facilities -> {out} "
          f"({time.time()-t0:.0f}s total)")


if __name__ == "__main__":
    main()
