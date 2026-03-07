import React, { useState, useEffect, useRef } from "react";
import {
  Plus,
  Edit,
  Trash2,
  Download,
  Upload,
  FileSpreadsheet,
  Ship,
  Truck,
  Calendar,
  BarChart3,
  Activity,
} from "lucide-react";
import * as XLSX from "xlsx";

// Custom Naira Icon Component
const NairaIcon: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => (
  <span className={`inline-flex items-center justify-center font-bold ${className}`} style={{ fontSize: "inherit" }}>
    ₦
  </span>
);

// Types
interface Dredger {
  id: string;
  name: string;
  code: string;
  ratePerCbm: number;
  status: "active" | "inactive";
  contractor: string;
  contractNumber: string;
}

// Renamed to TruckRecord to avoid collision with Lucide 'Truck' icon
interface TruckRecord {
  id: string;
  plateNumber: string;
  capacityCbm: number;
  transporterId: string;
  status: "active" | "inactive";
  truckName?: string;
  transporterBillingCbm?: number;
  dredgerBillingCbm?: number;
}

interface Transporter {
  id: string;
  name: string;
  code: string;
  ratePerCbm: number;
  status: "active" | "inactive";
  contractor: string;
  contractNumber: string;
  trucks: TruckRecord[];
  // optional legacy fields (not used for billing; kept for compatibility)
  transporterBillingCbm?: number;
  dredgerBillingCbm?: number;
}

interface Trip {
  id: string;
  date: string;
  dredgerId: string;
  transporterId: string;
  truckId: string;
  plateNumber: string;
  trips: number;
  capacityCbm: number; // use dredger billing CBM for volumes
  totalVolume: number;
  dredgerRate: number;
  transporterRate: number;
  dredgerAmount: number;
  transporterAmount: number;
  transporterBillingCbm?: number; // optional billing capacity just for transporter charges
  dredgerBillingCbm?: number; // stored for reference
  dumpingLocation: string;
  notes: string;
}

interface Payment {
  id: string;
  date: string;
  entityType: "dredger" | "transporter";
  entityId: string;
  amount: number;
  paymentMethod: string;
  reference: string;
  notes: string;
}

// Google Sheets Configuration
const GOOGLE_SHEETS_CONFIG = {
  apiKey: "AIzaSyAYwHOV-1YIa1lAheSZ-fTlh-_UWnWWpgk",
  spreadsheetId: "1RNPjQ-JxUJiF85pBb-0sqbdkWwmGV1Q23cT5qgFFauM",
};

// === DATE HELPERS ===
const formatDisplayDate = (isoOrRaw: string): string => {
  if (!isoOrRaw) return "";

  // Handle ISO-like formats (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrRaw)) {
    const [y, m, d] = isoOrRaw.split("-");
    return `${d}-${m}-${y}`;
  }

  // Handle DD/MM/YYYY or D/M/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(isoOrRaw)) {
    const [d, m, y] = isoOrRaw.split("/");
    return `${d.padStart(2, "0")}-${m.padStart(2, "0")}-${y}`;
  }

  // Handle DD-MM-YYYY or D-M-YYYY
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(isoOrRaw)) {
    const [d, m, y] = isoOrRaw.split("-");
    return `${d.padStart(2, "0")}-${m.padStart(2, "0")}-${y}`;
  }

  // Fallback: try Date.parse
  const dt = new Date(isoOrRaw);
  if (!isNaN(dt.getTime())) {
    const d = String(dt.getDate()).padStart(2, "0");
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const y = dt.getFullYear();
    return `${d}-${m}-${y}`;
  }

  return isoOrRaw;
};

const toSortableISO = (d: string): string => {
  // Convert whatever we got into YYYY-MM-DD for sorting
  if (!d) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; // already ISO

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(d)) {
    const [day, month, year] = d.split("/");
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(d)) {
    const [day, month, year] = d.split("-");
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const dt = new Date(d);
  if (!isNaN(dt.getTime())) {
    const day = String(dt.getDate()).padStart(2, "0");
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const year = dt.getFullYear();
    return `${year}-${month}-${day}`;
  }

  return d; // fallback
};

