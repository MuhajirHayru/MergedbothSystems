import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "@/lib/logistics-api";
import PhaseThree from "./phase-three";

vi.mock("@/lib/logistics-api", () => ({
  apiBaseUrl: () => "http://localhost:8000/api",
  apiRequest: vi.fn(),
  ApiRequestError: class extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  },
}));
vi.mock("./shipment-location-map", () => ({
  default: () => <div>Mock shipment map</div>,
}));

const requestMock = vi.mocked(apiRequest);
const emptyPage = { count: 0, next: null, previous: null, results: [] };

const assignedShipment = {
  id: 14,
  external_order_reference: null,
  order_verified: true,
  pickup_region: "North",
  pickup_zone: "Highland",
  pickup_wereda: "Market Wereda",
  pickup_address: "Private farm gate",
  destination_region: "North",
  destination_zone: "Highland",
  destination_wereda: "Market Wereda",
  destination_address: "Private receiving depot",
  product_summary: "Two crates of tomatoes",
  cargo_weight_kg: "100.00",
  handling_requirements: "Keep upright",
  status: "assigned",
  currency: "ETB",
  payment_status: "unavailable",
  assigned_driver_username: "driver-one",
  fee_proposals: [],
  current_fee: { amount: "250.00", currency: "ETB" },
  evidence: [],
  evidence_requirements: { pickup: true, delivery: true, max_bytes: 10_485_760 },
  transitions: [],
  exceptions: [],
  estimated_delivery_at: null,
};

