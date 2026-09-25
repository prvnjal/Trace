"""Event engine: cluster thermal detections into physical events.

Two-stage clustering (ported from the legacy event_engine.py):
  1. Spatial DBSCAN with the Haversine metric, eps = 5 km, min_samples = 1.
  2. Temporal split: within each spatial cluster, a gap > 24 h between
     consecutive detections starts a new event.

Operates on plain detection dicts (as produced by firms_ingest.normalize_row)
so it can run with or without the database. Returns event dicts matching the
thermal_events table.
"""
from __future__ import annotations

import logging
from datetime import datetime

import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN

log = logging.getLogger(__name__)

SPATIAL_RADIUS_KM = 5.0
TEMPORAL_WINDOW_HOURS = 24
MIN_SAMPLES = 1  # a real satellite fire event may be a single detection
EARTH_RADIUS_KM = 6371.0088


def _spatial_labels(df: pd.DataFrame) -> pd.Series:
    coords = np.radians(df[["latitude", "longitude"]].to_numpy(dtype=float))
    eps = SPATIAL_RADIUS_KM / EARTH_RADIUS_KM
    labels = DBSCAN(eps=eps, min_samples=MIN_SAMPLES,
                    metric="haversine").fit_predict(coords)
    return pd.Series(labels, index=df.index)


def _temporal_split(df: pd.DataFrame) -> pd.Series:
    """Split each spatial cluster on >24 h gaps. Returns global event labels."""
    df = df.sort_values("detection_timestamp")
    event_labels = pd.Series(-1, index=df.index)
    next_event = 0
    for _, group in df.groupby("spatial_cluster", sort=True):
        group = group.sort_values("detection_timestamp")
        times = pd.to_datetime(group["detection_timestamp"])
        gaps = times.diff().dt.total_seconds().div(3600)
        # new event wherever the gap to the previous detection exceeds the window
        splits = (gaps > TEMPORAL_WINDOW_HOURS).cumsum()
        for _, subgroup in group.groupby(splits):
            event_labels.loc[subgroup.index] = next_event
            next_event += 1
    return event_labels


def cluster_detections(detections: list[dict]) -> list[dict]:
    """Cluster detections into events. Returns one dict per event."""
    if not detections:
        return []
    df = pd.DataFrame(detections)
    df["detection_timestamp"] = pd.to_datetime(df["detection_timestamp"], utc=True)

    df["spatial_cluster"] = _spatial_labels(df)
    df["event_cluster"] = _temporal_split(df)

    events: list[dict] = []
    for cluster_id, group in df.groupby("event_cluster", sort=True):
        lats = group["latitude"].to_numpy(dtype=float)
        lons = group["longitude"].to_numpy(dtype=float)
        times = group["detection_timestamp"]
        first = times.min()
        last = times.max()
        duration_h = (last - first).total_seconds() / 3600.0
        frp = pd.to_numeric(group["frp"], errors="coerce").fillna(0.0)
        bright = pd.to_numeric(group.get("bright_ti4"), errors="coerce")

        events.append({
            "event_code": None,  # assigned on DB insert
            "centroid_lat": float(np.mean(lats)),
            "centroid_lon": float(np.mean(lons)),
            "first_detected": first,
            "last_detected": last,
            "duration_hours": float(duration_h),
            "detection_count": int(len(group)),
            "max_frp": float(frp.max()),
            "mean_frp": float(frp.mean()),
            "total_frp": float(frp.sum()),
            "max_brightness": float(bright.max()) if bright.notna().any() else None,
            "mean_brightness": float(bright.mean()) if bright.notna().any() else None,
            "satellites": sorted(group["satellite"].astype(str).unique().tolist()),
            "detection_ids": group.get("id", group.index).tolist(),
        })
    log.info("clustered %d detections into %d events", len(df), len(events))
    return events
