import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "@/lib/logistics-api";
import ShipmentLocationMap from "./shipment-location-map";

vi.mock("@/lib/logistics-api", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("leaflet", () => ({
  default: { divIcon: vi.fn(() => ({})) },
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: ReactNode }) => (
    <div aria-label="Map test surface">{children}</div>
  ),
  Marker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TileLayer: () => <div />,
  useMap: () => ({ setView: vi.fn(), getZoom: () => 13 }),
}));

const requestMock = vi.mocked(apiRequest);

describe("shipment location map", () => {
  afterEach(() => {
    cleanup();
    requestMock.mockReset();
  });

  it("labels an expired position as stale and shows it only as a last known position", async () => {
    const staleResponse = {
      shipment_id: 14,
      shipment_status: "in_transit",
      sharing_status: "stale",
      is_sharing: false,
      location: {
        latitude: "9.030000",
        longitude: "38.740000",
        accuracy_meters: "12.50",
        observed_at: "2026-10-17T10:00:00Z",
      },
      last_updated_at: "2026-10-17T10:00:00Z",
      stale_after_seconds: 90,
    };
    requestMock.mockImplementation(async <T,>() => staleResponse as T);

    render(<ShipmentLocationMap shipmentId={14} />);

    expect(
      await screen.findByText("Last known position is stale, not a live position."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Last known position:/)).toBeInTheDocument();
    expect(screen.getByText(/Last known position \(stale\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Map showing the driver's latest authorized position"))
      .toBeInTheDocument();
  });

  it("does not render an unauthorized position after the API denies access", async () => {
    requestMock.mockRejectedValue(new Error("Shipment was not found."));
    render(<ShipmentLocationMap shipmentId={14} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Shipment was not found.",
    );
    expect(screen.queryByLabelText("Map showing the driver's latest authorized position"))
      .not.toBeInTheDocument();
  });
});
