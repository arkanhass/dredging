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
  return; // stop further processing
}

if (!tripData || !Array.isArray(tripData.values) || tripData.values.length <= 1) {
  console.warn("No valid Trips data from sheet");
  setTrips([]);
  return;
}

try {
  const filteredRows = (tripData.values || []).slice(1).filter(/* your new filter above */);
console.log("Filtered rows count:", filteredRows.length);
console.log("Sample filtered row:", filteredRows[0]);
setTrips(
  filteredRows.map(/* your map block */)
);
  setTrips(
    tripData.values.slice(1)
      .filter((row: any[]) => {
  if (!Array.isArray(row) || row.length < 5) {
    console.log("Dropped row - too short:", row);
    return false;
  }

  const dateVal = row[0] ? String(row[0]).trim() : "";
  const dredgerVal = row[1] ? String(row[1]).trim() : "";
  const transporterVal = row[2] ? String(row[2]).trim() : "";
  const tripsStr = row[4] ? String(row[4]).trim() : "";

  const hasDate = dateVal !== "";
  const hasDredger = dredgerVal !== "";
  const hasTransporter = transporterVal !== "";
  const hasTrips = tripsStr !== "" && !isNaN(Number(tripsStr)) && Number(tripsStr) > 0;

  if (!hasDate || !hasDredger || !hasTransporter || !hasTrips) {
    console.log("Dropped row - missing required fields:", {
      date: dateVal,
      dredger: dredgerVal,
      transporter: transporterVal,
      trips: tripsStr
    }, row);
  }

  return hasDate && hasDredger && hasTransporter && hasTrips;
})
      .map((row: any[], i: number) => {
        // Extremely defensive access
        const rawDate = row[0] ? String(row[0]) : "";
        const dredgerCode = row[1] ? String(row[1]).trim() : "";
        const transporterCode = row[2] ? String(row[2]).trim() : "";
        const plateNumber = row[3] ? String(row[3]).trim() : "";

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
        const transporterRate = parseMoney(row[6]) || (truck ? truck.ratePerCbm : 0) || (transporter ? transporter.ratePerCbm : 0) || 0;

        const dredgerAmount = parseMoney(row[9]) || 0;
        const transporterAmount = parseMoney(row[10]) || 0;

        const tripCbm = actualLoadedCbmRaw !== null && actualLoadedCbmRaw > 0
          ? actualLoadedCbmRaw
          : (tripCbmRaw !== null && tripCbmRaw > 0
              ? tripCbmRaw
              : (truck?.transporterBillingCbm || truck?.dredgerBillingCbm || truck?.capacityCbm || 0));

        const totalVolume = totalTripsVolumeRaw !== null && totalTripsVolumeRaw > 0
          ? totalTripsVolumeRaw
          : tripsCount * tripCbm;

        const billedTransporterAmount = transporterAmount > 0
          ? transporterAmount
          : tripsCount * tripCbm * transporterRate;

        const billedDredgerAmount = dredgerAmount > 0
          ? dredgerAmount
          : tripsCount * tripCbm * dredgerRate;

        // Reference: only if column exists and has value
        const ref = (row.length > 14 && row[14] && String(row[14]).trim())
          ? String(row[14]).trim()
          : `trip-ref-${i}-${Date.now()}`;

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
  setTrips([]); // ensure page renders even if Trips fail
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
    const tripCbmVal = manualCbm ?? (truck?.transporterBillingCbm || truck?.capacityCbm || 0);

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
      actualLoadedCbm: tripForm.actualLoadedCbm,
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
      TripCBM: tripCbmVal,
      ActualLoadedCbm: newTrip.actualLoadedCbm ?? "",
      TotalTripsVolume: totalTripsVolume,
      Reference: refToUse,
      rowNumber: oldItem?.rowNumber, // fallback for GAS if needed
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
      {/* ... your full JSX ... */}
    </div>
  );
};

export default DredgingDashboard;