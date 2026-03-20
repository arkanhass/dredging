import React, { useState, useEffect, useRef, useMemo } from "react";
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
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

// Custom Naira Icon Component
const NairaIcon: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => (
  <span className={`inline-flex items-center justify-center font-bold ${className}`} style={{ fontSize: "inherit" }}>
    ₦
  </span>
);

// Types (unchanged)
interface Dredger {
  id: string;
  name: string;
  code: string;
  ratePerCbm: number;
  status: "active" | "inactive";
  contractor: string;
  contractNumber: string;
}

interface TruckRecord {
  id: string;
  plateNumber: string;
  capacityCbm: number;
  transporterId: string;
  status: "active" | "inactive";
  truckName?: string;
  transporterBillingCbm?: number;
  dredgerBillingCbm?: number;
  ratePerCbm?: number;
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
  capacityCbm: number;
  totalVolume: number;
  dredgerRate: number;
  transporterRate: number;
  dredgerAmount: number;
  transporterAmount: number;
  tripCbm?: number;
  totalTripsVolume?: number;
  dumpingLocation: string;
  notes: string;
  reference: string;
  rowNumber?: number;
  actualLoadedCbm?: number; // added for underload support
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

// DATE HELPERS (unchanged)
const formatDisplayDate = (isoOrRaw: string): string => {
  if (!isoOrRaw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrRaw)) {
    const [y, m, d] = isoOrRaw.split("-");
    return `${d}-${m}-${y}`;
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(isoOrRaw)) {
    const [d, m, y] = isoOrRaw.split("/");
    return `${d.padStart(2, "0")}-${m.padStart(2, "0")}-${y}`;
  }
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(isoOrRaw)) {
    const [d, m, y] = isoOrRaw.split("-");
    return `${d.padStart(2, "0")}-${m.padStart(2, "0")}-${y}`;
  }
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
  if (!d) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
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
  return d;
};



