// src/lib/api.ts
const BASE_URL = "https://script.google.com/macros/s/AKfycbytcTFRquKWvg6ZnUf_HDbyNp0DOtA4cB7UWfOa577SKEMKkPi7nli_uslOpv3zUikV_g/exec";
//https://script.google.com/macros/s/AKfycbytcTFRquKWvg6ZnUf_HDbyNp0DOtA4cB7UWfOa577SKEMKkPi7nli_uslOpv3zUikV_g/exec
export type Action =
  | "saveDredger"
  | "saveTransporter"
  | "saveTrip"
  | "updateTrip"
  | "savePayment"
  | "deleteDredger"
  | "deleteTransporter"
  | "deleteTrip"
  | "deletePayment"
  | "deleteTruck"
  | "addTruck"
  | "getDredgers"
  | "getTransporters"
  | "getTrips"
  | "getPayments";

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  deleted?: number;
  deletedCount?: number;
}

export const api = {
  // Generic call – supports both GET (query params) and POST (json body)
  async request<T>(action: Action, params: Record<string, any> = {}): Promise<ApiResponse<T>> {
    const url = new URL(BASE_URL);
    url.searchParams.append("action", action);

    // Add any extra query params (useful for future filtering)
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });

    try {
      const response = await fetch(url.toString(), {
        method: "GET", // we prefer GET for reads when possible
        headers: { "Content-Type": "application/json" },
        mode: 'cors',  // explicit
  // For testing: mode: 'no-cors' (opaque response, but can't read JSON)
        // If we ever need to force POST for some actions, we can add condition here later
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const json = await response.json();
      return json as ApiResponse<T>;
    } catch (err) {
      console.error(`API request failed for ${action}:`, err);
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },

  // Convenience wrappers – feel free to use these in components / hooks
  getDredgers: () => api.request("getDredgers"),
  getTransporters: () => api.request("getTransporters"),
  getTrips: () => api.request("getTrips"),
  getPayments: () => api.request("getPayments"),

  saveDredger: (data: any) => api.request("saveDredger", data),
  saveTransporter: (data: any) => api.request("saveTransporter", data),
  saveTrip: (data: any) => api.request("saveTrip", data),
  updateTrip: (data: any) => api.request("updateTrip", data),
  savePayment: (data: any) => api.request("savePayment", data),

  deleteDredger: (code: string) => api.request("deleteDredger", { code }),
  deleteTransporter: (code: string) => api.request("deleteTransporter", { code }),
  deleteTrip: (rowNumber: number) => api.request("deleteTrip", { rowNumber }),
  deletePayment: (reference: string) => api.request("deletePayment", { reference }),
  deleteTruck: (code: string, plateNumber: string) =>
    api.request("deleteTruck", { code, plateNumber }),
};