"use client";

import { useEffect, useRef, useState } from "react";

import { ApiRequestError, apiRequest } from "@/lib/logistics-api";

type LocationData = {
  latitude: string;
  longitude: string;
  accuracy_meters: string;
  observed_at: string;
};

type TrackingResponse = {
  shipment_id: number;
  shipment_status: string;
  sharing_status: "starting" | "sharing" | "stale" | "stopped";
  is_sharing: boolean;
  location: LocationData | null;
  last_updated_at: string | null;
  stale_after_seconds: number;
};

type SentPosition = {
  latitude: number;
  longitude: number;
  sentAt: number;
};

const MIN_SEND_INTERVAL_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const MIN_MOVEMENT_METERS = 15;
const MAX_ACCURACY_METERS = 1000;

function distanceMeters(first: SentPosition, latitude: number, longitude: number) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(latitude - first.latitude);
  const longitudeDelta = radians(longitude - first.longitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(first.latitude)) *
      Math.cos(radians(latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  const boundedHaversine = Math.min(1, haversine);
  return 6_371_000 * 2 * Math.atan2(
    Math.sqrt(boundedHaversine),
    Math.sqrt(1 - boundedHaversine),
  );
}

function locationError(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location permission was denied. Allow location access in your browser to share.";
  }
  if (error.code === error.TIMEOUT) {
    return "GPS did not respond in time. Keep this page open and try again.";
  }
  return "Your location is unavailable. Check device location services and try again.";
}