const generateReference = () => {
  const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PAY-${yyyymmdd}-${rand}`;
};

const parseMoney = (val: any) => {
  if (val === undefined || val === null) return 0;
  const num = parseFloat(String(val).replace(/,/g, ""));
  return Number.isFinite(num) ? num : 0;
};

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const matchesWholeWord = (value: string, query: string) => {
  const q = query.trim();
  if (!q) return true;
  const pattern = new RegExp(`(^|\\b)${escapeRegex(q)}(\\b|$)`, "i");
  return pattern.test(value.trim());
};

const DredgingDashboard: React.FC = () => {
  // State
  const [activeTab, setActiveTab] = useState<
    | "dashboard"
    | "dredgers"
    | "transporters"
    | "trips"
    | "payments"
    | "reports"
    | "transporterReport"
  >("dashboard");
  const [dredgers, setDredgers] = useState<Dredger[]>([]);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  // Modal states
  const [showDredgerModal, setShowDredgerModal] = useState(false);
  const [showTransporterModal, setShowTransporterModal] = useState(false);
  const [showTripModal, setShowTripModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);

  // Search and filter
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState({ start: "", end: "" });
  const [dashboardDateFilter, setDashboardDateFilter] = useState({ start: "", end: "" });

  // Transporter Report filters
  const [trReportFilter, setTrReportFilter] = useState({
    start: "",
    end: "",
    plate: "",
    truckName: "",
    dredgerId: "",
    contractor: "",
    groupBy: "date" as "date" | "truckName" | "plate" | "dredger" | "contractor",
  });

  // Form states
  const [dredgerForm, setDredgerForm] = useState<Partial<Dredger>>({});
  const [transporterForm, setTransporterForm] = useState<Partial<Transporter>>({});
  const [tripForm, setTripForm] = useState<Partial<Trip>>({});
  const [paymentForm, setPaymentForm] = useState<Partial<Payment>>({});

  // File input refs
  const dredgerFileInput = useRef<HTMLInputElement>(null);
  const transporterFileInput = useRef<HTMLInputElement>(null);
  const tripsFileInput = useRef<HTMLInputElement>(null);
  const paymentsFileInput = useRef<HTMLInputElement>(null);

  // Load data from Google Sheets
  useEffect(() => {
    loadDataFromSheets();
  }, []);

  const loadDataFromSheets = async () => {
    try {
      // 1. Load Dredgers
      const drRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Dredgers?key=${GOOGLE_SHEETS_CONFIG.apiKey}`
      );
      const drData = await drRes.json();
      const loadedDredgers = (drData.values || [])
        .slice(1)
        .map((row: any[], i: number) => ({
          id: (row[0] || i).toString() + "_" + i, // Unique ID fix
          code: row[0],
          name: row[1],
          ratePerCbm: parseFloat(row[2]) || 0,
          status: (row[3] || "active").toLowerCase() as any,
          contractor: row[4],
          contractNumber: row[5],
        }))
        .filter((d: any) => d.code);
      setDredgers(loadedDredgers);

      // 2. Load Transporters & Trucks
      const trRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Transporters?key=${GOOGLE_SHEETS_CONFIG.apiKey}`
      );
      const trData = await trRes.json();
      const trRows = trData.values || [];
      const transporterMap = new Map<string, any>();

      trRows.slice(1).forEach((row: any[]) => {
        const code = row[0];
        if (!code) return;

        // Preferred column order (per truck row):
        // 0 Code | 1 Name | 2 RatePerCbm | 3 Status | 4 Contractor | 5 ContractNumber | 6 PlateNumber | 7 TransporterBillingCbm | 8 DredgerBillingCbm | 9 TruckName
        // Legacy fallback (older template):
        // 0 Code | 1 Name | 2 RatePerCbm | 3 Status | 4 Contractor | 5 ContractNumber | 6 PlateNumber | 7 CapacityCbm | 8 TruckName | 9 TransporterBillingCbm | 10 DredgerBillingCbm

        if (!transporterMap.has(code)) {
          transporterMap.set(code, {
            id: code,
            code,
            name: row[1],
            ratePerCbm: parseFloat(row[2]) || 0,
            status: (row[3] || "active").toLowerCase(),
            contractor: row[4],
            contractNumber: row[5],
            trucks: [],
          });
        }

        const plateNumber = row[6];
        const truckName = (row[9] ?? row[8] ?? "Unnamed") as string;

        const transporterBillingCbm = (() => {
          if (row.length > 9) return parseMoney(row[7]); // new format
          return parseMoney(row[9]); // legacy
        })();

        const dredgerBillingCbm = (() => {
          if (row.length > 9) return parseMoney(row[8]); // new format
          return parseMoney(row[10]); // legacy
        })();

        const legacyCapacity = row.length > 9 ? undefined : parseFloat(row[7]);
        const capacityFromBilling = Number.isFinite(dredgerBillingCbm) && dredgerBillingCbm > 0 ? dredgerBillingCbm : undefined;
        const fallbackCapacity = Number.isFinite(transporterBillingCbm) && transporterBillingCbm > 0 ? transporterBillingCbm : undefined;
        const capacityCbm =
          capacityFromBilling ??
          (Number.isFinite(legacyCapacity) ? legacyCapacity : undefined) ??
          fallbackCapacity ??
          0;

        if (plateNumber) {
          const transporter = transporterMap.get(code);
          if (!transporter.trucks.find((t: any) => t.plateNumber === plateNumber)) {
            transporter.trucks.push({
              id: `${code}-${plateNumber}`,
              truckName,
              plateNumber,
              capacityCbm,
              status: "active",
              transporterBillingCbm:
                Number.isFinite(transporterBillingCbm) && transporterBillingCbm > 0
                  ? transporterBillingCbm
                  : undefined,
              dredgerBillingCbm:
                Number.isFinite(dredgerBillingCbm) && dredgerBillingCbm > 0 ? dredgerBillingCbm : undefined,
            });
          }
        }
      });
      setTransporters(Array.from(transporterMap.values()));

      // 3. Load Trips
      const tripRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Trips?key=${GOOGLE_SHEETS_CONFIG.apiKey}`
      );
      const tripData = await tripRes.json();

      setTrips(
        (tripData.values || []).slice(1).map((row: any[], i: number) => {
          const rawDate = row[0] || "";
          const dredgerCode = row[1];
          const transporterCode = row[2];
          const plateNumber = row[3];

          const transporter = transporterMap.get(transporterCode);
          const truck = transporter?.trucks.find((t: any) => t.plateNumber === plateNumber);
          const dredgerBillingCbmRaw = parseMoney(row[12]);
          const transporterBillingCbmRaw = parseMoney(row[11]);

          // Dredger actual/billing capacity for volume (use dredger billing CBM if provided, else truck capacity)
          const dredgerBillingCbm = Number.isFinite(dredgerBillingCbmRaw) && dredgerBillingCbmRaw > 0
            ? dredgerBillingCbmRaw
            : (truck?.dredgerBillingCbm || truck?.capacityCbm || 0);

          const tripsCount = parseInt(row[4]) || 0;
          const dredgerRate = parseMoney(row[5]);
          const transporterRate = parseMoney(row[6]);
          const dredgerAmount = parseMoney(row[9]);
          const transporterAmount = parseMoney(row[10]);

          // Transporter billed volume: sheet column overrides, else transporter setting, else dredger billing cbm
          const transporterBillingCbm = Number.isFinite(transporterBillingCbmRaw) && transporterBillingCbmRaw > 0
            ? transporterBillingCbmRaw
            : (truck?.transporterBillingCbm || dredgerBillingCbm || 0);

          // Total volume uses dredger CBM
          const totalVolume = tripsCount * dredgerBillingCbm;
          const billedTransporterAmount = Number.isFinite(transporterAmount) && transporterAmount > 0
            ? transporterAmount
            : tripsCount * transporterBillingCbm * transporterRate;

          const billedDredgerAmount = Number.isFinite(dredgerAmount) && dredgerAmount > 0
            ? dredgerAmount
            : tripsCount * dredgerBillingCbm * dredgerRate;

          return {
            id: `trip-${i}`,
            date: rawDate,
            dredgerId: loadedDredgers.find((d: Dredger) => d.code === dredgerCode)?.id || "",
            transporterId: transporterCode,
            truckId: truck?.id || "",
            plateNumber: plateNumber,
            trips: tripsCount,
            capacityCbm: dredgerBillingCbm,
            totalVolume,
            dredgerRate,
            transporterRate,
            dredgerAmount: billedDredgerAmount,
            transporterAmount: billedTransporterAmount,
            transporterBillingCbm,
            dredgerBillingCbm,
            dumpingLocation: row[7],
            notes: row[8] || "",
          } satisfies Trip;
        })
      );

      // 4. Load Payments (dedupe by reference, keep latest)
      const payRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Payments?key=${GOOGLE_SHEETS_CONFIG.apiKey}`
      );
      const payData = await payRes.json();

      const paymentsMap = new Map<string, Payment>();
      (payData.values || [])
        .slice(1)
        .forEach((row: any[], i: number) => {
          const ref = (row[5] || `pay-${i}`).toString().trim();
          paymentsMap.set(ref, {
            id: `pay-${i}`,
            date: row[0],
            entityType: (row[1] || "dredger").toLowerCase() as any,
            entityId: row[2],
            amount: parseFloat(row[3]) || 0,
            paymentMethod: row[4] || "Bank Transfer",
            reference: ref,
            notes: row[6] || "",
          });
        });

      setPayments(Array.from(paymentsMap.values()));
    } catch (err) {
      console.error(err);
    }
  };

  // Filtered data for Dashboard
  const dashboardTrips = trips.filter((t) => {
    const isoDate = toSortableISO(t.date);
    const afterStart = !dashboardDateFilter.start || isoDate >= toSortableISO(dashboardDateFilter.start);
    const beforeEnd = !dashboardDateFilter.end || isoDate <= toSortableISO(dashboardDateFilter.end);
    return afterStart && beforeEnd;
  });

  const dashboardPayments = payments.filter((p) => {
    const isoDate = toSortableISO(p.date);
    const afterStart = !dashboardDateFilter.start || isoDate >= toSortableISO(dashboardDateFilter.start);
    const beforeEnd = !dashboardDateFilter.end || isoDate <= toSortableISO(dashboardDateFilter.end);
    return afterStart && beforeEnd;
  });

  // Calculations
  const calculateDredgerEarnings = (dredgerId: string, tripsData = trips, paymentsData = payments) => {
    const dredger = dredgers.find((d) => d.id === dredgerId);
    const dredgerCode = dredger?.code || "";
    const dredgerTrips = tripsData.filter((t) => t.dredgerId === dredgerId);
    const totalVolume = dredgerTrips.reduce((sum, t) => sum + (t.totalVolume ?? 0), 0);
    const totalAmount = dredgerTrips.reduce(
      (sum, t) => sum + (Number.isFinite(t.dredgerAmount) ? t.dredgerAmount : 0),
      0
    );
    const totalPaid = paymentsData
      .filter((p) => p.entityType === "dredger" && (p.entityId === dredgerId || p.entityId === dredgerCode))
      .reduce((sum, p) => sum + p.amount, 0);
    return { totalVolume, totalAmount, totalPaid, balance: totalAmount - totalPaid };
  };

  const calculateTransporterEarnings = (
    transporterId: string,
    tripsData = trips,
    paymentsData = payments
  ) => {
    const transporter = transporters.find((t) => t.id === transporterId);
    const transporterCode = transporter?.code || "";
    const contractorName = transporter?.contractor?.trim() || "";

    const transporterTrips = tripsData.filter((t) => t.transporterId === transporterId);
      const totalTrips = transporterTrips.reduce((sum, t) => sum + (t.trips || 0), 0);
      const totalVolume = transporterTrips.reduce((sum, t) => {
        const vol = Number.isFinite(t.totalVolume)
          ? t.totalVolume
          : (t.capacityCbm || 0) * (t.trips || 0);
        return sum + vol;
      }, 0);
      const totalAmount = transporterTrips.reduce((sum, t) => {
        const billedCbm =
          t.transporterBillingCbm && t.transporterBillingCbm > 0 ? t.transporterBillingCbm : t.capacityCbm || 0;
        const amtFromSheet = Number.isFinite(t.transporterAmount) ? t.transporterAmount : undefined;
        const fallbackAmt = (t.trips || 0) * billedCbm * (t.transporterRate || 0);
        return sum + (amtFromSheet ?? fallbackAmt);
      }, 0);

    const totalPaid = paymentsData
      .filter((p) => {
        if (p.entityType !== "transporter") return false;
        return p.entityId === transporterId || p.entityId === transporterCode || (contractorName && p.entityId === contractorName);
      })
      .reduce((sum, p) => sum + p.amount, 0);

    return {
      totalTrips,
      totalVolume,
      totalAmount,
      totalPaid,
      balance: totalAmount - totalPaid,
    };
  };

    const overallStats = {
    totalVolume: dashboardTrips.reduce((sum, t) => sum + (t.totalVolume ?? 0), 0),
    totalTrips: dashboardTrips.reduce((sum, t) => sum + (t.trips || 0), 0),
    totalDredgerCost: dashboardTrips.reduce((sum, t) => {
      const amt = Number.isFinite(t.dredgerAmount) ? t.dredgerAmount : 0;
      return sum + amt;
    }, 0),
    totalTransporterCost: dashboardTrips.reduce((sum, t) => {
      if (Number.isFinite(t.transporterAmount)) return sum + (t.transporterAmount || 0);
      const billedCbm =
        t.transporterBillingCbm && t.transporterBillingCbm > 0
          ? t.transporterBillingCbm
          : t.capacityCbm || 0;
      return sum + (t.trips || 0) * billedCbm * (t.transporterRate || 0);
    }, 0),
    totalDredgerVolumeMoney: dashboardTrips.reduce((sum, t) => sum + (t.dredgerAmount || 0), 0),
    totalTransporterVolumeMoney: dashboardTrips.reduce((sum, t) => sum + (t.transporterAmount || 0), 0),
    totalPaid: dashboardPayments.reduce((sum, p) => sum + p.amount, 0),
  };


  // Google Apps Script URL
  const APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbwTimTnSOaCkAmPxNAAi3Yio12mr5pxYTywcQfx3lhDkZMzCuKm6omq2g_KxtOdYBws7w/exec";

  const submitToAppsScript = async (action: string, data: any, onSuccess: () => void, silent = false) => {
    const payload = { action, data };

    // Run the POST first, then refresh state after a short buffer to allow Apps Script to append/update
    const send = async () => {
      try {
        await fetch(APPS_SCRIPT_URL, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        console.warn("Fetch error (likely CORS false positive):", error);
      }
    };

    await send();

    // Always refresh after a small delay to re-pull truth from Sheets
    const refreshDelay = 1800;

    if (!silent) {
      setTimeout(async () => {
        await loadDataFromSheets();
        onSuccess();
      }, refreshDelay);
    } else {
      onSuccess();
      setTimeout(() => loadDataFromSheets(), refreshDelay);
    }
  };

  // CRUD Operations
  const saveDredger = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (editingItem) {
      setDredgers((prev) => prev.map((d) => (d.id === editingItem.id ? { ...d, ...dredgerForm } as Dredger : d)));
    } else {
      const newDredger = { ...dredgerForm, id: `temp-${Date.now()}` } as Dredger;
      setDredgers((prev) => [...prev, newDredger]);
    }

    const dredgerData = {
      Code: dredgerForm.code,
      Name: dredgerForm.name,
      RatePerCbm: dredgerForm.ratePerCbm,
      Status: dredgerForm.status || "active",
      Contractor: dredgerForm.contractor || "",
      ContractNumber: dredgerForm.contractNumber || "",
    };

    setShowDredgerModal(false);
    setEditingItem(null);
    setDredgerForm({});

    submitToAppsScript("saveDredger", dredgerData, () => {}, true);
  };

  const saveTransporter = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (editingItem) {
      setTransporters((prev) => prev.map((t) => (t.id === editingItem.id ? { ...t, ...transporterForm } as Transporter : t)));
    } else {
      const newTransporter = { ...transporterForm, id: `temp-${Date.now()}`, trucks: [] } as Transporter;
      setTransporters((prev) => [...prev, newTransporter]);
    }

    // Note: billing CBMs belong to trucks, so when adding transporter (no truck yet) we don't send billing CBMs
    const transporterData = {
      Code: transporterForm.code,
      Name: transporterForm.name,
      RatePerCbm: transporterForm.ratePerCbm,
      Status: transporterForm.status || "active",
      Contractor: transporterForm.contractor || "",
      ContractNumber: transporterForm.contractNumber || "",
      PlateNumber: "",
      CapacityCbm: 0,
    };

    setShowTransporterModal(false);
    setEditingItem(null);
    setTransporterForm({});

    submitToAppsScript("saveTransporter", transporterData, () => {}, true);
  };

  const saveTrip = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const allTrucks = transporters.flatMap((t) => t.trucks);
    const truck = allTrucks.find((tr) => tr.id === tripForm.truckId);
    const dredger = dredgers.find((d) => d.id === tripForm.dredgerId);
    const transporter = transporters.find((t) => t.id === tripForm.transporterId);

    const tripsCount = tripForm.trips || 0;
    const capacity = truck?.capacityCbm || 0; // actual capacity
    const dredgerRate = tripForm.dredgerRate ?? dredger?.ratePerCbm ?? 0;
    const transporterRate = tripForm.transporterRate ?? transporter?.ratePerCbm ?? 0;

    // Default billing CBMs come from the selected truck (per-truck billing), else fall back to actual capacity
    const defaultTransporterBilling = truck?.transporterBillingCbm && truck.transporterBillingCbm > 0
      ? truck.transporterBillingCbm
      : capacity;
    const defaultDredgerBilling = truck?.dredgerBillingCbm && truck.dredgerBillingCbm > 0
      ? truck.dredgerBillingCbm
      : capacity;

    // Optional transporter billing capacity override at trip level (e.g., 13 CBM billed instead of actual 12.8)
    const transporterBillingCbm = tripForm.transporterBillingCbm && tripForm.transporterBillingCbm > 0
      ? tripForm.transporterBillingCbm
      : defaultTransporterBilling;

    // Dredger billing capacity uses dredgerBillingCbm (or capacity)
    const dredgerBillingCbm = defaultDredgerBilling;

    const dredgerAmount = tripForm.dredgerAmount ?? tripsCount * dredgerBillingCbm * dredgerRate;
    const transporterAmount = tripForm.transporterAmount ?? tripsCount * transporterBillingCbm * transporterRate;

    const newTrip: Trip = {
      id: editingItem ? editingItem.id : `temp-${Date.now()}`,
      date: tripForm.date || "",
      dredgerId: tripForm.dredgerId || "",
      transporterId: tripForm.transporterId || "",
      truckId: tripForm.truckId || "",
      plateNumber: truck?.plateNumber || "",
      trips: tripsCount,
      capacityCbm: capacity,
      totalVolume: tripsCount * capacity,
      dredgerRate,
      transporterRate,
      dredgerAmount,
      transporterAmount,
      transporterBillingCbm,
      dumpingLocation: tripForm.dumpingLocation || "",
      notes: tripForm.notes || "",
    };

    if (editingItem) {
      setTrips((prev) => prev.map((t) => (t.id === editingItem.id ? newTrip : t)));
    } else {
      setTrips((prev) => [...prev, newTrip]);
    }

    const tripData = {
      Date: tripForm.date,
      DredgerCode: dredger?.code || "",
      TransporterCode: transporter?.code || "",
      PlateNumber: truck?.plateNumber || "",
      Trips: tripsCount,
      DredgerRate: dredgerRate,
      TransporterRate: transporterRate,
      DumpingLocation: tripForm.dumpingLocation || "",
      Notes: tripForm.notes || "",
      DredgerAmount: dredgerAmount,
      TransporterAmount: transporterAmount,
      TransporterBillingCbm: transporterBillingCbm,
      DredgerBillingCbm: dredgerBillingCbm,
    };

    setShowTripModal(false);
    setEditingItem(null);
    setTripForm({});

    submitToAppsScript("saveTrip", tripData, () => {}, true);
  };

  const savePayment = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    let entityCode = "";
    if ((paymentForm.entityType || "dredger") === "dredger") {
      const entity = dredgers.find((d) => d.id === paymentForm.entityId || d.code === paymentForm.entityId);
      entityCode = entity?.code || paymentForm.entityId || "";
    } else {
      const rawId = paymentForm.entityId || "";
      const matchedTransporter = transporters.find((t) => t.code === rawId || t.id === rawId);
      entityCode = matchedTransporter?.code || rawId;
    }

    const referenceToUse = editingItem?.reference || paymentForm.reference || generateReference();

    const newPayment: Payment = {
      id: editingItem ? editingItem.id : `temp-${Date.now()}`,
      date: paymentForm.date || "",
      entityType: paymentForm.entityType || "dredger",
      entityId: entityCode,
      amount: paymentForm.amount || 0,
      paymentMethod: paymentForm.paymentMethod || "Bank Transfer",
      reference: referenceToUse,
      notes: paymentForm.notes || "",
    };


    if (editingItem) {
      setPayments((prev) => prev.map((p) => (p.id === editingItem.id ? newPayment : p)));
    } else {
      setPayments((prev) => [...prev, newPayment]);
    }

    const capitalizeFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

    const paymentData: any = {
      Date: paymentForm.date,
      EntityType: capitalizeFirst(paymentForm.entityType || "dredger"),
      EntityCode: entityCode,
      Amount: paymentForm.amount,
      PaymentMethod: paymentForm.paymentMethod || "Bank Transfer",
      Reference: newPayment.reference,
      Notes: paymentForm.notes || "",
    };

    setShowPaymentModal(false);
    setEditingItem(null);
    setPaymentForm({});

    if (editingItem) {
      const oldReference = (editingItem.reference || "").trim();
      const newReference = (paymentData.Reference || "").trim();

      const post = async (action: string, data: any) => {
        try {
          await fetch(APPS_SCRIPT_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({ action, data }),
          });
        } catch (err) {
          console.warn(`${action} request sent (no-cors):`, err);
        }
      };

      await post("deletePayment", { Reference: oldReference, reference: oldReference });
      await new Promise((resolve) => setTimeout(resolve, 5200));
      await post("savePayment", { ...paymentData, Reference: newReference || oldReference, reference: newReference || oldReference });
      setTimeout(() => loadDataFromSheets(), 5200);
    } else {
      submitToAppsScript("savePayment", paymentData, () => {}, true);
    }
  };

  const deleteItem = async (type: "dredger" | "transporter" | "trip" | "payment", id: string) => {
    if (!confirm("Are you sure you want to delete this item? This will delete it from Google Sheets permanently.")) return;

    let actionData: any = {};
    let actionName = "";

    if (type === "dredger") {
      setDredgers((prev) => prev.filter((d) => d.id !== id));
      actionName = "deleteDredger";
      actionData = { code: dredgers.find((d) => d.id === id)?.code };
    } else if (type === "transporter") {
      setTransporters((prev) => prev.filter((t) => t.id !== id));
      actionName = "deleteTransporter";
      actionData = { code: transporters.find((t) => t.id === id)?.code };
    } else if (type === "trip") {
      const trip = trips.find((t) => t.id === id);
      setTrips((prev) => prev.filter((t) => t.id !== id));
      actionName = "deleteTrip";
      actionData = {
        date: trip?.date,
        dredgerCode: dredgers.find((d) => d.id === trip?.dredgerId)?.code,
      };
    } else if (type === "payment") {
      const payment = payments.find((p) => p.id === id);
      setPayments((prev) => prev.filter((p) => p.id !== id));
      actionName = "deletePayment";
      actionData = {
        reference: payment?.reference,
      };
    }

    submitToAppsScript(actionName, actionData, () => {}, true);
  };

  const addTruck = async (transporterId: string) => {
    const transporter = transporters.find((t) => t.id === transporterId);
    if (!transporter) return;

    const truckName = prompt("Enter truck name (e.g., TP01, WHITE TRUCK):");
    if (!truckName) return;
    const plateNumber = prompt("Enter truck plate number:");
    if (!plateNumber) return;
    const capacityStr = prompt("Enter truck capacity (CBM):");
    if (!capacityStr) return;
    const capacity = parseFloat(capacityStr);

    const newTruck: TruckRecord = {
      id: `temp-${Date.now()}`,
      truckName,
      plateNumber,
      capacityCbm: capacity,
      transporterId: transporter.id,
      status: "active",
    };

    setTransporters((prev) =>
      prev.map((t) => {
        if (t.id === transporterId) {
          return { ...t, trucks: [...t.trucks, newTruck] };
        }
        return t;
      })
    );

    const truckData = {
      Code: transporter.code,
      Name: transporter.name,
      RatePerCbm: transporter.ratePerCbm,
      Status: transporter.status,
      Contractor: transporter.contractor,
      ContractNumber: transporter.contractNumber,
      PlateNumber: plateNumber,
      CapacityCbm: capacity,
      TruckName: truckName,
    };

    submitToAppsScript("saveTransporter", truckData, () => {}, true);
  };

  const deleteTruck = async (transporterId: string, truckId: string) => {
    if (!confirm("Are you sure you want to delete this truck? This will delete it from Google Sheets.")) return;

    const transporter = transporters.find((t) => t.id === transporterId);
    const truck = transporter?.trucks.find((tr) => tr.id === truckId);

    if (!transporter || !truck) return;

    setTransporters((prev) =>
      prev.map((t) => {
        if (t.id === transporterId) {
          return { ...t, trucks: t.trucks.filter((tr) => tr.id !== truckId) };
        }
        return t;
      })
    );

    const actionData = {
      Code: transporter.code,
      PlateNumber: truck.plateNumber,
    };

    submitToAppsScript("deleteTruck", actionData, () => {}, true);
  };

  // Download template
  const downloadTemplate = (type: "dredgers" | "transporters" | "trips" | "payments") => {
    let csv = "";
    let filename = "";

    if (type === "dredgers") {
      csv = "Code,Name,RatePerCbm,Status,Contractor,ContractNumber\n";
      csv += "DR-001,Dredger Alpha,1550,active,Marine Works Ltd,CNT-2024-001\n";
      filename = "dredgers_template.csv";
    } else if (type === "transporters") {
      csv =
        "Code,Name,RatePerCbm,Status,Contractor,ContractNumber,PlateNumber,TransporterBillingCbm,DredgerBillingCbm,TruckName\n";
      csv += "TR-001,Quick Haul Transport,850,active,Quick Haul Ltd,CNT-2024-101,ABC-123,13,12.8,Truck A\n";
      csv += "TR-001,Quick Haul Transport,850,active,Quick Haul Ltd,CNT-2024-101,ABC-124,13,12.8,Truck B\n";
      filename = "transporters_template.csv";
    }
 else if (type === "trips") {
      csv =
        "Date,DredgerCode,TransporterCode,PlateNumber,Trips,DredgerRate,TransporterRate,DumpingLocation,Notes,DredgerAmount,TransporterAmount,TransporterBillingCbm,DredgerBillingCbm\n";
      csv += "2024-01-15,DR-001,TR-001,ABC-123,5,1500,850,Site A - North,,96000,55250,13,12.8\n";
      csv += "2024-01-15,DR-001,TR-001,ABC-124,6,1500,850,Site A - South,,115200,66300,13,12.8\n";
      csv += "2024-01-16,DR-002,TR-002,XYZ-456,10,1600,900,Site B - East,,204800,117000,12.8,12.8\n";
      filename = "trips_template.csv";
    } else if (type === "payments") {
      csv = "Date,EntityType,EntityId,Amount,PaymentMethod,Reference,Notes\n";
      csv += "2024-01-10,dredger,1,5000000,Bank Transfer,PAY-2024-001,Advance payment\n";
      filename = "payments_template.csv";
    }

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  };

  // Import from Excel
  const handleFileImport = async (
    type: "dredgers" | "transporters" | "trips" | "payments",
    file: File
  ) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

        console.log(`Importing ${jsonData.length} rows for ${type}...`);

        let count = 0;
        for (const row of jsonData) {
          let action = "";
          let payload: any = {};

          if (type === "dredgers") {
            action = "saveDredger";
            payload = {
              Code: row.Code || row.code,
              Name: row.Name || row.name,
              RatePerCbm: row.RatePerCbm || row.ratePerCbm,
              Status: row.Status || row.status || "active",
              Contractor: row.Contractor || row.contractor,
              ContractNumber: row.ContractNumber || row.contractNumber,
            };
          } else if (type === "transporters") {
            action = "saveTransporter";
            payload = {
              Code: row.Code || row.code,
              Name: row.Name || row.name,
              RatePerCbm: row.RatePerCbm || row.ratePerCbm,
              Status: row.Status || row.status || "active",
              Contractor: row.Contractor || row.contractor,
              ContractNumber: row.ContractNumber || row.contractNumber,
              TransporterBillingCbm: row.TransporterBillingCbm || row.transporterBillingCbm || row["Transporter Billing Cbm"] || row["TransporterBillingCbm"],
              DredgerBillingCbm: row.DredgerBillingCbm || row.dredgerBillingCbm || row["Dredger Billing Cbm"] || row["DredgerBillingCbm"],
              PlateNumber: row.PlateNumber || row.plateNumber,
              CapacityCbm: row.CapacityCbm || row.capacityCbm,
              TruckName: row.TruckName || row["Truck Name"] || row.truckName,
            };
          } else if (type === "trips") {
            action = "saveTrip";

            const parseDate = (d: any) => {
              if (!d) return new Date().toISOString().split("T")[0];
              if (typeof d === "string") {
                if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(d)) {
                  const [day, month, year] = d.split("/");
                  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
                }
                return d;
              }
              return d;
            };

            const tripDate = parseDate(row.Date || row.date);
            const dredgerCode = row.DredgerCode || row.dredgerCode;
            const transporterCode = row.TransporterCode || row.transporterCode;
            const plateNumber = row.PlateNumber || row.plateNumber;
            const tripsCount = parseInt(row.Trips || row.trips || 0);
            const drRate = parseMoney(row.DredgerRate || row.dredgerRate || 0);
            const trRate = parseMoney(row.TransporterRate || row.transporterRate || 0);

            let capacity = 0;
            const transporter = transporters.find((t) => t.code === transporterCode);
            if (transporter) {
              const truck = transporter.trucks.find((t: any) => t.plateNumber === plateNumber);
              if (truck) capacity = truck.capacityCbm;
            }

            const dredgerAmountFromSheet = parseMoney(row.DredgerAmount ?? row.dredgerAmount ?? row["Dredger Amount"]);
            const transporterAmountFromSheet = parseMoney(row.TransporterAmount ?? row.transporterAmount ?? row["Transporter Amount"]);
                const transporterBillingCbmFromSheet = parseMoney(row.TransporterBillingCbm ?? row.transporterBillingCbm ?? row["Transporter Billing Cbm"] ?? row["TransporterBillingCbm"]);
            const dredgerBillingCbmFromSheet = parseMoney(row.DredgerBillingCbm ?? row.dredgerBillingCbm ?? row["Dredger Billing Cbm"] ?? row["DredgerBillingCbm"]);

            const transporterBillingCbm = Number.isFinite(transporterBillingCbmFromSheet) && transporterBillingCbmFromSheet > 0
              ? transporterBillingCbmFromSheet
              : (() => {
                  const tr = transporters.find((t) => t.code === transporterCode);
                  const truck = tr?.trucks.find((tk) => tk.plateNumber === plateNumber);
                  return truck?.transporterBillingCbm || truck?.capacityCbm || capacity;
                })();

            const dredgerBillingCbm = Number.isFinite(dredgerBillingCbmFromSheet) && dredgerBillingCbmFromSheet > 0
              ? dredgerBillingCbmFromSheet
              : (() => {
                  const tr = transporters.find((t) => t.code === transporterCode);
                  const truck = tr?.trucks.find((tk) => tk.plateNumber === plateNumber);
                  return truck?.dredgerBillingCbm || truck?.capacityCbm || capacity;
                })();

            payload = {
              Date: tripDate,
              DredgerCode: dredgerCode,
              TransporterCode: transporterCode,
              PlateNumber: plateNumber,
              Trips: tripsCount,
              DredgerRate: drRate,
              TransporterRate: trRate,
              DumpingLocation: row.DumpingLocation || row.dumpingLocation || "",
              Notes: row.Notes || row.notes || "",
              DredgerAmount: dredgerAmountFromSheet || tripsCount * dredgerBillingCbm * drRate,
              TransporterAmount: transporterAmountFromSheet || tripsCount * transporterBillingCbm * trRate,
              TransporterBillingCbm: transporterBillingCbm,
              DredgerBillingCbm: dredgerBillingCbm,
            };
          } else if (type === "payments") {
            action = "savePayment";
            const parseDate = (d: any) => {
              if (!d) return new Date().toISOString().split("T")[0];
              if (typeof d === "string" && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(d)) {
                const [day, month, year] = d.split("/");
                return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
              }
              return d;
            };

            const rawEntityType = (row.EntityType || row.entityType || "dredger").toLowerCase();
            payload = {
              Date: parseDate(row.Date || row.date),
              EntityType: rawEntityType.charAt(0).toUpperCase() + rawEntityType.slice(1),
              EntityCode: row.EntityId || row.entityId || row.EntityCode || row.entityCode,
              Amount: parseMoney(row.Amount || row.amount || 0),
              PaymentMethod: row.PaymentMethod || row.paymentMethod || "Bank Transfer",
              Reference: row.Reference || row.reference || `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
              Notes: row.Notes || row.notes || "",
            };
          }

          if (action) {
            fetch(APPS_SCRIPT_URL, {
              method: "POST",
              mode: "no-cors",
              headers: { "Content-Type": "text/plain" },
              body: JSON.stringify({ action, data: payload }),
            });
            count++;
            await new Promise((r) => setTimeout(r, 300));
          }
        }

        setTimeout(async () => {
          await loadDataFromSheets();
          alert(`Imported approx ${count} rows. Data reloading...`);
        }, 2000);
      } catch (error) {
        alert("Error importing file: " + error);
      }
    };
    reader.readAsBinaryString(file);
  };

  // Export to Excel (CSV format)
  const exportToExcel = (type: "trips" | "dredgers" | "transporters" | "payments") => {
    let csv = "";
    let filename = "";

    if (type === "trips") {
      csv =
        "Date,Dredger Code,Dredger,Transporter Code,Transporter,Plate Number,Trips,Capacity (CBM),Total Volume (CBM),Dredger Rate,Transporter Rate,Dredger Amount,Transporter Amount,Transporter Billing CBM,Dredger Billing CBM,Dumping Location,Notes\n";
      trips.forEach((t) => {
        const dredger = dredgers.find((d) => d.id === t.dredgerId);
        const transporter = transporters.find((tr) => tr.id === t.transporterId || tr.code === t.transporterId);
        const truck = transporter?.trucks.find((tr) => tr.id === t.truckId || tr.plateNumber === t.plateNumber);
        const dredgerAmount = Number.isFinite(t.dredgerAmount) ? t.dredgerAmount : 0;
        const transporterAmount = Number.isFinite(t.transporterAmount)
          ? t.transporterAmount
          : t.totalVolume * (t.transporterRate || 0);
        const transporterBilling = t.transporterBillingCbm ?? truck?.transporterBillingCbm ?? t.capacityCbm;
        const dredgerBilling = truck?.dredgerBillingCbm ?? t.capacityCbm;
        csv += `${t.date},${dredger?.code || ""},${dredger?.name || ""},${transporter?.code || ""},${transporter?.name || ""},${t.plateNumber},${t.trips},${t.capacityCbm},${t.totalVolume},${t.dredgerRate || 0},${t.transporterRate || 0},${dredgerAmount},${transporterAmount},${transporterBilling},${dredgerBilling},${t.dumpingLocation},${t.notes}\n`;
      });
      filename = "trip_report.csv";
    } else if (type === "dredgers") {
      csv = "Code,Name,Rate (per CBM),Status,Contractor,Contract Number\n";
      dredgers.forEach((d) => {
        csv += `${d.code},${d.name},${d.ratePerCbm},${d.status},${d.contractor},${d.contractNumber}\n`;
      });
      filename = "dredgers_report.csv";
    } else if (type === "transporters") {
      csv = "Code,Name,Rate (per CBM),Status,Contractor,Contract Number,Truck Plate,Capacity (CBM)\n";
      transporters.forEach((t) => {
        t.trucks.forEach((truck) => {
          csv += `${t.code},${t.name},${t.ratePerCbm},${t.status},${t.contractor},${t.contractNumber},${truck.plateNumber},${truck.capacityCbm}\n`;
        });
      });
      filename = "transporters_report.csv";
    } else if (type === "payments") {
      csv = "Date,Type,Entity,Amount,Payment Method,Reference,Notes\n";
      payments.forEach((p) => {
        let entityName = "";
        if (p.entityType === "dredger") {
          entityName = dredgers.find((d) => d.id === p.entityId || d.code === p.entityId)?.name || p.entityId || "";
        } else {
          const matchedByCode = transporters.find((t) => t.code === p.entityId || t.id === p.entityId);
          entityName = matchedByCode && matchedByCode.contractor ? matchedByCode.contractor.trim() : p.entityId || "";
        }
        const displayType = p.entityType.charAt(0).toUpperCase() + p.entityType.slice(1);
        csv += `${p.date},${displayType},${entityName},${p.amount},${p.paymentMethod},${p.reference},${p.notes}\n`;
      });
      filename = "payments_report.csv";
    }

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  };

  const contractorOptions = React.useMemo(() => {
    return Array.from(
      new Set(
        transporters
          .map((t) => (t.contractor || "").trim())
          .filter((c) => c.length > 0)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [transporters]);

  // Transporter report filtered & grouped
  const transporterReportRows = React.useMemo(() => {
    const startIso = trReportFilter.start ? toSortableISO(trReportFilter.start) : "";
    const endIso = trReportFilter.end ? toSortableISO(trReportFilter.end) : "";
    const plateSearch = trReportFilter.plate.trim();
    const truckNameSearch = trReportFilter.truckName.trim();
    const dredgerIdFilter = trReportFilter.dredgerId;
    const contractorFilter = trReportFilter.contractor.trim().toLowerCase();

    const filtered = trips.filter((t) => {
      const iso = toSortableISO(t.date);
      if (startIso && iso < startIso) return false;
      if (endIso && iso > endIso) return false;
      const plateVal = (t.plateNumber || "").toLowerCase();
      if (plateSearch && !plateVal.includes(plateSearch.toLowerCase())) return false;
      const transporter = transporters.find((tr) => tr.id === t.transporterId || tr.code === t.transporterId);
      const truck = transporter?.trucks.find((tr) => tr.id === t.truckId || tr.plateNumber === t.plateNumber);
      if (truckNameSearch && !matchesWholeWord(truck?.truckName || "", trReportFilter.truckName)) return false;
      if (dredgerIdFilter && t.dredgerId !== dredgerIdFilter) return false;
      if (contractorFilter) {
        const cName = (transporter?.contractor || "").trim().toLowerCase();
        if (cName !== contractorFilter) return false;
      }
      return true;
    });

    const groupKey = (t: Trip) => {
      if (trReportFilter.groupBy === "date") return toSortableISO(t.date);
      if (trReportFilter.groupBy === "truckName") {
        const truck = transporters.flatMap((tr) => tr.trucks).find((tr) => tr.id === t.truckId || tr.plateNumber === t.plateNumber);
        return (truck?.truckName || "").trim() || "Unnamed";
      }
      if (trReportFilter.groupBy === "plate") return (t.plateNumber || "").trim();
      if (trReportFilter.groupBy === "dredger") {
        const dr = dredgers.find((d) => d.id === t.dredgerId);
        return dr?.name || dr?.code || "";
      }
      if (trReportFilter.groupBy === "contractor") {
        const transporter = transporters.find((tr) => tr.id === t.transporterId || tr.code === t.transporterId);
        return transporter?.contractor || "Unassigned";
      }
      return "";
    };

    const groups = new Map<string, { key: string; rows: Trip[] }>();
    filtered.forEach((t) => {
      const key = groupKey(t) || "(Unspecified)";
      if (!groups.has(key)) groups.set(key, { key, rows: [] });
      groups.get(key)!.rows.push(t);
    });

    const result = Array.from(groups.values()).map((g) => {
      const totalTrips = g.rows.reduce((s, r) => s + (r.trips || 0), 0);
      const totalVolume = g.rows.reduce((s, r) => s + (r.totalVolume || 0), 0);
      return { key: g.key, rows: g.rows, totalTrips, totalVolume };
    });

    // Sort groups by key for determinism (dates newest first if date)
    return result.sort((a, b) => {
      if (trReportFilter.groupBy === "date") return b.key.localeCompare(a.key);
      return a.key.localeCompare(b.key);
    });
  }, [trReportFilter, trips, transporters, dredgers]);

  // Filter & sort trips
  const filteredTrips = trips
    .filter((t) => {
      const lowerSearch = searchTerm.toLowerCase();

      const transporterName = (transporters.find((tr) => tr.id === t.transporterId)?.name || "").toLowerCase();
      const plate = (t.plateNumber || "").toLowerCase();
      const dumping = (t.dumpingLocation || "").toLowerCase();

      const haystack = `${plate} ${transporterName} ${dumping}`;

      const matchSearch = !lowerSearch || haystack.includes(lowerSearch);

      const isoDate = toSortableISO(t.date);
      const afterStart = !dateFilter.start || isoDate >= toSortableISO(dateFilter.start);
      const beforeEnd = !dateFilter.end || isoDate <= toSortableISO(dateFilter.end);

      return matchSearch && afterStart && beforeEnd;
    })
    .sort((a, b) => {
      const aIso = toSortableISO(a.date);
      const bIso = toSortableISO(b.date);
      return bIso.localeCompare(aIso);
    });

  // Payments sorted newest -> oldest by date (falls back to original ordering if missing)
  const sortedPayments = [...payments]
    .filter((p) => !!p)
    .map((p) => ({ ...p, date: p.date || "" }))
    .sort((a, b) => {
      const aIso = toSortableISO(a.date || "");
      const bIso = toSortableISO(b.date || "");
      return bIso.localeCompare(aIso);
    });

  const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-blue-900 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Ship className="w-8 h-8" />
              <div>
                <h1 className="text-2xl font-bold">Dredging Operations Dashboard</h1>
                <p className="text-blue-200 text-sm">Sand Dredging &amp; Haulage Management System</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex space-x-1 overflow-x-auto">
            {[
              { id: "dashboard", label: "Dashboard", icon: BarChart3 },
              { id: "dredgers", label: "Dredgers", icon: Ship },
              { id: "transporters", label: "Transporters", icon: Truck },
              { id: "trips", label: "Daily Trips", icon: Calendar },
              { id: "payments", label: "₦ Payments", icon: Activity },
              { id: "transporterReport", label: "Transporter Report", icon: Truck },
              { id: "reports", label: "Reports", icon: FileSpreadsheet },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-3 flex items-center space-x-2 border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-600 hover:text-gray-900"
                }`}
              >
                <tab.icon className="w-5 h-5" />
                <span className="font-medium">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Dashboard Tab */}
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            <div className="bg-white p-4 rounded-lg shadow-sm flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-lg font-bold text-gray-700">Project Overview</h2>
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600 font-medium">Filter Range:</span>
                <input
                  type="date"
                  value={dashboardDateFilter.start}
                  onChange={(e) => setDashboardDateFilter({ ...dashboardDateFilter, start: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-sm"
                />
                <span className="text-gray-400">-</span>
                <input
                  type="date"
                  value={dashboardDateFilter.end}
                  onChange={(e) => setDashboardDateFilter({ ...dashboardDateFilter, end: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-sm"
                />
                {(dashboardDateFilter.start || dashboardDateFilter.end) && (
                  <button
                    onClick={() => setDashboardDateFilter({ start: "", end: "" })}
                    className="text-sm text-red-600 hover:text-red-800 ml-2"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-500 text-sm">Total Volume</p>
                    <p className="text-2xl font-bold text-blue-600">{overallStats.totalVolume.toLocaleString()} CBM</p>
                  </div>
                  <div className="bg-blue-100 p-3 rounded-full">
                    <Activity className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-500 text-sm">Total Trips</p>
                    <p className="text-2xl font-bold text-green-600">{overallStats.totalTrips.toLocaleString()}</p>
                  </div>
                  <div className="bg-green-100 p-3 rounded-full">
                    <Truck className="w-6 h-6 text-green-600" />
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-500 text-sm">Dredger Cost</p>
                    <p className="text-2xl font-bold text-orange-600">{formatCurrency(overallStats.totalDredgerCost)}</p>
                  </div>
                  <div className="bg-orange-100 p-3 rounded-full">
                    <Ship className="w-6 h-6 text-orange-600" />
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-500 text-sm">Transport Cost</p>
                    <p className="text-2xl font-bold text-purple-600">{formatCurrency(overallStats.totalTransporterCost)}</p>
                  </div>
                  <div className="bg-purple-100 p-3 rounded-full">
                    <Truck className="w-6 h-6 text-purple-600" />
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-500 text-sm">Total Paid</p>
                    <p className="text-2xl font-bold text-red-600">{formatCurrency(overallStats.totalPaid)}</p>
                  </div>
                  <div className="bg-red-100 p-3 rounded-full text-red-600 text-xl">
                    <NairaIcon />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-lg shadow">
                <div className="p-4 border-b flex justify-between items-center">
                  <h3 className="font-bold text-lg">Dredger Summary</h3>
                  <button onClick={() => setActiveTab("dredgers")} className="text-blue-600 hover:underline text-sm">
                    View All
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Dredger</th>
                        <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Volume (CBM)</th>
                        <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Amount</th>
                        <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Paid</th>
                        <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dredgers.map((dredger) => {
                        const earnings = calculateDredgerEarnings(dredger.id, dashboardTrips, dashboardPayments);
                        return (
                          <tr key={dredger.id} className="border-t hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <div className="font-medium">{dredger.name}</div>
                              <div className="text-sm text-gray-500">{dredger.code}</div>
                            </td>
                            <td className="px-4 py-3 text-right">{earnings.totalVolume.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">{formatCurrency(earnings.totalAmount)}</td>
                            <td className="px-4 py-3 text-right text-green-600">{formatCurrency(earnings.totalPaid)}</td>
                            <td
                              className={`px-4 py-3 text-right font-medium ${
                                earnings.balance > 0 ? "text-red-600" : "text-green-600"
                              }`}
                            >
                              {formatCurrency(earnings.balance)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-gray-100 font-bold border-t-2 border-gray-200">
                      <tr>
                        <td className="px-4 py-3 text-gray-800">Totals</td>
                        <td className="px-4 py-3 text-right text-blue-800">
                          {dredgers
                            .reduce(
                              (sum, d) => sum + calculateDredgerEarnings(d.id, dashboardTrips, dashboardPayments).totalVolume,
                              0
                            )
                            .toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-orange-700">
                          {formatCurrency(
                            dredgers.reduce(
                              (sum, d) => sum + calculateDredgerEarnings(d.id, dashboardTrips, dashboardPayments).totalAmount,
                              0
                            )
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-green-700">
                          {formatCurrency(
                            dredgers.reduce(
                              (sum, d) => sum + calculateDredgerEarnings(d.id, dashboardTrips, dashboardPayments).totalPaid,
                              0
                            )
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-red-700">
                          {formatCurrency(
                            dredgers.reduce(
                              (sum, d) => sum + calculateDredgerEarnings(d.id, dashboardTrips, dashboardPayments).balance,
                              0
                            )
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow">
                <div className="p-4 border-b flex justify-between items-center">
                  <h3 className="font-bold text-lg">Transporter Summary</h3>
                  <button onClick={() => setActiveTab("transporters")} className="text-blue-600 hover:underline text-sm">
                    View All
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Contractor</th>
                        <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Trips</th>
                        <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Volume (CBM)</th>
                        <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Amount</th>
                        <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const contractorGroups = new Map<string, { displayName: string; transporters: Transporter[] }>();

                        transporters.forEach((t) => {
                          const rawName = t.contractor && t.contractor.trim() ? t.contractor : "Unassigned";
                          const key = rawName.trim().toLowerCase();

                          if (!contractorGroups.has(key)) {
                            contractorGroups.set(key, { displayName: rawName, transporters: [] });
                          }
                          contractorGroups.get(key)!.transporters.push(t);
                        });

                        return Array.from(contractorGroups.values()).map((group) => {
                          const { displayName, transporters: groupTransporters } = group;

                                              const stats = groupTransporters.reduce(
                            (acc, curr) => {
                              const tStats = calculateTransporterEarnings(curr.id, dashboardTrips, dashboardPayments);
                              return {
                                trips: acc.trips + tStats.totalTrips,
                                volume: acc.volume + tStats.totalVolume,
                                amount: acc.amount + tStats.totalAmount,
                                balance: acc.balance + tStats.balance,
                              };
                            },
                            { trips: 0, volume: 0, amount: 0, balance: 0 }
                          );

                          return (
                            <tr key={displayName} className="border-t hover:bg-gray-50">
                              <td className="px-4 py-3">
                                <div className="font-medium">{displayName}</div>
                              </td>
                              <td className="px-4 py-3 text-right">{stats.trips.toLocaleString()}</td>
                              <td className="px-4 py-3 text-right">{stats.volume.toLocaleString()}</td>
                              <td className="px-4 py-3 text-right">{formatCurrency(stats.amount)}</td>
                              <td
                                className={`px-4 py-3 text-right font-medium ${
                                  stats.balance > 0 ? "text-red-600" : "text-green-600"
                                }`}
                              >
                                {formatCurrency(stats.balance)}
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                    <tfoot className="bg-gray-100 font-bold border-t-2 border-gray-200">
                      <tr>
                        <td className="px-4 py-3 text-gray-800">Totals</td>
                        <td className="px-4 py-3 text-right text-blue-800">
                          {transporters
                            .reduce((sum, t) => sum + calculateTransporterEarnings(t.id, dashboardTrips, dashboardPayments).totalTrips, 0)
                            .toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-blue-800">
                          {transporters
                            .reduce((sum, t) => sum + calculateTransporterEarnings(t.id, dashboardTrips, dashboardPayments).totalVolume, 0)
                            .toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-purple-700">
                          {formatCurrency(
                            transporters.reduce(
                              (sum, t) => sum + calculateTransporterEarnings(t.id, dashboardTrips, dashboardPayments).totalAmount,
                              0
                            )
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-red-700">
                          {formatCurrency(
                            transporters.reduce(
                              (sum, t) => sum + calculateTransporterEarnings(t.id, dashboardTrips, dashboardPayments).balance,
                              0
                            )
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow">
              <div className="p-4 border-b flex justify-between items-center">
                <h3 className="font-bold text-lg">Recent Trips</h3>
                <button onClick={() => setActiveTab("trips")} className="text-blue-600 hover:underline text-sm">
                  View All
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Date</th>
                      <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Dredger</th>
                      <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Transporter</th>
                      <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Plate</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Trips</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Volume</th>
                      <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardTrips.slice(-10).reverse().map((trip) => {
                      const dredger = dredgers.find((d) => d.id === trip.dredgerId);
                      const transporter = transporters.find((t) => t.id === trip.transporterId);
                      return (
                        <tr key={trip.id} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-3">{formatDisplayDate(trip.date)}</td>
                          <td className="px-4 py-3">{dredger?.name}</td>
                          <td className="px-4 py-3">{transporter?.name}</td>
                          <td className="px-4 py-3 font-mono text-sm">{trip.plateNumber}</td>
                          <td className="px-4 py-3 text-right">{trip.trips}</td>
                          <td className="px-4 py-3 text-right">{trip.totalVolume != null ? `${trip.totalVolume.toFixed(2)} CBM` : ""}</td>
                          <td className="px-4 py-3">{trip.dumpingLocation}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Dredgers Tab */}
        {activeTab === "dredgers" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <h2 className="text-2xl font-bold">Dredgers Management</h2>
              <div className="flex space-x-2">
                <button
                  onClick={() => downloadTemplate("dredgers")}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center space-x-2"
                >
                  <FileSpreadsheet className="w-5 h-5" />
                  <span>Download Template</span>
                </button>
                <input
                  ref={dredgerFileInput}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileImport("dredgers", file);
                    if (dredgerFileInput.current) dredgerFileInput.current.value = "";
                  }}
                />
                <button
                  onClick={() => dredgerFileInput.current?.click()}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
                >
                  <Upload className="w-5 h-5" />
                  <span>Import Excel</span>
                </button>
                <button
                  onClick={() => {
                    setEditingItem(null);
                    setDredgerForm({});
                    setShowDredgerModal(true);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"
                >
                  <Plus className="w-5 h-5" />
                  <span>Add Dredger</span>
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Code</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Name</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Rate/CBM</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Contractor</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Contract #</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dredgers.map((dredger) => {
                    return (
                      <tr key={dredger.id} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono">{dredger.code}</td>
                        <td className="px-4 py-3 font-medium">{dredger.name}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(dredger.ratePerCbm)}</td>
                        <td className="px-4 py-3">{dredger.contractor}</td>
                        <td className="px-4 py-3 font-mono text-sm">{dredger.contractNumber}</td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              dredger.status === "active"
                                ? "bg-green-100 text-green-800"
                                : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {dredger.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end space-x-2">
                            <button
                              onClick={() => {
                                setEditingItem(dredger);
                                setDredgerForm(dredger);
                                setShowDredgerModal(true);
                              }}
                              className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deleteItem("dredger", dredger.id)}
                              className="p-1 text-red-600 hover:bg-red-50 rounded"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-bold text-lg mb-4">Dredger Earnings Summary</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Dredger</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Total Volume</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Rate</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Total Amount</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Total Paid</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Balance Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dredgers.map((dredger) => {
                      const earnings = calculateDredgerEarnings(dredger.id);
                      return (
                        <tr key={dredger.id} className="border-t">
                          <td className="px-4 py-3">
                            <div className="font-medium">{dredger.name}</div>
                            <div className="text-sm text-gray-500">{dredger.code}</div>
                          </td>
                          <td className="px-4 py-3 text-right">{earnings.totalVolume.toLocaleString()} CBM</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(dredger.ratePerCbm)}</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(earnings.totalAmount)}</td>
                          <td className="px-4 py-3 text-right text-green-600">{formatCurrency(earnings.totalPaid)}</td>
                          <td
                            className={`px-4 py-3 text-right font-bold ${
                              earnings.balance > 0 ? "text-red-600" : "text-green-600"
                            }`}
                          >
                            {formatCurrency(earnings.balance)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Transporters Tab */}
        {activeTab === "transporters" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <h2 className="text-2xl font-bold">Transporters Management</h2>
              <div className="flex space-x-2">
                <button
                  onClick={() => downloadTemplate("transporters")}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center space-x-2"
                >
                  <FileSpreadsheet className="w-5 h-5" />
                  <span>Download Template</span>
                </button>
                <input
                  ref={transporterFileInput}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileImport("transporters", file);
                    if (transporterFileInput.current) transporterFileInput.current.value = "";
                  }}
                />
                <button
                  onClick={() => transporterFileInput.current?.click()}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
                >
                  <Upload className="w-5 h-5" />
                  <span>Import Excel</span>
                </button>
                <button
                  onClick={() => {
                    setEditingItem(null);
                    setTransporterForm({});
                    setShowTransporterModal(true);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"
                >
                  <Plus className="w-5 h-5" />
                  <span>Add Transporter</span>
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Code</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Name</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Rate/CBM</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Trucks</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Contractor</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transporters.map((transporter) => (
                    <tr key={transporter.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono">{transporter.code}</td>
                      <td className="px-4 py-3 font-medium">{transporter.name}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(transporter.ratePerCbm)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {transporter.trucks.map((truck) => (
                            <span key={truck.id} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-mono">
                              ({truck.truckName || "Unnamed"} - {truck.plateNumber} - {truck.capacityCbm}CBM)
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteTruck(transporter.id, truck.id);
                                }}
                                className="ml-1 text-red-600 hover:text-red-800"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          <button
                            onClick={() => addTruck(transporter.id)}
                            className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs hover:bg-green-200"
                          >
                            + Add Truck
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">{transporter.contractor}</td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            transporter.status === "active"
                              ? "bg-green-100 text-green-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {transporter.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end space-x-2">
                          <button
                            onClick={() => {
                              setEditingItem(transporter);
                              setTransporterForm(transporter);
                              setShowTransporterModal(true);
                            }}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => deleteItem("transporter", transporter.id)}
                            className="p-1 text-red-600 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-bold text-lg mb-4">Transporter Earnings Summary</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Transporter</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Total Trips</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Total Volume</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Rate</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Total Amount</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Total Paid</th>
                      <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Balance Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transporters.map((transporter) => {
                      const earnings = calculateTransporterEarnings(transporter.id);
                      return (
                        <tr key={transporter.id} className="border-t">
                          <td className="px-4 py-3">
                            <div className="font-medium">{transporter.name}</div>
                            <div className="text-sm text-gray-500">{transporter.code}</div>
                          </td>
                          <td className="px-4 py-3 text-right">{earnings.totalTrips.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">{earnings.totalVolume.toLocaleString()} CBM</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(transporter.ratePerCbm)}</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(earnings.totalAmount)}</td>
                          <td className="px-4 py-3 text-right text-green-600">{formatCurrency(earnings.totalPaid)}</td>
                          <td
                            className={`px-4 py-3 text-right font-bold ${
                              earnings.balance > 0 ? "text-red-600" : "text-green-600"
                            }`}
                          >
                            {formatCurrency(earnings.balance)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Trips Tab */}
        {activeTab === "trips" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center flex-wrap gap-4">
              <h2 className="text-2xl font-bold">Daily Trip Reports</h2>
              <div className="flex space-x-2 flex-wrap gap-2">
                <input
                  type="text"
                  placeholder="Search plate, transporter, or location..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="px-3 py-2 border rounded-lg"
                />
                <input
                  type="date"
                  value={dateFilter.start}
                  onChange={(e) => setDateFilter({ ...dateFilter, start: e.target.value })}
                  className="px-3 py-2 border rounded-lg"
                />
                <input
                  type="date"
                  value={dateFilter.end}
                  onChange={(e) => setDateFilter({ ...dateFilter, end: e.target.value })}
                  className="px-3 py-2 border rounded-lg"
                />
                <button
                  onClick={() => downloadTemplate("trips")}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center space-x-2"
                >
                  <FileSpreadsheet className="w-5 h-5" />
                  <span>Template</span>
                </button>
                <input
                  ref={tripsFileInput}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileImport("trips", file);
                    if (tripsFileInput.current) tripsFileInput.current.value = "";
                  }}
                />
                <button
                  onClick={() => tripsFileInput.current?.click()}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
                >
                  <Upload className="w-5 h-5" />
                  <span>Import</span>
                </button>
                <button
                  onClick={() => {
                    setEditingItem(null);
                    setTripForm({ date: new Date().toISOString().split("T")[0] });
                    setShowTripModal(true);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"
                >
                  <Plus className="w-5 h-5" />
                  <span>Add Trip</span>
                </button>
                <button
                  onClick={() => exportToExcel("trips")}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
                >
                  <Download className="w-5 h-5" />
                  <span>Export</span>
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Date</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Dredger</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Transporter</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Truck</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Trips</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Capacity</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Total Volume</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Dumping Location</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTrips.map((trip) => {
                    const dredger = dredgers.find((d) => d.id === trip.dredgerId);
                    const transporter = transporters.find((t) => t.id === trip.transporterId);
                    const truck = transporter?.trucks.find((tr) => tr.id === trip.truckId || tr.plateNumber === trip.plateNumber);

                    const truckDisplay = truck
                      ? `(${truck.plateNumber}${truck.truckName ? " - " + truck.truckName : ""})`
                      : trip.plateNumber;

        const capacityCbm = trip.capacityCbm ?? truck?.capacityCbm ?? 0;
        const totalVolume = trip.totalVolume ?? capacityCbm * (trip.trips ?? 0);

                    return (
                      <tr key={trip.id} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3">{formatDisplayDate(trip.date)}</td>
                        <td className="px-4 py-3">{dredger?.name}</td>
                        <td className="px-4 py-3">{transporter?.name}</td>
                        <td className="px-4 py-3 font-mono text-sm">{truckDisplay}</td>
                        <td className="px-4 py-3 text-right">{trip.trips}</td>
                        <td className="px-4 py-3 text-right">{capacityCbm ? `${capacityCbm.toFixed(2)} CBM` : ""}</td>
                        <td className="px-4 py-3 text-right font-medium">{totalVolume ? `${totalVolume.toFixed(2)} CBM` : ""}</td>
                        <td className="px-4 py-3">{trip.dumpingLocation}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end space-x-2">
                            <button
                              onClick={() => {
                                setEditingItem(trip);
                                setTripForm(trip);
                                setShowTripModal(true);
                              }}
                              className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deleteItem("trip", trip.id)}
                              className="p-1 text-red-600 hover:bg-red-50 rounded"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Payments Tab */}
        {activeTab === "payments" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <h2 className="text-2xl font-bold">Payments Register</h2>
              <div className="flex space-x-2">
                <button
                  onClick={() => downloadTemplate("payments")}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center space-x-2"
                >
                  <FileSpreadsheet className="w-5 h-5" />
                  <span>Template</span>
                </button>
                <input
                  ref={paymentsFileInput}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileImport("payments", file);
                    if (paymentsFileInput.current) paymentsFileInput.current.value = "";
                  }}
                />
                <button
                  onClick={() => paymentsFileInput.current?.click()}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
                >
                  <Upload className="w-5 h-5" />
                  <span>Import</span>
                </button>
                <button
                  onClick={() => {
                    setEditingItem(null);
                    setPaymentForm({ date: new Date().toISOString().split("T")[0], entityType: "dredger" });
                    setShowPaymentModal(true);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"
                >
                  <Plus className="w-5 h-5" />
                  <span>Add Payment</span>
                </button>
                <button
                  onClick={() => exportToExcel("payments")}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
                >
                  <Download className="w-5 h-5" />
                  <span>Export</span>
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Date</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Type</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Entity</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Amount</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Payment Method</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Reference</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Notes</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPayments.map((payment) => {
                    let entityName = "";
                    if (payment.entityType === "dredger") {
                      const dr = dredgers.find((d) => d.id === payment.entityId || d.code === payment.entityId);
                      entityName = dr?.name || payment.entityId || "";
                    } else {
                      const matchedByCode = transporters.find((t) => t.code === payment.entityId || t.id === payment.entityId);
                      if (matchedByCode && matchedByCode.contractor) {
                        entityName = matchedByCode.contractor.trim();
                      } else {
                        entityName = payment.entityId || "";
                      }
                    }

                    return (
                      <tr key={payment.id} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3">{formatDisplayDate(payment.date)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              payment.entityType === "dredger"
                                ? "bg-orange-100 text-orange-800"
                                : "bg-purple-100 text-purple-800"
                            }`}
                          >
                            {payment.entityType.charAt(0).toUpperCase() + payment.entityType.slice(1)}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium">{entityName}</td>
                        <td className="px-4 py-3 text-right font-bold text-green-600">{formatCurrency(payment.amount)}</td>
                        <td className="px-4 py-3">{payment.paymentMethod}</td>
                        <td className="px-4 py-3 font-mono text-sm">{payment.reference}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{payment.notes}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end space-x-2">
                            <button
                              onClick={() => {
                                setEditingItem(payment);
                                setPaymentForm({
                                  ...payment,
                                  // normalize to YYYY-MM-DD for the date input
                                  date: toSortableISO(payment.date || "") || payment.date || new Date().toISOString().split("T")[0],
                                });
                                setShowPaymentModal(true);
                              }}
                              className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deleteItem("payment", payment.id)}
                              className="p-1 text-red-600 hover:bg-red-50 rounded"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Transporter Report Tab */}
        {activeTab === "transporterReport" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center flex-wrap gap-3">
              <h2 className="text-2xl font-bold">Transporter Report</h2>
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  type="date"
                  value={trReportFilter.start}
                  onChange={(e) => setTrReportFilter({ ...trReportFilter, start: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-sm"
                />
                <input
                  type="date"
                  value={trReportFilter.end}
                  onChange={(e) => setTrReportFilter({ ...trReportFilter, end: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-sm"
                />
                <input
                  type="text"
                  placeholder="Filter plate #"
                  value={trReportFilter.plate}
                  onChange={(e) => setTrReportFilter({ ...trReportFilter, plate: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-sm"
                />
                <input
                  type="text"
                  placeholder="Filter truck name"
                  value={trReportFilter.truckName}
                  onChange={(e) => setTrReportFilter({ ...trReportFilter, truckName: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-sm"
                />
                <select
                  value={trReportFilter.dredgerId}
                  onChange={(e) => setTrReportFilter({ ...trReportFilter, dredgerId: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">All Dredgers</option>
                  {dredgers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <select
                  value={trReportFilter.contractor}
                  onChange={(e) => setTrReportFilter({ ...trReportFilter, contractor: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">All Contractors</option>
                  {contractorOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select
                  value={trReportFilter.groupBy}
                  onChange={(e) => setTrReportFilter({ ...trReportFilter, groupBy: e.target.value as any })}
                  className="px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="date">Group by Date</option>
                  <option value="truckName">Group by Truck Name</option>
                  <option value="plate">Group by Plate Number</option>
                  <option value="dredger">Group by Dredger</option>
                  <option value="contractor">Group by Contractor</option>
                </select>
                <button
                  onClick={() =>
                    setTrReportFilter({ start: "", end: "", plate: "", truckName: "", dredgerId: "", contractor: "", groupBy: "date" })
                  }
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow">
              <div className="p-4 border-b flex justify-between items-center">
                <h3 className="font-bold text-lg">Grouped Results</h3>
                <div className="text-sm text-gray-500">Grouping by {trReportFilter.groupBy}</div>
              </div>
              <div className="divide-y">
                {transporterReportRows.map((group) => (
                  <div key={group.key} className="p-4">
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="font-semibold text-lg">{group.key || "(Unspecified)"}</h4>
                      <div className="text-sm text-gray-600 space-x-3">
                        <span>
                          Trips: <strong>{group.totalTrips.toLocaleString()}</strong>
                        </span>
                        <span>
                          Total CBM: <strong>{group.totalVolume.toLocaleString()}</strong>
                        </span>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left">Date</th>
                            <th className="px-3 py-2 text-left">Dredger</th>
                            <th className="px-3 py-2 text-left">Transporter</th>
                            <th className="px-3 py-2 text-left">Truck</th>
                            <th className="px-3 py-2 text-right">Trips</th>
                            <th className="px-3 py-2 text-right">Volume (CBM)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row) => {
                            const dredger = dredgers.find((d) => d.id === row.dredgerId);
                            const transporter = transporters.find((t) => t.id === row.transporterId);
                            const truck = transporter?.trucks.find((tr) => tr.id === row.truckId || tr.plateNumber === row.plateNumber);
                            const capacityCbm = row.capacityCbm ?? truck?.capacityCbm ?? 0;
                            const totalVolume = row.totalVolume ?? capacityCbm * (row.trips ?? 0);
                            return (
                              <tr key={row.id} className="border-t">
                                <td className="px-3 py-2">{formatDisplayDate(row.date)}</td>
                                <td className="px-3 py-2">{dredger?.name}</td>
                                <td className="px-3 py-2">{transporter?.name}</td>
                                <td className="px-3 py-2 font-mono text-xs">
                                  {truck ? `${truck.truckName || ""} (${truck.plateNumber})` : row.plateNumber}
                                </td>
                                <td className="px-3 py-2 text-right">{row.trips}</td>
                                <td className="px-3 py-2 text-right">{totalVolume.toLocaleString()}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-gray-50 font-semibold">
                          <tr>
                            <td className="px-3 py-2" colSpan={4}>
                              Group Totals
                            </td>
                            <td className="px-3 py-2 text-right">{group.totalTrips.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right">{group.totalVolume.toLocaleString()}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                ))}
                {transporterReportRows.length === 0 && (
                  <div className="p-6 text-center text-gray-500">No data for selected filters.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Reports Tab */}
        {activeTab === "reports" && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold">Comprehensive Reports</h2>

            <div className="flex space-x-2 flex-wrap gap-2">
              <button
                onClick={() => exportToExcel("trips")}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
              >
                <Download className="w-5 h-5" />
                <span>Export Trips</span>
              </button>
              <button
                onClick={() => exportToExcel("dredgers")}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"
              >
                <Download className="w-5 h-5" />
                <span>Export Dredgers</span>
              </button>
              <button
                onClick={() => exportToExcel("transporters")}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center space-x-2"
              >
                <Download className="w-5 h-5" />
                <span>Export Transporters</span>
              </button>
              <button
                onClick={() => exportToExcel("payments")}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 flex items-center space-x-2"
              >
                <Download className="w-5 h-5" />
                <span>Export Payments</span>
              </button>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="font-bold text-xl mb-4 flex items-center space-x-2">
                <FileSpreadsheet className="w-6 h-6" />
                <span>Overall Project Summary</span>
              </h3>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Total Volume</p>
                  <p className="text-2xl font-bold text-blue-600">{overallStats.totalVolume.toLocaleString()} CBM</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Total Trips</p>
                  <p className="text-2xl font-bold text-green-600">{overallStats.totalTrips.toLocaleString()}</p>
                </div>
                <div className="bg-orange-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Dredger Cost</p>
                  <p className="text-2xl font-bold text-orange-600">{formatCurrency(overallStats.totalDredgerCost)}</p>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Transport Cost</p>
                  <p className="text-2xl font-bold text-purple-600">{formatCurrency(overallStats.totalTransporterCost)}</p>
                </div>
                <div className="bg-red-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Total Paid</p>
                  <p className="text-2xl font-bold text-red-600">{formatCurrency(overallStats.totalPaid)}</p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm text-gray-600">Total Project Cost</p>
                    <p className="text-2xl font-bold text-gray-800">
                      {formatCurrency(overallStats.totalDredgerCost + overallStats.totalTransporterCost)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Payments Made</p>
                    <p className="text-2xl font-bold text-green-600">{formatCurrency(overallStats.totalPaid)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Outstanding Balance</p>
                    <p className="text-2xl font-bold text-red-600">
                      {formatCurrency(overallStats.totalDredgerCost + overallStats.totalTransporterCost - overallStats.totalPaid)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="font-bold text-xl mb-4">Dredger Performance Report</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Dredger</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Contractor</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Rate/CBM</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Total Volume</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Total Amount</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Total Paid</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Balance</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dredgers.map((dredger) => {
                      const earnings = calculateDredgerEarnings(dredger.id);
                      return (
                        <tr key={dredger.id} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="font-medium">{dredger.name}</div>
                            <div className="text-sm text-gray-500">{dredger.code}</div>
                          </td>
                          <td className="px-4 py-3">{dredger.contractor}</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(dredger.ratePerCbm)}</td>
                          <td className="px-4 py-3 text-right">{earnings.totalVolume.toLocaleString()} CBM</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(earnings.totalAmount)}</td>
                          <td className="px-4 py-3 text-right text-green-600">{formatCurrency(earnings.totalPaid)}</td>
                          <td
                            className={`px-4 py-3 text-right font-bold ${
                              earnings.balance > 0 ? "text-red-600" : "text-green-600"
                            }`}
                          >
                            {formatCurrency(earnings.balance)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {earnings.balance > 0 ? (
                              <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-medium">Due</span>
                            ) : (
                              <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium">Paid</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="font-bold text-xl mb-4">Transporter Performance Report</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Transporter</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Total Trips</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Total Volume</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Total Amount</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Total Paid</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Balance</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const contractorGroups = new Map<string, { displayName: string; transporters: Transporter[] }>();
                      transporters.forEach((t) => {
                        const rawName = t.contractor && t.contractor.trim() ? t.contractor : "Unassigned";
                        const key = rawName.trim().toLowerCase();
                        if (!contractorGroups.has(key)) contractorGroups.set(key, { displayName: rawName, transporters: [] });
                        contractorGroups.get(key)!.transporters.push(t);
                      });

                      return Array.from(contractorGroups.values()).map((group) => {
                        const { displayName, transporters: groupTransporters } = group;

                        const opStats = groupTransporters.reduce(
                          (acc, curr) => {
                            const tStats = calculateTransporterEarnings(curr.id);
                            return {
                              trips: acc.trips + tStats.totalTrips,
                              volume: acc.volume + tStats.totalVolume,
                              amount: acc.amount + tStats.totalAmount,
                            };
                          },
                          { trips: 0, volume: 0, amount: 0 }
                        );

                        const contractorDirectPayments = payments
                          .filter((p) => p.entityType === "transporter" && p.entityId === displayName)
                          .reduce((sum, p) => sum + p.amount, 0);

                        const legacyPayments = payments
                          .filter((p) => p.entityType === "transporter" && groupTransporters.some((t) => t.id === p.entityId))
                          .reduce((sum, p) => sum + p.amount, 0);

                        const totalPaid = contractorDirectPayments + legacyPayments;
                        const balance = opStats.amount - totalPaid;

                        return (
                          <tr key={displayName} className="border-t hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium">{displayName}</td>
                            <td className="px-4 py-3 text-right">{opStats.trips.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">{opStats.volume.toLocaleString()} CBM</td>
                            <td className="px-4 py-3 text-right font-medium">{formatCurrency(opStats.amount)}</td>
                            <td className="px-4 py-3 text-right text-green-600">{formatCurrency(totalPaid)}</td>
                            <td
                              className={`px-4 py-3 text-right font-bold ${balance > 0 ? "text-red-600" : "text-green-600"}`}
                            >
                              {formatCurrency(balance)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {balance > 0 ? (
                                <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-medium">Due</span>
                              ) : (
                                <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium">Paid</span>
                              )}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="font-bold text-xl mb-4 flex items-center space-x-2">
                <span className="text-2xl font-bold">₦</span>
                <span>Accounting Summary</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold mb-3">Dredger Payments</h4>
                  <div className="space-y-2">
                    {dredgers.map((dredger) => {
                      const earnings = calculateDredgerEarnings(dredger.id);
                      return (
                        <div key={dredger.id} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                          <div>
                            <div className="font-medium">{dredger.name}</div>
                            <div className="text-sm text-gray-500">{dredger.code}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-gray-600">Due: {formatCurrency(earnings.totalAmount)}</div>
                            <div className="text-sm text-green-600">Paid: {formatCurrency(earnings.totalPaid)}</div>
                            <div className={`font-bold ${earnings.balance > 0 ? "text-red-600" : "text-green-600"}`}>
                              Balance: {formatCurrency(earnings.balance)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold mb-3">Transporter Payments (By Contractor)</h4>
                  <div className="space-y-2">
                    {(() => {
                      const contractorGroups = new Map<string, { displayName: string; transporters: Transporter[] }>();
                      transporters.forEach((t) => {
                        const rawName = t.contractor && t.contractor.trim() ? t.contractor : "Unassigned";
                        const key = rawName.trim().toLowerCase();
                        if (!contractorGroups.has(key)) contractorGroups.set(key, { displayName: rawName, transporters: [] });
                        contractorGroups.get(key)!.transporters.push(t);
                      });

                      return Array.from(contractorGroups.values()).map((group) => {
                        const { displayName, transporters: groupTransporters } = group;

                        const opStats = groupTransporters.reduce(
                          (acc, curr) => {
                            const tStats = calculateTransporterEarnings(curr.id);
                            return { amount: acc.amount + tStats.totalAmount };
                          },
                          { amount: 0 }
                        );

                        const contractorDirectPayments = payments
                          .filter((p) => p.entityType === "transporter" && p.entityId === displayName)
                          .reduce((sum, p) => sum + p.amount, 0);

                        const legacyPayments = payments
                          .filter((p) => p.entityType === "transporter" && groupTransporters.some((t) => t.id === p.entityId))
                          .reduce((sum, p) => sum + p.amount, 0);

                        const totalPaid = contractorDirectPayments + legacyPayments;
                        const balance = opStats.amount - totalPaid;

                        return (
                          <div key={displayName} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                            <div>
                              <div className="font-medium">{displayName}</div>
                              <div className="text-xs text-gray-500">{groupTransporters.length} Transporter(s)</div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm text-gray-600">Due: {formatCurrency(opStats.amount)}</div>
                              <div className="text-sm text-green-600">Paid: {formatCurrency(totalPaid)}</div>
                              <div className={`font-bold ${balance > 0 ? "text-red-600" : "text-green-600"}`}>
                                Balance: {formatCurrency(balance)}
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {showDredgerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">{editingItem ? "Edit" : "Add"} Dredger</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Code</label>
                <input
                  type="text"
                  value={dredgerForm.code || ""}
                  onChange={(e) => setDredgerForm({ ...dredgerForm, code: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="DR-001"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={dredgerForm.name || ""}
                  onChange={(e) => setDredgerForm({ ...dredgerForm, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Dredger Name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Rate per CBM (₦)</label>
                <input
                  type="number"
                  step="0.01"
                  value={dredgerForm.ratePerCbm || ""}
                  onChange={(e) => setDredgerForm({ ...dredgerForm, ratePerCbm: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Contractor</label>
                <input
                  type="text"
                  value={dredgerForm.contractor || ""}
                  onChange={(e) => setDredgerForm({ ...dredgerForm, contractor: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Contractor Name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Contract Number</label>
                <input
                  type="text"
                  value={dredgerForm.contractNumber || ""}
                  onChange={(e) => setDredgerForm({ ...dredgerForm, contractNumber: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="CNT-2024-XXX"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Status</label>
                <select
                  value={dredgerForm.status || "active"}
                  onChange={(e) => setDredgerForm({ ...dredgerForm, status: e.target.value as "active" | "inactive" })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button
                type="button"
                onClick={() => {
                  setShowDredgerModal(false);
                  setEditingItem(null);
                  setDredgerForm({});
                }}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => saveDredger()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {showTransporterModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">{editingItem ? "Edit" : "Add"} Transporter</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Code</label>
                <input
                  type="text"
                  value={transporterForm.code || ""}
                  onChange={(e) => setTransporterForm({ ...transporterForm, code: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="TR-001"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={transporterForm.name || ""}
                  onChange={(e) => setTransporterForm({ ...transporterForm, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Transporter Name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Rate per CBM (₦)</label>
                <input
                  type="number"
                  step="0.01"
                  value={transporterForm.ratePerCbm || ""}
                  onChange={(e) => setTransporterForm({ ...transporterForm, ratePerCbm: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Contractor</label>
                <input
                  type="text"
                  value={transporterForm.contractor || ""}
                  onChange={(e) => setTransporterForm({ ...transporterForm, contractor: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Contractor Name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Contract Number</label>
                <input
                  type="text"
                  value={transporterForm.contractNumber || ""}
                  onChange={(e) => setTransporterForm({ ...transporterForm, contractNumber: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="CNT-2024-XXX"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Status</label>
                <select
                  value={transporterForm.status || "active"}
                  onChange={(e) => setTransporterForm({ ...transporterForm, status: e.target.value as "active" | "inactive" })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button
                type="button"
                onClick={() => {
                  setShowTransporterModal(false);
                  setEditingItem(null);
                  setTransporterForm({});
                }}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => saveTransporter()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {showTripModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-xl font-bold mb-4">{editingItem ? "Edit" : "Add"} Trip Report</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Date</label>
                <input
                  type="date"
                  value={tripForm.date || ""}
                  onChange={(e) => setTripForm({ ...tripForm, date: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Dredger</label>
                  <select
                    value={tripForm.dredgerId || ""}
                    onChange={(e) => setTripForm({ ...tripForm, dredgerId: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">Select Dredger</option>
                    {dredgers
                      .filter((d) => d.status === "active")
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Transporter</label>
                  <select
                    value={tripForm.transporterId || ""}
                    onChange={(e) => {
                      setTripForm({ ...tripForm, transporterId: e.target.value, truckId: "" });
                    }}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">Select Transporter</option>
                    {transporters
                      .filter((t) => t.status === "active")
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Truck</label>
                <select
                  value={tripForm.truckId || ""}
                  onChange={(e) => {
                    const selectedTruck = transporters
                      .find((t) => t.id === tripForm.transporterId)
                      ?.trucks.find((tr) => tr.id === e.target.value);
                    setTripForm({
                      ...tripForm,
                      truckId: e.target.value,
                      // Default transporter billing CBM to this truck's capacity if not already set
                      transporterBillingCbm:
                        tripForm.transporterBillingCbm !== undefined
                          ? tripForm.transporterBillingCbm
                          : selectedTruck?.capacityCbm,
                    });
                  }}
                  className="w-full px-3 py-2 border rounded-lg"
                  disabled={!tripForm.transporterId}
                >
                  <option value="">Select Truck</option>
                  {transporters
                    .find((t) => t.id === tripForm.transporterId)
                    ?.trucks.filter((tr) => tr.status === "active")
                    .map((truck) => (
                      <option key={truck.id} value={truck.id}>
                        {truck.truckName} ({truck.plateNumber} {truck.capacityCbm} CBM)
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Number of Trips</label>
                <input
                  type="number"
                  value={tripForm.trips || ""}
                  onChange={(e) => setTripForm({ ...tripForm, trips: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="0"
                />
              </div>
              {tripForm.truckId && (
                <div className="bg-blue-50 p-3 rounded space-y-1">
                  <p className="text-sm text-blue-800">
                    <strong>Dredger Volume (actual capacity):</strong> {" "}
                    {(tripForm.trips || 0) *
                      (transporters.flatMap((t) => t.trucks).find((tr) => tr.id === tripForm.truckId)?.capacityCbm || 0)}
                    {" "}
                    CBM
                  </p>
                  <p className="text-sm text-purple-800">
                    <strong>Transporter Billed Volume:</strong> {" "}
                    {(tripForm.trips || 0) *
                      (tripForm.transporterBillingCbm ||
                        transporters.flatMap((t) => t.trucks).find((tr) => tr.id === tripForm.truckId)?.capacityCbm ||
                        0)}
                    {" "}
                    CBM
                  </p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700">Transporter Billing Capacity (CBM)</label>
                <input
                  type="number"
                  step="0.01"
                  value={tripForm.transporterBillingCbm ?? ""}
                  onChange={(e) =>
                    setTripForm({ ...tripForm, transporterBillingCbm: e.target.value ? parseFloat(e.target.value) : undefined })
                  }
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Leave blank to use truck capacity"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Use this if transporter billing CBM differs from actual capacity (e.g., 12.8 actual but bill 13).
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Dumping Location</label>
                <input
                  type="text"
                  value={tripForm.dumpingLocation || ""}
                  onChange={(e) => setTripForm({ ...tripForm, dumpingLocation: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Site A, Location B, etc."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Notes</label>
                <textarea
                  value={tripForm.notes || ""}
                  onChange={(e) => setTripForm({ ...tripForm, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  rows={2}
                  placeholder="Additional notes..."
                />
              </div>
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button
                type="button"
                onClick={() => {
                  setShowTripModal(false);
                  setEditingItem(null);
                  setTripForm({});
                }}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => saveTrip()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">{editingItem ? "Edit" : "Add"} Payment</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Date</label>
                <input
                  type="date"
                  value={paymentForm.date || ""}
                  onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Payment Type</label>
                <select
                  value={paymentForm.entityType || "dredger"}
                  onChange={(e) => setPaymentForm({ ...paymentForm, entityType: e.target.value as "dredger" | "transporter", entityId: "" })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="dredger">Dredger</option>
                  <option value="transporter">Transporter</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Entity</label>
                <select
                  value={
                    (paymentForm.entityType || "dredger") === "dredger"
                      ? dredgers.find((d) => d.id === paymentForm.entityId || d.code === paymentForm.entityId)?.code || paymentForm.entityId || ""
                      : (() => {
                          const raw = paymentForm.entityId || "";
                          const byCode = transporters.find((t) => t.code === raw);
                          if (byCode) return byCode.code;
                          const byId = transporters.find((t) => t.id === raw);
                          if (byId) return byId.code;
                          const byContractor = transporters.find((t) => (t.contractor || "").trim() === raw.trim());
                          if (byContractor) return byContractor.code;
                          return raw;
                        })()
                  }
                  onChange={(e) => setPaymentForm({ ...paymentForm, entityId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="">Select Entity</option>
                  {(paymentForm.entityType || "dredger") === "dredger"
                    ? dredgers.map((d) => (
                        <option key={d.code} value={d.code}>
                          {d.name}
                        </option>
                      ))
                    : transporters
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((t) => (
                          <option key={t.code} value={t.code}>
                            {t.name} ({t.code}{t.contractor ? ` - ${t.contractor}` : ""})
                          </option>
                        ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Amount (₦)</label>
                <input
                  type="number"
                  step="0.01"
                  value={paymentForm.amount || ""}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Payment Method</label>
                <select
                  value={paymentForm.paymentMethod || "Bank Transfer"}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Check">Check</option>
                  <option value="Cash">Cash</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              {/* Reference hidden from user to avoid accidental edits */}
              <input type="hidden" value={paymentForm.reference || ""} readOnly />
              {/* Reference is auto-generated and hidden to avoid accidental edits */}
              <input type="hidden" value={paymentForm.reference || ""} readOnly />
              <div>
                <label className="block text-sm font-medium text-gray-700">Notes</label>
                <textarea
                  value={paymentForm.notes || ""}
                  onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  rows={2}
                  placeholder="Payment notes..."
                />
              </div>
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button
                type="button"
                onClick={() => {
                  setShowPaymentModal(false);
                  setEditingItem(null);
                  setPaymentForm({});
                }}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => savePayment()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export function App() {
  return <DredgingDashboard />;
}

export default App;
