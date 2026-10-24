import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "@/lib/logistics-api";
import DriverLocationSharing from "./driver-location-sharing";

vi.mock("@/lib/logistics-api", () => ({
  apiRequest: vi.fn(),
  ApiRequestError: class extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  },
}));

const requestMock = vi.mocked(apiRequest);
const stoppedResponse = {
  shipment_id: 14,
  shipment_status: "assigned",
  sharing_status: "stopped",
  is_sharing: false,
  location: null,
  last_updated_at: null,
  stale_after_seconds: 90,
};
const startingResponse = {
  ...stoppedResponse,
  sharing_status: "starting",
  is_sharing: true,
};
const sharingResponse = {
  ...startingResponse,
  sharing_status: "sharing",
  location: {
    latitude: "9.030000",
    longitude: "38.740000",
    accuracy_meters: "12.50",
    observed_at: new Date().toISOString(),
  },
};

describe("driver location sharing controls", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path.endsWith("/tracking/")) return stoppedResponse as T;
      if (path.endsWith("/tracking/start/")) return startingResponse as T;
      if (path.endsWith("/tracking/location/")) return sharingResponse as T;
      if (path.endsWith("/tracking/stop/")) return stoppedResponse as T;
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: undefined,
    });
  });

  it("starts only after backend authorization, posts real geolocation, and clears its watch on stop", async () => {
    let onPosition: PositionCallback | undefined;
    const geolocation = {
      watchPosition: vi.fn((success: PositionCallback) => {
        onPosition = success;
        return 37;
      }),
      clearWatch: vi.fn(),
    };
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: geolocation,
    });

    render(<DriverLocationSharing shipmentId={14} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start sharing location" }));

    await waitFor(() => expect(geolocation.watchPosition).toHaveBeenCalledOnce());
    expect(requestMock).toHaveBeenCalledWith(
      "/shipments/14/tracking/start/",
      { method: "POST" },
    );
    onPosition?.({
      timestamp: Date.now(),
      coords: {
        latitude: 9.03,
        longitude: 38.74,
        accuracy: 12.5,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
    } as GeolocationPosition);
    expect(await screen.findByText("Location sharing active")).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledWith(
      "/shipments/14/tracking/location/",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"latitude":9.03'),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop sharing location" }));
    await waitFor(() => expect(geolocation.clearWatch).toHaveBeenCalledWith(37));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/shipments/14/tracking/stop/",
        { method: "POST" },
      ),
    );
  });

  it("stops the server session and explains browser permission denial", async () => {
    let onError: PositionErrorCallback | undefined;
    const geolocation = {
      watchPosition: vi.fn((_success: PositionCallback, error: PositionErrorCallback) => {
        onError = error;
        return 12;
      }),
      clearWatch: vi.fn(),
    };
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: geolocation,
    });
    render(<DriverLocationSharing shipmentId={14} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start sharing location" }));
    await waitFor(() => expect(geolocation.watchPosition).toHaveBeenCalledOnce());

    onError?.({
      code: 1,
      message: "permission denied",
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError);

    expect(
      await screen.findByText(/Location permission was denied/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/shipments/14/tracking/stop/",
        { method: "POST" },
      ),
    );
    expect(geolocation.clearWatch).toHaveBeenCalledWith(12);
  });

  it("does not show active sharing when the backend start request fails", async () => {
    const geolocation = {
      watchPosition: vi.fn(),
      clearWatch: vi.fn(),
    };
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: geolocation,
    });
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path.endsWith("/tracking/")) return stoppedResponse as T;
      if (path.endsWith("/tracking/start/")) throw new Error("Shipment authorization failed.");
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<DriverLocationSharing shipmentId={14} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start sharing location" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Shipment authorization failed.",
    );
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
    expect(screen.queryByText("Location sharing active")).not.toBeInTheDocument();
  });

  it("clears the browser watch and requests server stop when the component unmounts", async () => {
    const geolocation = {
      watchPosition: vi.fn(() => 42),
      clearWatch: vi.fn(),
    };
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: geolocation,
    });
    const view = render(<DriverLocationSharing shipmentId={14} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start sharing location" }));
    await waitFor(() => expect(geolocation.watchPosition).toHaveBeenCalledOnce());

    view.unmount();

    expect(geolocation.clearWatch).toHaveBeenCalledWith(42);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/shipments/14/tracking/stop/",
        { method: "POST" },
      ),
    );
  });

  it("does not call a location active when the real update request fails", async () => {
    let onPosition: PositionCallback | undefined;
    const geolocation = {
      watchPosition: vi.fn((success: PositionCallback) => {
        onPosition = success;
        return 73;
      }),
      clearWatch: vi.fn(),
    };
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: geolocation,
    });
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path.endsWith("/tracking/")) return stoppedResponse as T;
      if (path.endsWith("/tracking/start/")) return startingResponse as T;
      if (path.endsWith("/tracking/location/")) {
        throw new Error("Network connection lost.");
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<DriverLocationSharing shipmentId={14} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start sharing location" }));
    await waitFor(() => expect(geolocation.watchPosition).toHaveBeenCalledOnce());
    onPosition?.({
      timestamp: Date.now(),
      coords: {
        latitude: 9.03,
        longitude: 38.74,
        accuracy: 12.5,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
    } as GeolocationPosition);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Network connection lost.",
    );
    expect(screen.queryByText("Location sharing active")).not.toBeInTheDocument();
    expect(
      screen.getByText("Sharing is authorized; waiting for the first GPS fix"),
    ).toBeInTheDocument();
  });
});