export default function DriverLocationSharing({
  shipmentId,
}: {
  shipmentId: number;
}) {
  const [tracking, setTracking] = useState<TrackingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const watchId = useRef<number | null>(null);
  const serverStarted = useRef(false);
  const requestInFlight = useRef(false);
  const lastPosition = useRef<SentPosition | null>(null);

  useEffect(() => {
    let mounted = true;
    apiRequest<TrackingResponse>(`/shipments/${shipmentId}/tracking/`)
      .then((result) => {
        if (!mounted) return;
        setTracking(result);
        serverStarted.current = result.is_sharing;
        if (result.location) {
          lastPosition.current = {
            latitude: Number(result.location.latitude),
            longitude: Number(result.location.longitude),
            sentAt: new Date(result.location.observed_at).getTime(),
          };
        }
      })
      .catch((reason: unknown) => {
        if (mounted) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not read location-sharing status.",
          );
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [shipmentId]);

  useEffect(
    () => () => {
      if (watchId.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId.current);
      }
      if (serverStarted.current) {
        void apiRequest(`/shipments/${shipmentId}/tracking/stop/`, {
          method: "POST",
        }).catch(() => undefined);
      }
    },
    [shipmentId],
  );

  async function stopServerSharing() {
    const stopped = await apiRequest<TrackingResponse>(
      `/shipments/${shipmentId}/tracking/stop/`,
      { method: "POST" },
    );
    serverStarted.current = false;
    setTracking(stopped);
    return stopped;
  }

  async function stopSharing() {
    if (watchId.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setWorking(true);
    setError("");
    try {
      await stopServerSharing();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? `${reason.message} The server will expire sharing automatically if it cannot be reached.`
          : "Could not confirm that location sharing stopped.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function stopAfterGeolocationError(message: string) {
    if (watchId.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setError(message);
    try {
      await stopServerSharing();
    } catch {
      setError(
        `${message} The server will expire sharing automatically if it cannot be reached.`,
      );
    }
  }

  function sendPosition(position: GeolocationPosition) {
    if (requestInFlight.current) return;
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    const accuracy = position.coords.accuracy;
    const observedAt = new Date(position.timestamp);
    if (accuracy > MAX_ACCURACY_METERS) {
      setError(
        `GPS accuracy is currently ${Math.round(accuracy)} meters. Waiting for a more accurate fix.`,
      );
      return;
    }

    const previous = lastPosition.current;
    const elapsed = previous ? position.timestamp - previous.sentAt : Infinity;
    if (
      previous &&
      (elapsed < MIN_SEND_INTERVAL_MS ||
        (distanceMeters(previous, latitude, longitude) < MIN_MOVEMENT_METERS &&
          elapsed < HEARTBEAT_INTERVAL_MS))
    ) {
      return;
    }
    requestInFlight.current = true;
    void apiRequest<TrackingResponse>(
      `/shipments/${shipmentId}/tracking/location/`,
      {
        method: "POST",
        body: JSON.stringify({
          latitude,
          longitude,
          accuracy_meters: accuracy,
          observed_at: observedAt.toISOString(),
        }),
      },
    )
      .then((result) => {
        setTracking(result);
        setError("");
        lastPosition.current = {
          latitude,
          longitude,
          sentAt: position.timestamp,
        };
      })
      .catch((reason: unknown) => {
        if (
          reason instanceof ApiRequestError &&
          [401, 403, 404, 409].includes(reason.status)
        ) {
          if (watchId.current !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(watchId.current);
            watchId.current = null;
          }
          serverStarted.current = false;
        }
        setError(
          reason instanceof Error
            ? reason.message
            : "The latest GPS update could not be sent.",
        );
      })
      .finally(() => {
        requestInFlight.current = false;
      });
  }

  async function startSharing() {
    if (!navigator.geolocation) {
      setError("This browser does not provide location services.");
      return;
    }
    setWorking(true);
    setError("");
    try {
      const started = await apiRequest<TrackingResponse>(
        `/shipments/${shipmentId}/tracking/start/`,
        { method: "POST" },
      );
      setTracking(started);
      serverStarted.current = true;
      watchId.current = navigator.geolocation.watchPosition(
        sendPosition,
        (geoError) => {
          void stopAfterGeolocationError(locationError(geoError));
        },
        {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout: 15000,
        },
      );
    } catch (reason) {
      const startError = reason instanceof Error
        ? reason.message
        : "Location sharing could not be started.";
      if (serverStarted.current) {
        try {
          await stopServerSharing();
        } catch {
          setError(
            `${startError} The server will expire sharing automatically if it cannot be reached.`,
          );
          return;
        }
      }
      setError(
        startError,
      );
    } finally {
      setWorking(false);
    }
  }

  const isSharing = tracking?.is_sharing ?? false;
  const statusText = tracking?.sharing_status === "sharing"
    ? "Location sharing active"
    : tracking?.sharing_status === "starting"
      ? "Sharing is authorized; waiting for the first GPS fix"
      : tracking?.sharing_status === "stale"
        ? "Last GPS update is stale"
        : "Location sharing is stopped";

  return (
    <section className="location-sharing" aria-labelledby={`location-sharing-${shipmentId}`}>
      <div>
        <p className="eyebrow">DRIVER LOCATION</p>
        <h4 id={`location-sharing-${shipmentId}`}>Shipment #{shipmentId}</h4>
      </div>
      <p role="status" aria-live="polite">{loading ? "Checking location-sharing status…" : statusText}</p>
      {tracking?.location && (
        <p>
          GPS accuracy: {Math.round(Number(tracking.location.accuracy_meters))} m · Last update{" "}
          {new Date(tracking.location.observed_at).toLocaleString()}
        </p>
      )}
      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
      <div className="shipment-actions">
        {isSharing ? (
          <button
            className="button button-warning"
            type="button"
            disabled={working}
            onClick={() => void stopSharing()}
          >
            {working ? "Stopping…" : "Stop sharing location"}
          </button>
        ) : (
          <button
            className="button button-primary"
            type="button"
            disabled={working || loading}
            onClick={() => void startSharing()}
          >
            {working ? "Starting…" : "Start sharing location"}
          </button>
        )}
      </div>
      <p className="location-sharing-note">
        Sharing requires an authorized active shipment and browser permission. Location updates stop when this
        page closes or the shipment becomes ineligible.
      </p>
    </section>
  );
}