describe("Phase 3 shipment workspace", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("submits a real buyer delivery request and refreshes shipment data", async () => {
    let submittedPayload: Record<string, FormDataEntryValue> | undefined;
    requestMock.mockImplementation(async <T,>(
      path: string,
      options?: RequestInit,
    ): Promise<T> => {
      if (path === "/shipments/" && options?.method === "POST") {
        submittedPayload = JSON.parse(String(options.body)) as Record<string, FormDataEntryValue>;
        return { id: 14 } as T;
      }
      if (path === "/shipments/") return [] as T;
      if (path.startsWith("/shipments/notifications/")) return emptyPage as T;
      throw new Error(`Unexpected request: ${path}`);
    });

    const { container } = render(<PhaseThree role="wholesaler" />);
    expect(
      await screen.findByRole("heading", { name: "Delivery requests" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Marketplace order reference"), {
      target: { value: "ORDER-14" },
    });
    fireEvent.change(screen.getByLabelText("Pickup region"), {
      target: { value: "North" },
    });
    fireEvent.change(screen.getByLabelText("Private pickup address"), {
      target: { value: "Farm gate 14" },
    });
    fireEvent.change(screen.getByLabelText("Destination region"), {
      target: { value: "North" },
    });
    fireEvent.change(screen.getByLabelText("Private destination address"), {
      target: { value: "Depot 14" },
    });
    fireEvent.change(screen.getByLabelText("Product/package summary"), {
      target: { value: "One crate" },
    });
    fireEvent.change(screen.getByLabelText("Proposed fee"), {
      target: { value: "75.00" },
    });

    fireEvent.submit(container.querySelector(".shipment-request-form")!);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Driver matching waits for marketplace order verification.",
    );
    expect(submittedPayload).toMatchObject({
      external_order_reference: "ORDER-14",
      pickup_address: "Farm gate 14",
      destination_address: "Depot 14",
      initial_fee: "75.00",
      currency: "ETB",
    });
  });

  it("keeps addresses hidden in an offer and displays them after assignment", async () => {
    let assigned = false;
    let acceptancePayload: unknown;
    requestMock.mockImplementation(async <T,>(
      path: string,
      options?: RequestInit,
    ): Promise<T> => {
      if (path === "/shipments/") return (assigned ? [assignedShipment] : []) as T;
      if (path.startsWith("/shipments/notifications/")) return emptyPage as T;
      if (path === "/drivers/me/shipment-offers/") {
        return (assigned ? [] : [{
          id: 91,
          shipment_id: assignedShipment.id,
          pickup_region: "North",
          destination_region: "North",
          product_summary: assignedShipment.product_summary,
          cargo_weight_kg: "100.00",
          handling_requirements: "Keep upright",
          expires_at: "2026-10-18T09:00:00Z",
          fee_proposal: {
            id: 34,
            version: 1,
            amount: "250.00",
            currency: "ETB",
            proposed_by_role: "wholesaler",
          },
        }]) as T;
      }
      if (path.endsWith("/offers/91/accept/")) {
        acceptancePayload = JSON.parse(String(options?.body));
        assigned = true;
        return assignedShipment as T;
      }
      if (path.startsWith("/shipments/14/messages/")) return emptyPage as T;
      throw new Error(`Unexpected request: ${path} ${options?.method ?? "GET"}`);
    });

    render(<PhaseThree role="driver" />);
    expect(await screen.findByText("Two crates of tomatoes")).toBeInTheDocument();
    expect(screen.queryByText("Private farm gate")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Accept fee and offer" }));
    fireEvent.click(screen.getByRole("alertdialog").querySelector("button.button-primary")!);

    expect(await screen.findByText("Pickup: Private farm gate")).toBeInTheDocument();
    expect(screen.getByText("Destination: Private receiving depot")).toBeInTheDocument();
    expect(acceptancePayload).toEqual({ proposal_id: 34, version: 1 });
  });

  it("requires and submits a reason when rejecting a driver counterproposal", async () => {
    let rejectionPayload: unknown;
    const negotiatingShipment = {
      ...assignedShipment,
      status: "negotiating",
      assigned_driver_username: null,
      fee_proposals: [{
        id: 27,
        version: 1,
        amount: "300.00",
        currency: "ETB",
        status: "proposed",
        proposed_by_role: "driver",
        response_reason: "",
        created_at: "2026-10-18T09:00:00Z",
      }],
    };
    requestMock.mockImplementation(async <T,>(
      path: string,
      options?: RequestInit,
    ): Promise<T> => {
      if (path === "/shipments/") return [negotiatingShipment] as T;
      if (path.startsWith("/shipments/notifications/")) return emptyPage as T;
      if (path.endsWith("/fee-proposals/27/reject/")) {
        rejectionPayload = JSON.parse(String(options?.body));
        return { detail: "Counterproposal rejected." } as T;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<PhaseThree role="wholesaler" />);
    expect(await screen.findByText("Driver counterproposal v1: 300.00 ETB")).toBeInTheDocument();

    const rejectButton = screen.getByRole("button", { name: "Reject" });
    expect(rejectButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Rejection reason for counterproposal 27"), {
      target: { value: "  The requested fee is above the available budget.  " },
    });
    expect(rejectButton).toBeEnabled();
    fireEvent.click(rejectButton);

    expect(await screen.findByText("Counterproposal rejected.", { exact: true })).toBeInTheDocument();
    expect(rejectionPayload).toEqual({
      version: 1,
      reason: "The requested fee is above the available budget.",
    });
  });

  it("submits a new buyer fee proposal as a new version", async () => {
    let proposalPayload: unknown;
    const negotiatingShipment = {
      ...assignedShipment,
      status: "negotiating",
      assigned_driver_username: null,
      fee_proposals: [],
    };
    requestMock.mockImplementation(async <T,>(
      path: string,
      options?: RequestInit,
    ): Promise<T> => {
      if (path === "/shipments/") return [negotiatingShipment] as T;
      if (path.startsWith("/shipments/notifications/")) return emptyPage as T;
      if (path === "/shipments/14/fee-proposals/" && options?.method === "POST") {
        proposalPayload = JSON.parse(String(options.body));
        return { id: 28, version: 2 } as T;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<PhaseThree role="wholesaler" />);
    fireEvent.change(
      await screen.findByLabelText("New fee proposal for shipment 14"),
      { target: { value: "275.00" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send new fee proposal" }));

    expect(await screen.findByText("New fee proposal sent to eligible drivers.")).toBeInTheDocument();
    expect(proposalPayload).toEqual({ amount: "275.00", currency: "ETB" });
  });

  it("lets only the buyer-facing delivery flow confirm receipt", async () => {
    let shipment = {
      ...assignedShipment,
      status: "delivery_confirmation_requested",
    };
    requestMock.mockImplementation(async <T,>(
      path: string,
      options?: RequestInit,
    ): Promise<T> => {
      if (path === "/shipments/") return [shipment] as T;
      if (path.startsWith("/shipments/notifications/")) return emptyPage as T;
      if (path.endsWith("/confirm-delivery/") && options?.method === "POST") {
        shipment = { ...shipment, status: "delivered" };
        return shipment as T;
      }
      if (path.startsWith("/shipments/14/messages/")) return emptyPage as T;
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<PhaseThree role="retailer" />);
    expect(await screen.findByText("Delivery Confirmation Requested")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
    fireEvent.click(screen.getByRole("alertdialog").querySelector("button.button-primary")!);

    expect(await screen.findByText("Delivery confirmed.")).toBeInTheDocument();
    expect(await screen.findByText("Delivered")).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledWith(
      "/shipments/14/confirm-delivery/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reports delivery problems without showing success when the API rejects them", async () => {
    const shipment = {
      ...assignedShipment,
      status: "delivery_confirmation_requested",
    };
    requestMock.mockImplementation(async <T,>(
      path: string,
      options?: RequestInit,
    ): Promise<T> => {
      if (path === "/shipments/") return [shipment] as T;
      if (path.startsWith("/shipments/notifications/")) return emptyPage as T;
      if (path.endsWith("/delivery-problem/") && options?.method === "POST") {
        throw new Error("Could not report delivery problem.");
      }
      if (path.startsWith("/shipments/14/messages/")) return emptyPage as T;
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<PhaseThree role="retailer" />);
    fireEvent.change(await screen.findByLabelText("Problem with delivery"), {
      target: { value: "The parcel is damaged." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
    fireEvent.click(screen.getByRole("alertdialog").querySelector("button.button-danger")!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not report delivery problem.",
    );
    expect(screen.queryByText("Delivery problem recorded and shipment disputed.")).not.toBeInTheDocument();
  });
});
