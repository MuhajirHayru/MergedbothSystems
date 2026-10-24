"use client";

import { useEffect, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";

import { apiRequest } from "@/lib/logistics-api";

type LocationResponse = {
  shipment_id: number;
  shipment_status: string;
  sharing_status: "starting" | "sharing" | "stale" | "stopped";
  is_sharing: boolean;
  location: {
    latitude: string;
    longitude: string;
    accuracy_meters: string;
    observed_at: string;
  } | null;
  last_updated_at: string | null;
  stale_after_seconds: number;
};

const POLL_INTERVAL_MS = 15_000;

function readableStatus(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function RecenterMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([latitude, longitude], map.getZoom(), { animate: true });
  }, [latitude, longitude, map]);
  return null;
}

export default function ShipmentLocationMap({
  shipmentId,
}: {
  shipmentId: number;
}) {
  const [tracking, setTracking] = useState<LocationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    let continuePolling = true;
    let timer: number | undefined;
    let inFlight = false;

    async function poll() {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await apiRequest<LocationResponse>(
          `/shipments/${shipmentId}/tracking/`,
        );
        if (active) {
          setTracking(result);
          setError("");
          setFailed(false);
          setLoading(false);
        }
      } catch (reason) {
        if (active) {
          continuePolling = false;
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load the driver's location.",
          );
          setFailed(true);
          setLoading(false);
        }
      } finally {
        inFlight = false;
        if (active && continuePolling) {
          timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      }
    }

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [shipmentId, retryCount]);

  function retry() {
    setFailed(false);
    setError("");
    setLoading(true);
    setRetryCount((count) => count + 1);
  }

  const point = tracking?.location;
  const coordinates = point
    ? [Number(point.latitude), Number(point.longitude)] as [number, number]
    : null;
  const stale = tracking?.sharing_status === "stale" ||
    tracking?.sharing_status === "stopped";
  const markerIcon = L.divIcon({
    className: "driver-location-marker",
    html: '<span aria-hidden="true"></span>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
  const statusText = tracking?.sharing_status === "sharing"
    ? "Location is fresh and sharing is active."
    : tracking?.sharing_status === "starting"
      ? "Driver has enabled sharing; waiting for a GPS update."
      : tracking?.sharing_status === "stale"
        ? "Last known position is stale, not a live position."
        : "Driver location sharing is stopped.";

  return (
    <section className="shipment-tracking" aria-labelledby={`shipment-map-${shipmentId}`}>
      <div className="section-heading">
        <h4 id={`shipment-map-${shipmentId}`}>Driver location · Shipment #{shipmentId}</h4>
        <span className={`status-pill tracking-status-${tracking?.sharing_status ?? "loading"}`}>
          {tracking?.sharing_status ? tracking.sharing_status : "loading"}
        </span>
      </div>
      {loading && <p role="status">Loading authorized tracking information…</p>}
      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
      {failed && (
        <button className="button button-secondary" type="button" onClick={retry}>
          Retry location request
        </button>
      )}
      {!loading && !error && (
        <>
          <p role="status">{statusText}</p>
          {tracking && (
            <p>Shipment status: {readableStatus(tracking.shipment_status)}</p>
          )}
          {point && (
            <p>
              {stale ? "Last known position" : "Latest position"}: {Number(point.latitude).toFixed(5)},{" "}
              {Number(point.longitude).toFixed(5)} · accuracy ±{Math.round(Number(point.accuracy_meters))} m ·{" "}
              {new Date(point.observed_at).toLocaleString()}
            </p>
          )}
          {!point && <p className="document-empty">No driver location has been shared.</p>}
          {coordinates && point && (
            <div className="shipment-map" aria-label="Map showing the driver's latest authorized position">
              <MapContainer center={coordinates} zoom={13} scrollWheelZoom className="shipment-map-canvas">
                <RecenterMap latitude={coordinates[0]} longitude={coordinates[1]} />
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
                  url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <Marker position={coordinates} icon={markerIcon}>
                  <Popup>
                    {stale ? "Last known position (stale)" : "Latest driver position"}
                    <br />
                    Accuracy ±{Math.round(Number(point.accuracy_meters))} m
                  </Popup>
                </Marker>
              </MapContainer>
            </div>
          )}
        </>
      )}
    </section>
  );
}