const parseMoney = (val: any) => {
  if (val === undefined || val === null || String(val).trim() === "") return null;
  const num = parseFloat(String(val).replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
};

// ... (keep other helpers like escapeRegex, matchesWholeWord, formatDateSlash)

const DredgingDashboard: React.FC = () => {
  // Refs and states (unchanged)
  const reportOverallRef = useRef<HTMLDivElement>(null);
  const reportDredgerRef = useRef<HTMLDivElement>(null);
  const reportTransporterRef = useRef<HTMLDivElement>(null);
  const reportAccountingRef = useRef<HTMLDivElement>(null);
  const reportTransporterReportRef = useRef<HTMLDivElement>(null);

  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const [activeTab, setActiveTab] = useState<"dashboard" | "dredgers" | "transporters" | "trips" | "payments" | "reports" | "transporterReport">("dashboard");
  const [dredgers, setDredgers] = useState<Dredger[]>([]);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  const [showDredgerModal, setShowDredgerModal] = useState(false);
  const [showTransporterModal, setShowTransporterModal] = useState(false);
  const [showTripModal, setShowTripModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState({ start: "", end: "" });
  const [dashboardDateFilter, setDashboardDateFilter] = useState({ start: "", end: "" });

  const [trReportFilter, setTrReportFilter] = useState({
    start: "",
    end: "",
    plate: "",
    truckName: "",
    dredgerId: "",
    contractor: "",
    groupBy: "date" as "date" | "truckName" | "plate" | "dredger" | "contractor",
  });

  const [dredgerForm, setDredgerForm] = useState<Partial<Dredger>>({});
  const [transporterForm, setTransporterForm] = useState<Partial<Transporter>>({});
  const [tripForm, setTripForm] = useState<Partial<Trip>>({});
  const [paymentForm, setPaymentForm] = useState<Partial<Payment>>({ entityType: "dredger" });
  const [showAddTruckModal, setShowAddTruckModal] = useState(false);
  const [truckForm, setTruckForm] = useState<{
    transporterId: string;
    truckName?: string;
    plateNumber?: string;
    dredgerBillingCbm?: number;
    transporterBillingCbm?: number;
    status?: "active" | "inactive";
  }>({ transporterId: "" });

  const dredgerFileInput = useRef<HTMLInputElement>(null);
  const transporterFileInput = useRef<HTMLInputElement>(null);
  const tripsFileInput = useRef<HTMLInputElement>(null);
  const paymentsFileInput = useRef<HTMLInputElement>(null);
const latestTripDisplay = useMemo(() => {
    if (trips.length === 0) return null;

    const sortedTrips = [...trips].sort((a, b) => {
      const dateA = new Date(toSortableISO(a.date));
      const dateB = new Date(toSortableISO(b.date));
      return dateB.getTime() - dateA.getTime();
    });

    const latestDate = sortedTrips[0]?.date;
    return latestDate ? formatDisplayDate(latestDate) : null;
  }, [trips]);


  const overallStats = useMemo(() => {
  if (trips.length === 0) {
    return {
      totalVolume: 0,
      totalTrips: 0,
      totalDredgerCost: 0,
      totalTransporterCost: 0,
      totalPaid: 0,
    };
  }

  let totalVolume = 0;
  let totalTrips = 0;
  let totalDredgerCost = 0;
  let totalTransporterCost = 0;

  trips.forEach((trip) => {
    totalVolume += trip.totalVolume || 0;
    totalTrips += trip.trips || 0;
    totalDredgerCost += trip.dredgerAmount || 0;
    totalTransporterCost += trip.transporterAmount || 0;
  });

  const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

  return {
    totalVolume,
    totalTrips,
    totalDredgerCost,
    totalTransporterCost,
    totalPaid,
  };
}, [trips, payments]);
const formatCurrency = (value: number | null | undefined): string => {
  if (value == null || isNaN(value)) return "₦0.00";

  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};
const dashboardTrips = useMemo(() => {
  let filtered = trips;

  if (dashboardDateFilter.start) {
    const startDate = new Date(dashboardDateFilter.start);
    filtered = filtered.filter(t => {
      const tripDate = new Date(toSortableISO(t.date));
      return tripDate >= startDate;
    });
  }

  if (dashboardDateFilter.end) {
    const endDate = new Date(dashboardDateFilter.end);
    filtered = filtered.filter(t => {
      const tripDate = new Date(toSortableISO(t.date));
      return tripDate <= endDate;
    });
  }

  return filtered;
}, [trips, dashboardDateFilter]);

// Optional: If payments need date filtering too (currently not in your code)
const dashboardPayments = useMemo(() => payments, [payments]);
  useEffect(() => {
    loadDataFromSheets();
  }, []);

  const loadDataFromSheets = async () => {
    try {
      // Dredgers (unchanged)
      const drRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Dredgers?key=${GOOGLE_SHEETS_CONFIG.apiKey}`
      );
      const drData = await drRes.json();
      const loadedDredgers = (drData.values || [])
        .slice(1)
        .map((row: any[], i: number) => ({
          id: (row[0] || i).toString() + "_" + i,
          code: row[0],
          name: row[1],
          ratePerCbm: parseMoney(row[2]),
          status: (row[3] || "active").toLowerCase() as any,
          contractor: row[4],
          contractNumber: row[5],
        }))
        .filter((d: any) => d.code);
      setDredgers(loadedDredgers);

      // Transporters & Trucks (unchanged)
      const trRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Transporters?key=${GOOGLE_SHEETS_CONFIG.apiKey}`
      );
      const trData = await trRes.json();
      const trRows = trData.values || [];
      const transporterMap = new Map<string, any>();

      trRows.slice(1).forEach((row: any[]) => {
        const code = (row[0] || "").toString().trim();
        if (!code) return;
        const plateNumber = (row[6] || "").toString().trim();
        const tBilling = parseMoney(row[7]);
        const dBilling = parseMoney(row[8]);
        const truckName = (row[9] || "Unnamed").toString().trim();

        if (!transporterMap.has(code)) {
          transporterMap.set(code, {
            id: code,
            code,
            name: (row[1] || "").toString().trim(),
            ratePerCbm: parseMoney(row[2]) || 0,
            status: (row[3] || "active").toString().toLowerCase().trim(),
            contractor: (row[4] || "").toString().trim(),
            contractNumber: (row[5] || "").toString().trim(),
            trucks: [],
          });
        }

        if (plateNumber) {
          const transporter = transporterMap.get(code);
          transporter.trucks.push({
            id: `${code}-${plateNumber}`,
            truckName,
            plateNumber,
            capacityCbm: dBilling || tBilling || 0,
            status: "active",
            transporterBillingCbm: tBilling,
            dredgerBillingCbm: dBilling,
            ratePerCbm: parseMoney(row[2]) || 0,
          });
        }
      });
      setTransporters(Array.from(transporterMap.values()));

      // Trips - updated to respect ActualLoadedCbm
 // Trips - robust version (handles extra columns, defensive access)
// Trips - ultra-safe version
// Trips - ultra-safe version
const tripRes = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Trips?key=${GOOGLE_SHEETS_CONFIG.apiKey}`
);

let tripData;
try {
  tripData = await tripRes.json();
  console.log("Trips raw fetch success - values length:", tripData.values?.length || 0);
  console.log("Sample row 1:", tripData.values?.[1]);
} catch (fetchErr) {
  console.error("Trips fetch/parse failed:", fetchErr);
  setTrips([]);
  return;
}

if (!tripData || !Array.isArray(tripData.values) || tripData.values.length <= 1) {
  console.warn("No valid Trips data from sheet");
  setTrips([]);
  return;
}

try {
  const filteredRows = (tripData.values || []).slice(1).filter((row: any[]) => {
    if (!Array.isArray(row) || row.length < 5) {
      console.log("Dropped - invalid structure:", row);
      return false;
    }

    const dateVal = row[0] ? String(row[0]).trim() : "";
    const dredgerVal = row[1] ? String(row[1]).trim() : "";
    const transporterVal = row[2] ? String(row[2]).trim() : "";
    const tripsRaw = row[4] != null ? String(row[4]).trim() : "";

    const hasDate = dateVal !== "";
    const hasDredger = dredgerVal !== "";
    const hasTransporter = transporterVal !== "";
    const tripsNum = Number(tripsRaw.replace(/[^0-9.]/g, '')); // clean "6 trips" → 6
    const hasTrips = tripsRaw !== "" && !isNaN(tripsNum) && tripsNum > 0;

    if (!hasDate || !hasDredger || !hasTransporter || !hasTrips) {
      console.log("Dropped row:", {
        date: dateVal || "(empty)",
        dredger: dredgerVal || "(empty)",
        transporter: transporterVal || "(empty)",
        tripsRaw: tripsRaw || "(empty)",
        cleanedTrips: tripsNum,
        rowSample: row.slice(0, 10)
      });
    }

    return hasDate && hasDredger && hasTransporter && hasTrips;
  });

  console.log("Rows after filter:", filteredRows.length);
  console.log("First kept row:", filteredRows[0] || "none");

  setTrips(
    filteredRows.map((row: any[], i: number) => {
      const rawDate = row[0] || "";
      const dredgerCode = (row[1] || "").toString().trim();
      const transporterCode = (row[2] || "").toString().trim();
      const plateNumber = (row[3] || "").toString().trim();

      const transporter = transporterMap.get(transporterCode) || null;
      let truck = null;
      if (transporter && Array.isArray(transporter.trucks)) {
        truck = transporter.trucks.find((t: any) =>
          t && t.plateNumber && String(t.plateNumber).trim().toUpperCase() === plateNumber.toUpperCase()
        ) || null;
      }

      const tripCbmRaw = parseMoney(row[11]);
      const actualLoadedCbmRaw = parseMoney(row[12]);
      const totalTripsVolumeRaw = parseMoney(row[13]);

      const tripsCount = Number(row[4]) || 0;
      const dredgerRate = parseMoney(row[5]) || 0;
      const transporterRate = parseMoney(row[6]) || (truck?.ratePerCbm || transporter?.ratePerCbm || 0);
      const dredgerAmount = parseMoney(row[9]) || 0;
      const transporterAmount = parseMoney(row[10]) || 0;

      const tripCbm = actualLoadedCbmRaw !== null && actualLoadedCbmRaw > 0
        ? actualLoadedCbmRaw
        : (tripCbmRaw !== null && tripCbmRaw > 0 ? tripCbmRaw : (truck?.transporterBillingCbm || truck?.dredgerBillingCbm || truck?.capacityCbm || 0));

      const totalVolume = totalTripsVolumeRaw !== null && totalTripsVolumeRaw > 0
        ? totalTripsVolumeRaw
        : tripsCount * tripCbm;

      const billedTransporterAmount = transporterAmount > 0 ? transporterAmount : tripsCount * tripCbm * transporterRate;
      const billedDredgerAmount = dredgerAmount > 0 ? dredgerAmount : tripsCount * tripCbm * dredgerRate;

      const ref = (row.length > 14 && row[14]) ? String(row[14]).trim() : `trip-ref-${i}-${Date.now()}`;

      const rowNumber = i + 2;

      return {
        id: `trip-${i}`,
        date: rawDate,
        dredgerId: loadedDredgers.find((d) => d.code === dredgerCode)?.id || "",
        transporterId: transporterCode,
        truckId: truck?.id || "",
        plateNumber,
        trips: tripsCount,
        capacityCbm: tripCbm,
        totalVolume,
        dredgerRate,
        transporterRate,
        dredgerAmount: billedDredgerAmount,
        transporterAmount: billedTransporterAmount,
        tripCbm,
        totalTripsVolume: totalVolume,
        dumpingLocation: row[7] ? String(row[7]) : "",
        notes: row[8] ? String(row[8]) : "",
        reference: ref,
        rowNumber,
        actualLoadedCbm: actualLoadedCbmRaw ?? undefined,
      } satisfies Trip;
    })
  );

  console.log("Trips successfully processed and set:", trips.length);
} catch (tripsError) {
  console.error("Critical error in Trips processing:", tripsError);
  setTrips([]);
}
      // Payments (unchanged)
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
            amount: parseMoney(row[3]) || 0,
            paymentMethod: row[4] || "Bank Transfer",
            reference: ref,
            notes: row[6] || "",
          });
        });
      setPayments(Array.from(paymentsMap.values()));
    } catch (err) {
      console.error("Load error:", err);
    }
  };

  // ... (keep all other parts like dashboardTrips, calculations, overallStats, etc. unchanged)

  const APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbytcTFRquKWvg6ZnUf_HDbyNp0DOtA4cB7UWfOa577SKEMKkPi7nli_uslOpv3zUikV_g/exec";

  const submitToAppsScript = async (action: string, data: any, onSuccess: () => void, silent = false) => {
    const payload = { action, data };
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`GAS HTTP error: ${response.status} ${response.statusText}`);
        return;
      }

      const result = await response.json();
      console.log("GAS response:", result);

      if (result.success === false) {
        console.error("GAS error:", result.error);
        return;
      }
    } catch (error) {
      console.error("Fetch error:", error);
      return;
    }

    const refreshDelay = 3000;
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
const generateReference = () => {
  const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase(); // 8 chars for safety
  return `TRIP-${yyyymmdd}-${rand}`;
};
  // CRUD - saveTrip FIXED (no duplicate call)
  const saveTrip = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!tripForm.date || !tripForm.dredgerId || !tripForm.transporterId || !tripForm.truckId || !tripForm.trips) {
      alert("Please fill in all required fields: Date, Dredger, Transporter, Truck, and Number of Trips.");
      return;
    }

    const allTrucks = transporters.flatMap((t) => t.trucks);
    const truck = allTrucks.find((tr) => tr.id === tripForm.truckId);
    const dredger = dredgers.find((d) => d.id === tripForm.dredgerId);
    const transporter = transporters.find((t) => t.id === tripForm.transporterId);

    const tripsCount = tripForm.trips || 0;
    const dredgerRate = tripForm.dredgerRate ?? dredger?.ratePerCbm ?? 0;
    const transporterRate = tripForm.transporterRate ?? truck?.ratePerCbm ?? transporter?.ratePerCbm ?? 0;

    const manualCbm = tripForm.capacityCbm && tripForm.capacityCbm > 0 ? tripForm.capacityCbm : null;
    //const tripCbmVal = manualCbm ?? (truck?.transporterBillingCbm || truck?.capacityCbm || 0);
// Use manual Capacity (CBM) as the actual loaded value if provided
  // Fallback to truck transporterBillingCbm or capacityCbm
  const tripCbmVal = 
  tripForm.capacityCbm && tripForm.capacityCbm > 0
    ? tripForm.capacityCbm
    : (truck?.transporterBillingCbm || truck?.dredgerBillingCbm || truck?.capacityCbm || 0);

    const totalTripsVolume = tripsCount * tripCbmVal;
    const dredgerAmount = tripForm.dredgerAmount ?? (tripsCount * tripCbmVal * dredgerRate);
    const transporterAmount = tripForm.transporterAmount ?? (tripsCount * tripCbmVal * transporterRate);

    const refToUse = editingItem?.reference || generateReference();

    const newTrip: Trip = {
      id: editingItem ? editingItem.id : `temp-${Date.now()}`,
      date: tripForm.date || "",
      dredgerId: tripForm.dredgerId || "",
      transporterId: tripForm.transporterId || "",
      truckId: tripForm.truckId || "",
      plateNumber: truck?.plateNumber || "",
      trips: tripsCount,
      capacityCbm: tripCbmVal,
      totalVolume: totalTripsVolume,
      dredgerRate,
      transporterRate,
      dredgerAmount,
      transporterAmount,
      tripCbm: tripCbmVal,
      
      totalTripsVolume,
      dumpingLocation: tripForm.dumpingLocation || "",
      notes: tripForm.notes || "",
      reference: refToUse,
      rowNumber: editingItem?.rowNumber,
      actualLoadedCbm: tripCbmVal,
    };

    setShowTripModal(false);
    const oldItem = editingItem;
    setEditingItem(null);
    setTripForm({});

    if (oldItem) {
      setTrips((prev) => prev.map((t) => (t.id === oldItem.id ? newTrip : t)));
    } else {
      setTrips((prev) => [...prev, newTrip]);
    }

    const tripData = {
  Date: newTrip.date,
  DredgerCode: dredger?.code || "",
  TransporterCode: transporter?.code || "",
  PlateNumber: truck?.plateNumber || "",
  Trips: tripsCount,
  DredgerRate: dredgerRate,
  TransporterRate: transporterRate,
  DumpingLocation: newTrip.dumpingLocation || "",
  Notes: newTrip.notes || "",
  DredgerAmount: dredgerAmount,
  TransporterAmount: transporterAmount,
  TripCBM: tripCbmVal,                    // → column L
  ActualLoadedCbm: tripCbmVal,            // → column M (same value as Capacity input)
  TotalTripsVolume: totalTripsVolume,     // → column N
  Reference: refToUse,
  rowNumber: oldItem?.rowNumber,
  Row: oldItem?.rowNumber
};

    const action = oldItem ? "updateTrip" : "saveTrip";

    submitToAppsScript(action, tripData, () => {
      console.log(`Trip ${oldItem ? "updated" : "saved"} sent`);
    }, false);
  };

  // ... (keep all other functions unchanged: saveDredger, saveTransporter, savePayment, deleteItem, etc.)

  // Return JSX (unchanged)
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
              <div className="flex items-center space-x-3">
                <h2 className="text-lg font-bold text-gray-700">Project Overview</h2>
                {latestTripDisplay && (
                  <span className="text-sm text-gray-500">— up to {latestTripDisplay}</span>
                )}
              </div>
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

            <div className="grid grid-cols-1 gap-6">
              <div className="bg-white rounded-lg shadow">
                <div className="p-4 border-b flex justify-between items-center">
                  <h3 className="font-bold text-lg">Dredger Summary</h3>
                  <button onClick={() => setActiveTab("dredgers")} className="text-blue-600 hover:underline text-sm">View All</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[800px] text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">Dredgers</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-600">Volume (CBM)</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-600">Rate/CBM</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-600">Amount</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-600">Paid</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-600">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dredgers.map((dredger) => {
                        const earnings = calculateDredgerEarnings(dredger.id, dashboardTrips, dashboardPayments);
                        return (
                          <tr key={dredger.id} className="border-t hover:bg-gray-50">
                            <td className="px-4 py-2">
                              <div className="font-medium leading-snug">{dredger.name}</div>
                              <div className="text-xs text-gray-500">{dredger.code}</div>
                            </td>
                            <td className="px-4 py-2 text-right">{earnings.totalVolume.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right">{formatCurrency(dredger.ratePerCbm)}</td>
                            <td className="px-4 py-2 text-right">{formatCurrency(earnings.totalAmount)}</td>
                            <td className="px-4 py-2 text-right text-green-600">{formatCurrency(earnings.totalPaid)}</td>
                            <td className={`px-4 py-2 text-right font-medium ${earnings.balance > 0 ? "text-red-600" : "text-green-600"}`}>
                              {formatCurrency(earnings.balance)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-gray-100 font-bold border-t-2 border-gray-200">
                      <tr>
                        <td className="px-4 py-2 text-gray-800">Totals</td>
                        <td className="px-4 py-2 text-right text-blue-800">
                          {dredgers.reduce((sum, d) => sum + calculateDredgerEarnings(d.id, dashboardTrips, dashboardPayments).totalVolume, 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right"></td>
                        <td className="px-4 py-2 text-right text-orange-700">
                          {formatCurrency(dredgers.reduce((sum, d) => sum + calculateDredgerEarnings(d.id, dashboardTrips, dashboardPayments).totalAmount, 0))}
                        </td>
                        <td className="px-4 py-2 text-right text-green-700">
                          {formatCurrency(dredgers.reduce((sum, d) => sum + calculateDredgerEarnings(d.id, dashboardTrips, dashboardPayments).totalPaid, 0))}
                        </td>
                        <td className="px-4 py-2 text-right text-red-700">
                          {formatCurrency(dredgers.reduce((sum, d) => sum + calculateDredgerEarnings(d.id, dashboardTrips, dashboardPayments).balance, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow">
                <div className="p-4 border-b flex justify-between items-center">
                  <h3 className="font-bold text-lg">Transporters Summary</h3>
                  <button onClick={() => setActiveTab("transporters")} className="text-blue-600 hover:underline text-sm">View All</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[800px] text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">Contractor</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-600">Trips</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-600">Volume (CBM)</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-600">Amount</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-600">Paid</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-600">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const contractorGroups = new Map<string, { displayName: string; transportersList: Transporter[] }>();
                        transporters.forEach((t) => {
                          const rawName = t.contractor && t.contractor.trim() ? t.contractor : "Unassigned";
                          const key = rawName.trim().toLowerCase();
                          if (!contractorGroups.has(key)) contractorGroups.set(key, { displayName: rawName, transportersList: [] });
                          contractorGroups.get(key)!.transportersList.push(t);
                        });
                        return Array.from(contractorGroups.values()).map((group) => {
                          const { displayName, transportersList } = group;
                          const opStats = transportersList.reduce(
                            (acc, curr) => {
                              const tStats = calculateTransporterEarnings(curr.id, dashboardTrips, dashboardPayments);
                              return {
                                trips: acc.trips + tStats.totalTrips,
                                volume: acc.volume + tStats.totalVolume,
                                amount: acc.amount + tStats.totalAmount,
                                paid: acc.paid + tStats.totalPaid,
                              };
                            },
                            { trips: 0, volume: 0, amount: 0, paid: 0 }
                          );
                          const balance = opStats.amount - opStats.paid;
                          return (
                            <tr key={displayName} className="border-t hover:bg-gray-50">
                              <td className="px-4 py-2 font-medium">{displayName}</td>
                              <td className="px-4 py-2 text-right">{opStats.trips.toLocaleString()}</td>
                              <td className="px-4 py-2 text-right">{opStats.volume.toLocaleString()}</td>
                              <td className="px-4 py-2 text-right">{formatCurrency(opStats.amount)}</td>
                              <td className="px-4 py-2 text-right text-green-600">{formatCurrency(opStats.paid)}</td>
                              <td className={`px-4 py-2 text-right font-medium ${balance > 0 ? "text-red-600" : "text-green-600"}`}>
                                {formatCurrency(balance)}
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow">
                <div className="p-4 border-b flex justify-between items-center">
                  <h3 className="font-bold text-lg">Recent Trips</h3>
                  <button onClick={() => setActiveTab("trips")} className="text-blue-600 hover:underline text-sm">View All</button>
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
          </div>
        )}

        {/* Dredgers Tab */}
        {activeTab === "dredgers" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <h2 className="text-2xl font-bold">Dredgers Management</h2>
              <div className="flex space-x-2">
                <button onClick={() => downloadTemplate("dredgers")} className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center space-x-2">
                  <FileSpreadsheet className="w-5 h-5" /><span>Download Template</span>
                </button>
                <input ref={dredgerFileInput} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileImport("dredgers", file); if (dredgerFileInput.current) dredgerFileInput.current.value = ""; }} />
                <button onClick={() => dredgerFileInput.current?.click()} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2">
                  <Upload className="w-5 h-5" /><span>Import Excel</span>
                </button>
                <button onClick={() => { setEditingItem(null); setDredgerForm({}); setShowDredgerModal(true); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2">
                  <Plus className="w-5 h-5" /><span>Add Dredger</span>
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
                  {dredgers.map((dredger) => (
                    <tr key={dredger.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono">{dredger.code}</td>
                      <td className="px-4 py-3 font-medium">{dredger.name}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(dredger.ratePerCbm)}</td>
                      <td className="px-4 py-3">{dredger.contractor}</td>
                      <td className="px-4 py-3 font-mono text-sm">{dredger.contractNumber}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${dredger.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>{dredger.status}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end space-x-2">
                          <button onClick={() => { setEditingItem(dredger); setDredgerForm(dredger); setShowDredgerModal(true); }} className="p-1 text-blue-600 hover:bg-blue-50 rounded"><Edit className="w-4 h-4" /></button>
                          <button onClick={() => deleteItem("dredger", dredger.id)} className="p-1 text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
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
                          <td className="px-4 py-3"><div className="font-medium">{dredger.name}</div><div className="text-sm text-gray-500">{dredger.code}</div></td>
                          <td className="px-4 py-3 text-right">{earnings.totalVolume.toLocaleString()} CBM</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(dredger.ratePerCbm)}</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(earnings.totalAmount)}</td>
                          <td className="px-4 py-3 text-right text-green-600">{formatCurrency(earnings.totalPaid)}</td>
                          <td className={`px-4 py-3 text-right font-bold ${earnings.balance > 0 ? "text-red-600" : "text-green-600"}`}>{formatCurrency(earnings.balance)}</td>
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
              <div className="flex space-x-2 flex-wrap gap-2">
                <button onClick={() => exportTrucksReport()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center space-x-2">
                  <Download className="w-5 h-5" /><span>Download Trucks Report</span>
                </button>
                <button onClick={() => downloadTemplate("transporters")} className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center space-x-2">
                  <FileSpreadsheet className="w-5 h-5" /><span>Download Template</span>
                </button>
                <input ref={transporterFileInput} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileImport("transporters", file); if (transporterFileInput.current) transporterFileInput.current.value = ""; }} />
                <button onClick={() => transporterFileInput.current?.click()} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2">
                  <Upload className="w-5 h-5" /><span>Import Excel</span>
                </button>
                <button onClick={() => { setEditingItem(null); setTransporterForm({}); setShowTransporterModal(true); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2">
                  <Plus className="w-5 h-5" /><span>Add Transporter</span>
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
                              <button onClick={(e) => { e.stopPropagation(); deleteTruck(transporter.id, truck.id); }} className="ml-1 text-red-600 hover:text-red-800">×</button>
                            </span>
                          ))}
                          <button onClick={() => openAddTruckModal(transporter.id)} className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs hover:bg-green-200">+ Add Truck</button>
                        </div>
                      </td>
                      <td className="px-4 py-3">{transporter.contractor}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${transporter.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>{transporter.status}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end space-x-2">
                          <button onClick={() => { setEditingItem(transporter); setTransporterForm(transporter); setShowTransporterModal(true); }} className="p-1 text-blue-600 hover:bg-blue-50 rounded"><Edit className="w-4 h-4" /></button>
                          <button onClick={() => deleteItem("transporter", transporter.id)} className="p-1 text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
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
                          <td className="px-4 py-3"><div className="font-medium">{transporter.name}</div><div className="text-sm text-gray-500">{transporter.code}</div></td>
                          <td className="px-4 py-3 text-right">{earnings.totalTrips.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">{earnings.totalVolume.toLocaleString()} CBM</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(transporter.ratePerCbm)}</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(earnings.totalAmount)}</td>
                          <td className="px-4 py-3 text-right text-green-600">{formatCurrency(earnings.totalPaid)}</td>
                          <td className={`px-4 py-3 text-right font-bold ${earnings.balance > 0 ? "text-red-600" : "text-green-600"}`}>{formatCurrency(earnings.balance)}</td>
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
                <input type="text" placeholder="Search plate, transporter, or location..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="px-3 py-2 border rounded-lg" />
                <input type="date" value={dateFilter.start} onChange={(e) => setDateFilter({ ...dateFilter, start: e.target.value })} className="px-3 py-2 border rounded-lg" />
                <input type="date" value={dateFilter.end} onChange={(e) => setDateFilter({ ...dateFilter, end: e.target.value })} className="px-3 py-2 border rounded-lg" />
                <button onClick={() => downloadTemplate("trips")} className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center space-x-2"><FileSpreadsheet className="w-5 h-5" /><span>Template</span></button>
                <input ref={tripsFileInput} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileImport("trips", file); if (tripsFileInput.current) tripsFileInput.current.value = ""; }} />
                <button onClick={() => tripsFileInput.current?.click()} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"><Upload className="w-5 h-5" /><span>Import</span></button>
                <button onClick={() => { setEditingItem(null); setTripForm({ date: new Date().toISOString().split("T")[0] }); setShowTripModal(true); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"><Plus className="w-5 h-5" /><span>Add Trip</span></button>
                <button onClick={() => exportToExcel("trips")} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"><Download className="w-5 h-5" /><span>Export</span></button>
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
                    const truckDisplay = truck ? `(${truck.plateNumber}${truck.truckName ? " - " + truck.truckName : ""})` : trip.plateNumber;
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
                            <button onClick={() => {
                              const truckForEdit = transporters.flatMap(t => t.trucks).find(tr => tr.id === trip.truckId);
                              const tripToEdit = { ...trip, date: toSortableISO(trip.date), capacityCbm: trip.transporterBillingCbm ?? truckForEdit?.transporterBillingCbm ?? truckForEdit?.capacityCbm ?? trip.capacityCbm };
                              setEditingItem(tripToEdit); setTripForm(tripToEdit); setShowTripModal(true);
                            }} className="p-1 text-blue-600 hover:bg-blue-50 rounded"><Edit className="w-4 h-4" /></button>
                            <button onClick={() => deleteItem("trip", trip.id)} className="p-1 text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
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
                <button onClick={() => downloadTemplate("payments")} className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center space-x-2"><FileSpreadsheet className="w-5 h-5" /><span>Template</span></button>
                <input ref={paymentsFileInput} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileImport("payments", file); if (paymentsFileInput.current) paymentsFileInput.current.value = ""; }} />
                <button onClick={() => paymentsFileInput.current?.click()} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"><Upload className="w-5 h-5" /><span>Import</span></button>
                <button onClick={() => { setEditingItem(null); setPaymentForm({ date: new Date().toISOString().split("T")[0], entityType: "dredger" }); setShowPaymentModal(true); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"><Plus className="w-5 h-5" /><span>Add Payment</span></button>
                <button onClick={() => exportToExcel("payments")} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"><Download className="w-5 h-5" /><span>Export</span></button>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 flex flex-wrap gap-3 items-center">
                <div className="text-sm font-medium text-gray-700">Filter:</div>
                <select value={paymentForm.entityType ?? "dredger"} onChange={(e) => setPaymentForm({ ...paymentForm, entityType: (e.target.value as "dredger" | "transporter") || "dredger" })} className="px-3 py-2 border rounded-lg text-sm">
                  <option value="dredger">Dredger</option>
                  <option value="transporter">Transporter</option>
                </select>
                <input type="text" placeholder="Search entity code/name" value={paymentForm.entityId || ""} onChange={(e) => setPaymentForm({ ...paymentForm, entityId: e.target.value })} className="px-3 py-2 border rounded-lg text-sm" />
                <button onClick={() => setPaymentForm({ ...paymentForm, entityType: undefined, entityId: "" })} className="text-sm text-red-600 hover:text-red-800">Clear</button>
              </div>
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
                  {sortedPayments
                    .filter((p) => {
                      if (!paymentForm.entityType && !paymentForm.entityId) return true;
                      const typeMatch = paymentForm.entityType ? p.entityType === paymentForm.entityType : true;
                      const entityQuery = (paymentForm.entityId || "").trim().toLowerCase();
                      const entityName = (() => {
                        if (p.entityType === "dredger") {
                          const dr = dredgers.find((d) => d.id === p.entityId || d.code === p.entityId);
                          return dr?.name || p.entityId || "";
                        }
                        const tr = transporters.find((t) => t.code === p.entityId || t.id === p.entityId);
                        return tr?.name || tr?.contractor || p.entityId || "";
                      })().toLowerCase();
                      const entityCode = p.entityId?.toLowerCase() || "";
                      const entityMatch = entityQuery ? entityName.includes(entityQuery) || entityCode.includes(entityQuery) : true;
                      return typeMatch && entityMatch;
                    })
                    .map((payment) => {
                      let entityName = "";
                      if (payment.entityType === "dredger") {
                        const dr = dredgers.find((d) => d.id === payment.entityId || d.code === payment.entityId);
                        entityName = dr?.name || payment.entityId || "";
                      } else {
                        const matchedByCode = transporters.find((t) => t.code === payment.entityId || t.id === payment.entityId);
                        entityName = matchedByCode && matchedByCode.contractor ? matchedByCode.contractor.trim() : payment.entityId || "";
                      }
                      return (
                        <tr key={payment.id} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-3">{formatDisplayDate(payment.date)}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${payment.entityType === "dredger" ? "bg-orange-100 text-orange-800" : "bg-purple-100 text-purple-800"}`}>
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
                              <button onClick={() => { setEditingItem(payment); setPaymentForm({ ...payment, date: toSortableISO(payment.date || "") || payment.date || new Date().toISOString().split("T")[0] }); setShowPaymentModal(true); }} className="p-1 text-blue-600 hover:bg-blue-50 rounded"><Edit className="w-4 h-4" /></button>
                              <button onClick={() => deleteItem("payment", payment.id)} className="p-1 text-red-600 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
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
            <div className="flex justify-between items-center flex-wrap gap-3 print:hidden">
              <h2 className="text-2xl font-bold">Transporter Report</h2>
              <div className="flex flex-wrap gap-2 items-center">
                <button onClick={downloadTransporterReportPdf} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"><Download className="w-5 h-5" /><span>PDF</span></button>
                <button onClick={downloadTransporterReportExcel} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2 mr-4"><FileSpreadsheet className="w-5 h-5" /><span>Excel</span></button>
                <input type="date" value={trReportFilter.start} onChange={(e) => setTrReportFilter({ ...trReportFilter, start: e.target.value })} className="px-3 py-2 border rounded-lg text-sm" />
                <input type="date" value={trReportFilter.end} onChange={(e) => setTrReportFilter({ ...trReportFilter, end: e.target.value })} className="px-3 py-2 border rounded-lg text-sm" />
                <input type="text" placeholder="Filter plate #" value={trReportFilter.plate} onChange={(e) => setTrReportFilter({ ...trReportFilter, plate: e.target.value })} className="px-3 py-2 border rounded-lg text-sm" />
                <input type="text" placeholder="Filter truck name" value={trReportFilter.truckName} onChange={(e) => setTrReportFilter({ ...trReportFilter, truckName: e.target.value })} className="px-3 py-2 border rounded-lg text-sm" />
                <select value={trReportFilter.dredgerId} onChange={(e) => setTrReportFilter({ ...trReportFilter, dredgerId: e.target.value })} className="px-3 py-2 border rounded-lg text-sm">
                  <option value="">All Dredgers</option>
                  {dredgers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <select value={trReportFilter.contractor} onChange={(e) => setTrReportFilter({ ...trReportFilter, contractor: e.target.value })} className="px-3 py-2 border rounded-lg text-sm">
                  <option value="">All Contractors</option>
                  {contractorOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={trReportFilter.groupBy} onChange={(e) => setTrReportFilter({ ...trReportFilter, groupBy: e.target.value as any })} className="px-3 py-2 border rounded-lg text-sm">
                  <option value="date">Group by Date</option>
                  <option value="truckName">Group by Truck Name</option>
                  <option value="plate">Group by Plate Number</option>
                  <option value="dredger">Group by Dredger</option>
                  <option value="contractor">Group by Contractor</option>
                </select>
                <button onClick={() => setTrReportFilter({ start: "", end: "", plate: "", truckName: "", dredgerId: "", contractor: "", groupBy: "date" })} className="text-sm text-red-600 hover:text-red-800">Reset</button>
              </div>
            </div>

            <div className={`bg-white rounded-lg shadow ${isExportingPdf ? "border-0" : ""}`} ref={reportTransporterReportRef}>
              <div className="p-4 border-b flex justify-between items-center">
                <h3 className="font-bold text-lg">Grouped Results</h3>
                <div className="text-sm text-gray-500">Grouping by {trReportFilter.groupBy}</div>
              </div>
              <div className="divide-y">
                {transporterReportRows.map((group) => (
                  <div key={group.key} className="p-4 page-break-inside-avoid">
                    <div className="flex justify-between items-center mb-3">
                      <h4 className={`font-bold text-lg ${trReportFilter.groupBy === "date" ? "text-red-600" : ""}`}>
                        {trReportFilter.groupBy === "date" ? formatDisplayDate(group.key) : group.key || "(Unspecified)"}
                      </h4>
                      <div className="text-sm text-gray-600 space-x-3">
                        <span>Trips: <strong>{group.totalTrips.toLocaleString()}</strong></span>
                        <span>Total CBM: <strong>{group.totalVolume.toLocaleString()}</strong></span>
                        <span>Total Amount: <strong>{formatCurrency(group.totalAmount)}</strong></span>
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
                            <th className="px-3 py-2 text-right">Cubic Capacity</th>
                            <th className="px-3 py-2 text-right">Trips</th>
                            <th className="px-3 py-2 text-right">Volume (CBM)</th>
                            <th className="px-3 py-2 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row) => {
                            const dredger = dredgers.find((d) => d.id === row.dredgerId);
                            const transporter = transporters.find((t) => t.id === row.transporterId);
                            const truck = transporter?.trucks.find((tr) => tr.id === row.truckId || tr.plateNumber === row.plateNumber);
                            const truckCapacity = truck?.transporterBillingCbm || truck?.capacityCbm || 0;
                            const rowAmount = row.transporterAmount ?? 0;
                            const rowRate = row.transporterRate || transporter?.ratePerCbm || 0;
                            const rowTrips = row.trips ?? 0;
                            const totalVolume = (rowRate > 0 && rowTrips > 0) ? rowAmount / rowRate / rowTrips : 0;
                            return (
                              <tr key={row.id} className="border-t">
                                <td className="px-3 py-2">{formatDisplayDate(row.date)}</td>
                                <td className="px-3 py-2">{dredger?.name}</td>
                                <td className="px-3 py-2">{transporter?.name}</td>
                                <td className="px-3 py-2 font-mono text-xs">{truck ? `${truck.truckName || ""} (${truck.plateNumber})` : row.plateNumber}</td>
                                <td className="px-3 py-2 text-right">{truckCapacity.toLocaleString()}</td>
                                <td className="px-3 py-2 text-right">{rowTrips}</td>
                                <td className="px-3 py-2 text-right">{totalVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                <td className="px-3 py-2 text-right font-medium">{formatCurrency(rowAmount)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-gray-50 font-semibold">
                          <tr>
                            <td className="px-3 py-2" colSpan={5}>Group Totals</td>
                            <td className="px-3 py-2 text-right">{group.totalTrips.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right">{group.totalVolume.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right text-blue-700">{formatCurrency(group.totalAmount)}</td>
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
          <div className="space-y-6" id="reports-section">
            <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
              <h2 className="text-2xl font-bold">Comprehensive Reports</h2>
              <div className="flex space-x-2 flex-wrap gap-2">
                <button onClick={() => exportToExcel("trips")} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"><Download className="w-5 h-5" /><span>Export Trips</span></button>
                <button onClick={() => exportToExcel("dredgers")} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"><Download className="w-5 h-5" /><span>Export Dredgers</span></button>
                <button onClick={() => exportToExcel("transporters")} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center space-x-2"><Download className="w-5 h-5" /><span>Export Transporters</span></button>
                <button onClick={() => exportToExcel("payments")} className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 flex items-center space-x-2"><Download className="w-5 h-5" /><span>Export Payments</span></button>
                <button onClick={() => downloadReportsAsPdf()} className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 flex items-center space-x-2"><Download className="w-5 h-5" /><span>Download PDF</span></button>
              </div>
            </div>

            <div className={`bg-white rounded-lg shadow p-6 ${isExportingPdf ? "border-0" : ""}`} ref={reportOverallRef}>
              <div className="flex items-center space-x-2 mb-4">
                <FileSpreadsheet className="w-6 h-6" />
                <h3 className="font-bold text-xl">Overall Project Summary</h3>
                {latestTripDisplay && <span className="text-sm text-gray-500">— up to {latestTripDisplay}</span>}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg"><p className="text-sm text-gray-600">Total Volume</p><p className="text-2xl font-bold text-blue-600">{overallStats.totalVolume.toLocaleString()} CBM</p></div>
                <div className="bg-green-50 p-4 rounded-lg"><p className="text-sm text-gray-600">Total Trips</p><p className="text-2xl font-bold text-green-600">{overallStats.totalTrips.toLocaleString()}</p></div>
                <div className="bg-orange-50 p-4 rounded-lg"><p className="text-sm text-gray-600">Dredger Cost</p><p className="text-2xl font-bold text-orange-600">{formatCurrency(overallStats.totalDredgerCost)}</p></div>
                <div className="bg-purple-50 p-4 rounded-lg"><p className="text-sm text-gray-600">Transport Cost</p><p className="text-2xl font-bold text-purple-600">{formatCurrency(overallStats.totalTransporterCost)}</p></div>
                <div className="bg-red-50 p-4 rounded-lg"><p className="text-sm text-gray-600">Total Paid</p><p className="text-2xl font-bold text-red-600">{formatCurrency(overallStats.totalPaid)}</p></div>
              </div>
              <div className="mt-4 pt-4 border-t">
                <div className="flex justify-between items-center">
                  <div><p className="text-sm text-gray-600">Total Project Cost</p><p className="text-2xl font-bold text-gray-800">{formatCurrency(overallStats.totalDredgerCost + overallStats.totalTransporterCost)}</p></div>
                  <div><p className="text-sm text-gray-600">Total Payments Made</p><p className="text-2xl font-bold text-green-600">{formatCurrency(overallStats.totalPaid)}</p></div>
                  <div><p className="text-sm text-gray-600">Outstanding Balance</p><p className="text-2xl font-bold text-red-600">{formatCurrency(overallStats.totalDredgerCost + overallStats.totalTransporterCost - overallStats.totalPaid)}</p></div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6" ref={reportDredgerRef}>
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
                          <td className="px-4 py-3"><div className="font-medium">{dredger.name}</div><div className="text-sm text-gray-500">{dredger.code}</div></td>
                          <td className="px-4 py-3">{dredger.contractor}</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(dredger.ratePerCbm)}</td>
                          <td className="px-4 py-3 text-right">{earnings.totalVolume.toLocaleString()} CBM</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(earnings.totalAmount)}</td>
                          <td className="px-4 py-3 text-right text-green-600">{formatCurrency(earnings.totalPaid)}</td>
                          <td className={`px-4 py-3 text-right font-bold ${earnings.balance > 0 ? "text-red-600" : "text-green-600"}`}>{formatCurrency(earnings.balance)}</td>
                          <td className="px-4 py-3 text-center">
                            {earnings.balance > 0 ? <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-medium">Due</span> : <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium">Paid</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6" ref={reportTransporterRef}>
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
                      const contractorGroups = new Map<string, { displayName: string; transportersList: Transporter[] }>();
                      transporters.forEach((t) => {
                        const rawName = t.contractor && t.contractor.trim() ? t.contractor : "Unassigned";
                        const key = rawName.trim().toLowerCase();
                        if (!contractorGroups.has(key)) contractorGroups.set(key, { displayName: rawName, transportersList: [] });
                        contractorGroups.get(key)!.transportersList.push(t);
                      });
                      return Array.from(contractorGroups.values()).map((group) => {
                        const { displayName, transportersList } = group;
                        const opStats = transportersList.reduce((acc, curr) => {
                          const tStats = calculateTransporterEarnings(curr.id);
                          return { trips: acc.trips + tStats.totalTrips, volume: acc.volume + tStats.totalVolume, amount: acc.amount + tStats.totalAmount };
                        }, { trips: 0, volume: 0, amount: 0 });
                        const contractorDirectPayments = payments.filter((p) => p.entityType === "transporter" && p.entityId === displayName).reduce((sum, p) => sum + p.amount, 0);
                        const legacyPayments = payments.filter((p) => p.entityType === "transporter" && transportersList.some((t) => t.id === p.entityId)).reduce((sum, p) => sum + p.amount, 0);
                        const totalPaid = contractorDirectPayments + legacyPayments;
                        const balance = opStats.amount - totalPaid;
                        return (
                          <tr key={displayName} className="border-t hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium">{displayName}</td>
                            <td className="px-4 py-3 text-right">{opStats.trips.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">{opStats.volume.toLocaleString()} CBM</td>
                            <td className="px-4 py-3 text-right font-medium">{formatCurrency(opStats.amount)}</td>
                            <td className="px-4 py-3 text-right text-green-600">{formatCurrency(totalPaid)}</td>
                            <td className={`px-4 py-3 text-right font-bold ${balance > 0 ? "text-red-600" : "text-green-600"}`}>{formatCurrency(balance)}</td>
                            <td className="px-4 py-3 text-center">
                              {balance > 0 ? <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-medium">Due</span> : <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium">Paid</span>}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6" ref={reportAccountingRef}>
              <h3 className="font-bold text-xl mb-4 flex items-center space-x-2"><span className="text-2xl font-bold">₦</span><span>Accounting Summary</span></h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold mb-3">Dredger Payments</h4>
                  <div className="space-y-2">
                    {dredgers.map((dredger) => {
                      const earnings = calculateDredgerEarnings(dredger.id);
                      return (
                        <div key={dredger.id} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                          <div><div className="font-medium">{dredger.name}</div><div className="text-sm text-gray-500">{dredger.code}</div></div>
                          <div className="text-right">
                            <div className="text-sm text-gray-600">Due: {formatCurrency(earnings.totalAmount)}</div>
                            <div className="text-sm text-green-600">Paid: {formatCurrency(earnings.totalPaid)}</div>
                            <div className={`font-bold ${earnings.balance > 0 ? "text-red-600" : "text-green-600"}`}>Balance: {formatCurrency(earnings.balance)}</div>
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
                      const contractorGroups = new Map<string, { displayName: string; transportersList: Transporter[] }>();
                      transporters.forEach((t) => {
                        const rawName = t.contractor && t.contractor.trim() ? t.contractor : "Unassigned";
                        const key = rawName.trim().toLowerCase();
                        if (!contractorGroups.has(key)) contractorGroups.set(key, { displayName: rawName, transportersList: [] });
                        contractorGroups.get(key)!.transportersList.push(t);
                      });
                      return Array.from(contractorGroups.values()).map((group) => {
                        const { displayName, transportersList } = group;
                        const opStats = transportersList.reduce((acc, curr) => {
                          const tStats = calculateTransporterEarnings(curr.id);
                          return { amount: acc.amount + tStats.totalAmount };
                        }, { amount: 0 });
                        const contractorDirectPayments = payments.filter((p) => p.entityType === "transporter" && p.entityId === displayName).reduce((sum, p) => sum + p.amount, 0);
                        const legacyPayments = payments.filter((p) => p.entityType === "transporter" && transportersList.some((t) => t.id === p.entityId)).reduce((sum, p) => sum + p.amount, 0);
                        const totalPaid = contractorDirectPayments + legacyPayments;
                        const balance = opStats.amount - totalPaid;
                        return (
                          <div key={displayName} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                            <div><div className="font-medium">{displayName}</div><div className="text-xs text-gray-500">{transportersList.length} Transporter(s)</div></div>
                            <div className="text-right">
                              <div className="text-sm text-gray-600">Due: {formatCurrency(opStats.amount)}</div>
                              <div className="text-sm text-green-600">Paid: {formatCurrency(totalPaid)}</div>
                              <div className={`font-bold ${balance > 0 ? "text-red-600" : "text-green-600"}`}>Balance: {formatCurrency(balance)}</div>
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

      {/* Modals */}
      {showDredgerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">{editingItem ? "Edit" : "Add"} Dredger</h3>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700">Code</label><input type="text" value={dredgerForm.code || ""} onChange={(e) => setDredgerForm({ ...dredgerForm, code: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="DR-001" /></div>
              <div><label className="block text-sm font-medium text-gray-700">Name</label><input type="text" value={dredgerForm.name || ""} onChange={(e) => setDredgerForm({ ...dredgerForm, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Dredger Name" /></div>
              <div><label className="block text-sm font-medium text-gray-700">Rate per CBM (₦)</label><input type="number" step="0.01" value={dredgerForm.ratePerCbm || ""} onChange={(e) => setDredgerForm({ ...dredgerForm, ratePerCbm: parseFloat(e.target.value) })} className="w-full px-3 py-2 border rounded-lg" placeholder="0.00" /></div>
              <div><label className="block text-sm font-medium text-gray-700">Contractor</label><input type="text" value={dredgerForm.contractor || ""} onChange={(e) => setDredgerForm({ ...dredgerForm, contractor: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Contractor Name" /></div>
              <div><label className="block text-sm font-medium text-gray-700">Contract Number</label><input type="text" value={dredgerForm.contractNumber || ""} onChange={(e) => setDredgerForm({ ...dredgerForm, contractNumber: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="CNT-2024-XXX" /></div>
              <div><label className="block text-sm font-medium text-gray-700">Status</label><select value={dredgerForm.status || "active"} onChange={(e) => setDredgerForm({ ...dredgerForm, status: e.target.value as "active" | "inactive" })} className="w-full px-3 py-2 border rounded-lg"><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button type="button" onClick={() => { setShowDredgerModal(false); setEditingItem(null); setDredgerForm({}); }} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={() => saveDredger()} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save</button>
            </div>
          </div>
        </div>
      )}

      {showTransporterModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">{editingItem ? "Edit" : "Add"} Transporter</h3>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700">Code</label><input type="text" value={transporterForm.code || ""} onChange={(e) => setTransporterForm({ ...transporterForm, code: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="TR-001" /></div>
              <div><label className="block text-sm font-medium text-gray-700">Name</label><input type="text" value={transporterForm.name || ""} onChange={(e) => setTransporterForm({ ...transporterForm, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Transporter Name" /></div>
              <div><label className="block text-sm font-medium text-gray-700">Rate per CBM (₦)</label><input type="number" step="0.01" value={transporterForm.ratePerCbm || ""} onChange={(e) => setTransporterForm({ ...transporterForm, ratePerCbm: parseFloat(e.target.value) })} className="w-full px-3 py-2 border rounded-lg" placeholder="0.00" /></div>
              <div><label className="block text-sm font-medium text-gray-700">Contractor</label><input type="text" value={transporterForm.contractor || ""} onChange={(e) => setTransporterForm({ ...transporterForm, contractor: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Contractor Name" /></div>
              <div><label className="block text-sm font-medium text-gray-700">Contract Number</label><input type="text" value={transporterForm.contractNumber || ""} onChange={(e) => setTransporterForm({ ...transporterForm, contractNumber: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="CNT-2024-XXX" /></div>
              <div><label className="block text-sm font-medium text-gray-700">Status</label><select value={transporterForm.status || "active"} onChange={(e) => setTransporterForm({ ...transporterForm, status: e.target.value as "active" | "inactive" })} className="w-full px-3 py-2 border rounded-lg"><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button type="button" onClick={() => { setShowTransporterModal(false); setEditingItem(null); setTransporterForm({}); }} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={() => saveTransporter()} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          @page { size: landscape; margin: 10mm; }
          body { -webkit-print-color-adjust: exact; }
          .print-hidden { display: none !important; }
          .page-break-inside-avoid { page-break-inside: avoid; break-inside: avoid; }
        }
      `}</style>

      {showTripModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h3 className="text-xl font-bold">{editingItem ? "Edit" : "Add"} Trip Report</h3>
              {editingItem && (editingItem as Trip).rowNumber && (
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-gray-400 font-mono">Ref: {(editingItem as Trip).reference}</span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded font-mono">Sheet Row: {(editingItem as Trip).rowNumber}</span>
                </div>
              )}
            </div>
            <div className="space-y-4 overflow-y-auto pr-2 flex-grow">
              <div><label className="block text-sm font-medium text-gray-700">Date</label><input type="date" value={tripForm.date || ""} onChange={(e) => setTripForm({ ...tripForm, date: e.target.value })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" /></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700">Dredger</label><select value={tripForm.dredgerId || ""} onChange={(e) => setTripForm({ ...tripForm, dredgerId: e.target.value })} className="w-full px-3 py-2 border rounded-lg"><option value="">Select Dredger</option>{dredgers.filter((d) => d.status === "active").map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
                <div><label className="block text-sm font-medium text-gray-700">Transporter</label><select value={tripForm.transporterId || ""} onChange={(e) => { setTripForm({ ...tripForm, transporterId: e.target.value, truckId: "" }); }} className="w-full px-3 py-2 border rounded-lg"><option value="">Select Transporter</option>{transporters.filter((t) => t.status === "active").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
              </div>
              <div><label className="block text-sm font-medium text-gray-700">Truck</label><select value={tripForm.truckId || ""} onChange={(e) => { const selectedTruckId = e.target.value; const allTrucks = transporters.flatMap((t) => t.trucks); const truck = allTrucks.find((tr) => tr.id === selectedTruckId); setTripForm({ ...tripForm, truckId: selectedTruckId, capacityCbm: truck?.transporterBillingCbm || truck?.capacityCbm || 0 }); }} className="w-full px-3 py-2 border rounded-lg" disabled={!tripForm.transporterId}><option value="">Select Truck</option>{transporters.find((t) => t.id === tripForm.transporterId)?.trucks.filter((tr) => tr.status === "active").map((truck) => <option key={truck.id} value={truck.id}>{truck.truckName} ({truck.plateNumber} {truck.capacityCbm} CBM)</option>)}</select></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
  <div>
    <label className="block text-sm font-medium text-gray-700">
      Actual Loaded per Trip (CBM)
    </label>
    <input
      type="number"
      step="0.01"
      value={tripForm.capacityCbm || ""}
      onChange={(e) => setTripForm({ ...tripForm, capacityCbm: parseFloat(e.target.value) || undefined })}
      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
      placeholder="Actual loaded volume per trip (overrides truck default if needed)"
    />
  </div>
  <div>
    <label className="block text-sm font-medium text-gray-700">Number of Trips</label>
    <input
      type="number"
      value={tripForm.trips || ""}
      onChange={(e) => setTripForm({ ...tripForm, trips: parseInt(e.target.value) || 0 })}
      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
      placeholder="0"
    />
  </div>
</div>
              <div><label className="block text-sm font-medium text-gray-700">Dumping Location</label><input type="text" value={tripForm.dumpingLocation || ""} onChange={(e) => setTripForm({ ...tripForm, dumpingLocation: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="Site A, Location B, etc." /></div>
              <div><label className="block text-sm font-medium text-gray-700">Notes</label><textarea value={tripForm.notes || ""} onChange={(e) => setTripForm({ ...tripForm, notes: e.target.value })} className="w-full px-3 py-2 border rounded-lg" rows={2} placeholder="Additional notes..." /></div>
            </div>
            <div className="flex justify-end space-x-2 mt-6 border-t pt-4 sticky bottom-0 bg-white">
              <button type="button" onClick={() => { setShowTripModal(false); setEditingItem(null); setTripForm({}); }} className="px-4 py-2 border rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button type="button" onClick={() => saveTrip()} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-md transition-colors">{editingItem ? "Update Trip" : "Save Trip"}</button>
            </div>
          </div>
        </div>
      )}

      {showAddTruckModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl">
            <h3 className="text-xl font-bold mb-4 border-b pb-2">Add Truck</h3>
            <div className="space-y-4 overflow-y-auto pr-2 flex-grow">
              <div><label className="block text-sm font-medium text-gray-700">Truck Name</label><input type="text" value={truckForm.truckName || ""} onChange={(e) => setTruckForm({ ...truckForm, truckName: e.target.value })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="e.g., TP01" /></div>
              <div><label className="block text-sm font-medium text-gray-700">Plate Number</label><input type="text" value={truckForm.plateNumber || ""} onChange={(e) => setTruckForm({ ...truckForm, plateNumber: e.target.value })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="ABC-123" /></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700">Dredger CBM (actual)</label><input type="number" step="0.01" value={truckForm.dredgerBillingCbm ?? ""} onChange={(e) => setTruckForm({ ...truckForm, dredgerBillingCbm: e.target.value ? parseFloat(e.target.value) : undefined })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="e.g., 12.8" /></div>
                <div><label className="block text-sm font-medium text-gray-700">Transporter CBM (billed)</label><input type="number" step="0.01" value={truckForm.transporterBillingCbm ?? ""} onChange={(e) => setTruckForm({ ...truckForm, transporterBillingCbm: e.target.value ? parseFloat(e.target.value) : undefined })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="e.g., 13" /></div>
              </div>
              <div><label className="block text-sm font-medium text-gray-700">Status</label><select value={truckForm.status || "active"} onChange={(e) => setTruckForm({ ...truckForm, status: e.target.value as "active" | "inactive" })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
            </div>
            <div className="flex justify-end space-x-2 mt-6 border-t pt-4 sticky bottom-0 bg-white">
              <button type="button" onClick={() => { setShowAddTruckModal(false); setTruckForm({ transporterId: "" }); }} className="px-4 py-2 border rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button type="button" onClick={handleAddTruckSubmit} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-md transition-colors">Save Truck</button>
            </div>
          </div>
        </div>
      )}

      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">{editingItem ? "Edit" : "Add"} Payment</h3>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700">Date</label><input type="date" value={paymentForm.date || ""} onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })} className="w-full px-3 py-2 border rounded-lg" /></div>
              <div><label className="block text-sm font-medium text-gray-700">Payment Type</label><select value={paymentForm.entityType || "dredger"} onChange={(e) => setPaymentForm({ ...paymentForm, entityType: e.target.value as "dredger" | "transporter", entityId: "" })} className="w-full px-3 py-2 border rounded-lg"><option value="dredger">Dredger</option><option value="transporter">Transporter</option></select></div>
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
                    ? dredgers.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)
                    : transporters.slice().sort((a, b) => a.name.localeCompare(b.name)).map((t) => <option key={t.code} value={t.code}>{t.name} ({t.code}{t.contractor ? ` - ${t.contractor}` : ""})</option>)
                  }
                </select>
              </div>
              <div><label className="block text-sm font-medium text-gray-700">Amount (₦)</label><input type="number" step="0.01" value={paymentForm.amount || ""} onChange={(e) => setPaymentForm({ ...paymentForm, amount: parseFloat(e.target.value) })} className="w-full px-3 py-2 border rounded-lg" placeholder="0.00" /></div>
              <div><label className="block text-sm font-medium text-gray-700">Payment Method</label><select value={paymentForm.paymentMethod || "Bank Transfer"} onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })} className="w-full px-3 py-2 border rounded-lg"><option value="Bank Transfer">Bank Transfer</option><option value="Check">Check</option><option value="Cash">Cash</option><option value="Other">Other</option></select></div>
              <input type="hidden" value={paymentForm.reference || ""} readOnly />
              <div><label className="block text-sm font-medium text-gray-700">Notes</label><textarea value={paymentForm.notes || ""} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} className="w-full px-3 py-2 border rounded-lg" rows={2} placeholder="Payment notes..." /></div>
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button type="button" onClick={() => { setShowPaymentModal(false); setEditingItem(null); setPaymentForm({}); }} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={() => savePayment()} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DredgingDashboard;
