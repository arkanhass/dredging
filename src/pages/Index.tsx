import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  Calendar,
  CheckCircle2,
  Download,
  Edit,
  FileSpreadsheet,
  Plus,
  RefreshCcw,
  Search,
  Ship,
  Trash2,
  Truck,
  Upload,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

type EntityStatus = "active" | "inactive";
type EntityType = "dredger" | "transporter";
type TabKey =
  | "dashboard"
  | "dredgers"
  | "transporters"
  | "trips"
  | "payments"
  | "reports"
  | "transporterReport";

interface Dredger {
  id: string;
  name: string;
  code: string;
  ratePerCbm: number;
  status: EntityStatus;
  contractor: string;
  contractNumber: string;
  rowNumber?: number;
}

interface TruckRecord {
  id: string;
  plateNumber: string;
  capacityCbm: number;
  transporterId: string;
  status: EntityStatus;
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
  status: EntityStatus;
  contractor: string;
  contractNumber: string;
  trucks: TruckRecord[];
  rowNumber?: number;
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
  transporterBillingCbm?: number;
  dredgerBillingCbm?: number;
  dumpingLocation: string;
  notes: string;
  reference: string;
  rowNumber?: number;
  actualLoadedCbm?: number;
}

interface Payment {
  id: string;
  date: string;
  entityType: EntityType;
  entityId: string;
  amount: number;
  paymentMethod: string;
  reference: string;
  notes: string;
  rowNumber?: number;
}

interface TransporterReportGroup {
  key: string;
  rows: Trip[];
  totalTrips: number;
  totalVolume: number;
  totalAmount: number;
}

type AppConfig = Record<string, string>;

const GOOGLE_SHEETS_CONFIG = {
  apiKey: "AIzaSyAYwHOV-1YIa1lAheSZ-fTlh-_UWnWWpgk",
  spreadsheetId: "1RNPjQ-JxUJiF85pBb-0sqbdkWwmGV1Q23cT5qgFFauM",
};

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbytcTFRquKWvg6ZnUf_HDbyNp0DOtA4cB7UWfOa577SKEMKkPi7nli_uslOpv3zUikV_g/exec";

const STORAGE_KEY = "dredging-dashboard-cache-v2";

const NairaIcon: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => (
  <span className={`inline-flex items-center justify-center font-bold ${className}`} style={{ fontSize: "inherit" }}>
    ₦
  </span>
);

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
  if (!Number.isNaN(dt.getTime())) {
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
  if (!Number.isNaN(dt.getTime())) {
    const day = String(dt.getDate()).padStart(2, "0");
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const year = dt.getFullYear();
    return `${year}-${month}-${day}`;
  }
  return d;
};

const parseMoney = (val: unknown): number | null => {
  if (val === undefined || val === null || String(val).trim() === "") return null;
  const num = parseFloat(String(val).replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(num) ? num : null;
};

const formatCurrency = (value: number | null | undefined): string => {
  if (value == null || Number.isNaN(value)) return "₦0.00";
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const generateReference = (prefix: "TRIP" | "PAY") => {
  const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${prefix}-${yyyymmdd}-${rand}`;
};

const sanitizeFileName = (name: string) => name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();

const normalizeRecord = (row: Record<string, unknown>) => {
  const normalized: Record<string, string> = {};
  Object.entries(row).forEach(([key, value]) => {
    normalized[key.replace(/\s+/g, "").toLowerCase()] = String(value ?? "").trim();
  });
  return normalized;
};

const StatCard: React.FC<{
  label: string;
  value: string;
  tone: string;
  iconBg: string;
  icon: React.ReactNode;
}> = ({ label, value, tone, iconBg, icon }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-slate-500">{label}</p>
        <p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p>
      </div>
      <div className={`rounded-2xl p-3 ${iconBg}`}>{icon}</div>
    </div>
  </div>
);

const DredgingDashboard: React.FC = () => {
  const reportTransporterReportRef = useRef<HTMLDivElement>(null);
  const reportSectionRef = useRef<HTMLDivElement>(null);

  const dredgerFileInput = useRef<HTMLInputElement>(null);
  const transporterFileInput = useRef<HTMLInputElement>(null);
  const tripsFileInput = useRef<HTMLInputElement>(null);
  const paymentsFileInput = useRef<HTMLInputElement>(null);

  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [dredgers, setDredgers] = useState<Dredger[]>([]);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [appConfig, setAppConfig] = useState<AppConfig>({});

  const [showDredgerModal, setShowDredgerModal] = useState(false);
  const [showTransporterModal, setShowTransporterModal] = useState(false);
  const [showTripModal, setShowTripModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showAddTruckModal, setShowAddTruckModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Dredger | Transporter | Trip | Payment | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState({ start: "", end: "" });
  const [dashboardDateFilter, setDashboardDateFilter] = useState({ start: "", end: "" });
  const [paymentFilter, setPaymentFilter] = useState<{ entityType: "" | EntityType; query: string }>({
    entityType: "",
    query: "",
  });

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
  const [truckForm, setTruckForm] = useState<{
    transporterId: string;
    truckName?: string;
    plateNumber?: string;
    dredgerBillingCbm?: number;
    transporterBillingCbm?: number;
    status?: EntityStatus;
  }>({ transporterId: "" });

  const [isSavingTransporter, setIsSavingTransporter] = useState(false);
  const [isSavingDredger, setIsSavingDredger] = useState(false);
  const [isSavingTrip, setIsSavingTrip] = useState(false);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [isSavingTruck, setIsSavingTruck] = useState(false);

  const tabs: { id: TabKey; label: string; icon: LucideIcon }[] = [
    { id: "dashboard", label: "Dashboard", icon: BarChart3 },
    { id: "dredgers", label: "Dredgers", icon: Ship },
    { id: "transporters", label: "Transporters", icon: Truck },
    { id: "trips", label: "Daily Trips", icon: Calendar },
    { id: "payments", label: "Payments", icon: Wallet },
    { id: "transporterReport", label: "Transporter Report", icon: FileSpreadsheet },
    { id: "reports", label: "Reports", icon: Activity },
  ];

  const allTrucks = useMemo(() => transporters.flatMap((t) => t.trucks), [transporters]);

  const contractorGroups = useMemo(() => {
    const grouped = new Map<string, { displayName: string; transportersList: Transporter[] }>();
    transporters.forEach((t) => {
      const rawName = t.contractor?.trim() ? t.contractor.trim() : "Unassigned";
      const key = rawName.toLowerCase();
      if (!grouped.has(key)) grouped.set(key, { displayName: rawName, transportersList: [] });
      grouped.get(key)?.transportersList.push(t);
    });
    return Array.from(grouped.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [transporters]);

  const contractorOptions = useMemo(
    () => contractorGroups.map((group) => group.displayName),
    [contractorGroups],
  );

  const getDredgerByAnyId = (value: string) =>
    dredgers.find((d) => d.id === value || d.code === value || d.name === value);

  const getTransporterByAnyId = (value: string) =>
    transporters.find(
      (t) => t.id === value || t.code === value || t.name === value || t.contractor.trim() === value.trim(),
    );

  const getPaymentEntityLabel = (payment: Payment) => {
    if (payment.entityType === "dredger") {
      const dredger = getDredgerByAnyId(payment.entityId);
      return dredger?.name || payment.entityId || "Unknown Dredger";
    }
    const transporter = getTransporterByAnyId(payment.entityId);
    return transporter?.contractor?.trim() || transporter?.name || payment.entityId || "Unknown Transporter";
  };

  const getContractorPaymentTotal = (
    displayName: string,
    transportersList: Transporter[],
    sourcePayments: Payment[] = payments,
  ) => {
    const validIds = new Set<string>();
    transportersList.forEach((t) => {
      validIds.add(t.id);
      validIds.add(t.code);
    });
    return sourcePayments
      .filter(
        (p) =>
          p.entityType === "transporter" &&
          (validIds.has(p.entityId) || p.entityId.trim().toLowerCase() === displayName.trim().toLowerCase()),
      )
      .reduce((sum, payment) => sum + (payment.amount || 0), 0);
  };

  const latestTripDisplay = useMemo(() => {
    if (trips.length === 0) return null;
    const sortedTrips = [...trips].sort(
      (a, b) => new Date(toSortableISO(b.date)).getTime() - new Date(toSortableISO(a.date)).getTime(),
    );
    return sortedTrips[0]?.date ? formatDisplayDate(sortedTrips[0].date) : null;
  }, [trips]);

  useEffect(() => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (!cached) return;
      const parsed = JSON.parse(cached) as {
        dredgers?: Dredger[];
        transporters?: Transporter[];
        trips?: Trip[];
        payments?: Payment[];
        appConfig?: AppConfig;
      };
      if (parsed.dredgers?.length) setDredgers(parsed.dredgers);
      if (parsed.transporters?.length) setTransporters(parsed.transporters);
      if (parsed.trips?.length) setTrips(parsed.trips);
      if (parsed.payments?.length) setPayments(parsed.payments);
      if (parsed.appConfig) setAppConfig(parsed.appConfig);
    } catch {
      // Ignore cache parsing issues.
    }
  }, []);

  useEffect(() => {
    const payload = JSON.stringify({ dredgers, transporters, trips, payments, appConfig });
    localStorage.setItem(STORAGE_KEY, payload);
  }, [dredgers, transporters, trips, payments, appConfig]);

  const loadDataFromSheets = async () => {
    setLoadingData(true);
    setErrorMessage(null);
    try {
      const dredgersUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Dredgers?key=${GOOGLE_SHEETS_CONFIG.apiKey}`;
      const transportersUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Transporters?key=${GOOGLE_SHEETS_CONFIG.apiKey}`;
      const tripsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Trips?key=${GOOGLE_SHEETS_CONFIG.apiKey}`;
      const paymentsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Payments?key=${GOOGLE_SHEETS_CONFIG.apiKey}`;
      const configUrl = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Config?key=${GOOGLE_SHEETS_CONFIG.apiKey}`;

      const [drRes, trRes, tripRes, payRes, configRes] = await Promise.all([
        fetch(dredgersUrl),
        fetch(transportersUrl),
        fetch(tripsUrl),
        fetch(paymentsUrl),
        fetch(configUrl),
      ]);

      const [drData, trData, tripData, payData, configData] = await Promise.all([
        drRes.json(),
        trRes.json(),
        tripRes.json(),
        payRes.json(),
        configRes.json(),
      ]);

      const loadedDredgers: Dredger[] = ((drData.values as unknown[][]) || [])
        .slice(1)
        .map((row, index) => ({
          id: `${String(row[0] || `D-${index + 1}`).trim()}-${index + 2}`,
          code: String(row[0] || "").trim(),
          name: String(row[1] || "").trim(),
          ratePerCbm: parseMoney(row[2]) || 0,
          status: (String(row[3] || "active").trim().toLowerCase() as EntityStatus) || "active",
          contractor: String(row[4] || "").trim(),
          contractNumber: String(row[5] || "").trim(),
          rowNumber: index + 2,
        }))
        .filter((dredger) => dredger.code);

      const transporterRows = ((trData.values as unknown[][]) || []).slice(1);
      const transporterMap = new Map<string, Transporter>();

      transporterRows.forEach((row, index) => {
        const code = String(row[0] || "").trim();
        if (!code) return;

        if (!transporterMap.has(code)) {
          transporterMap.set(code, {
            id: code,
            code,
            name: String(row[1] || "").trim(),
            ratePerCbm: parseMoney(row[2]) || 0,
            status: (String(row[3] || "active").trim().toLowerCase() as EntityStatus) || "active",
            contractor: String(row[4] || "").trim(),
            contractNumber: String(row[5] || "").trim(),
            trucks: [],
            rowNumber: index + 2,
          });
        }

        const plateNumber = String(row[6] || "").trim().toUpperCase();
        if (!plateNumber) return;

        const transporter = transporterMap.get(code);
        if (!transporter) return;

        const truckId = `${code}-${plateNumber}`;
        const alreadyExists = transporter.trucks.some((truck) => truck.id === truckId);
        if (alreadyExists) return;

        const transporterBillingCbm = parseMoney(row[7]) ?? undefined;
        const dredgerBillingCbm = parseMoney(row[8]) ?? undefined;
        const capacityCbm = dredgerBillingCbm ?? transporterBillingCbm ?? 0;
        const truckName = String(row[9] || "Unnamed").trim();

        transporter.trucks.push({
          id: truckId,
          plateNumber,
          capacityCbm,
          transporterId: code,
          status: "active",
          truckName,
          transporterBillingCbm,
          dredgerBillingCbm,
          ratePerCbm: transporter.ratePerCbm,
        });
      });

      const loadedTransporters = Array.from(transporterMap.values());

      const tripRows = ((tripData.values as unknown[][]) || []).slice(1);
      const loadedTrips = tripRows
        .map((row, index): Trip | null => {
          const rawDate = String(row[0] || "").trim();
          const dredgerCode = String(row[1] || "").trim();
          const transporterCode = String(row[2] || "").trim();
          const plateNumber = String(row[3] || "").trim().toUpperCase();
          const tripsCount = Number(String(row[4] || "").replace(/[^\d.-]/g, "")) || 0;

          if (!rawDate || !dredgerCode || !transporterCode || tripsCount <= 0) return null;

          const dredger = loadedDredgers.find((item) => item.code === dredgerCode);
          const transporter = transporterMap.get(transporterCode);
          const truck = transporter?.trucks.find((item) => item.plateNumber.toUpperCase() === plateNumber);

          const dredgerRate = parseMoney(row[5]) ?? dredger?.ratePerCbm ?? 0;
          const transporterRate = parseMoney(row[6]) ?? truck?.ratePerCbm ?? transporter?.ratePerCbm ?? 0;
          const dumpingLocation = String(row[7] || "").trim();
          const notes = String(row[8] || "").trim();

          const transporterBillingCbm = parseMoney(row[9]) ?? truck?.transporterBillingCbm ?? truck?.capacityCbm ?? 0;
          const dredgerBillingCbm = parseMoney(row[10]) ?? truck?.dredgerBillingCbm ?? truck?.capacityCbm ?? transporterBillingCbm;
          const actualLoadedCbm = parseMoney(row[11]) ?? dredgerBillingCbm ?? transporterBillingCbm;

          const dredgerAmountRaw = parseMoney(row[12]) ?? parseMoney(row[9]) ?? 0;
          const transporterAmountRaw = parseMoney(row[13]) ?? parseMoney(row[10]) ?? 0;
          const totalTripsVolumeRaw = parseMoney(row[14]) ?? 0;
          const reference = String(row[15] ?? row[14] ?? generateReference("TRIP")).trim();

          const tripCbm = actualLoadedCbm || dredgerBillingCbm || transporterBillingCbm || truck?.capacityCbm || 0;
          const totalVolume = totalTripsVolumeRaw || tripsCount * tripCbm;
          const dredgerAmount = dredgerAmountRaw || tripsCount * tripCbm * dredgerRate;
          const transporterAmount = transporterAmountRaw || tripsCount * tripCbm * transporterRate;

          return {
            id: reference || `trip-${index + 2}`,
            date: rawDate,
            dredgerId: dredger?.id || dredgerCode,
            transporterId: transporterCode,
            truckId: truck?.id || `${transporterCode}-${plateNumber}`,
            plateNumber,
            trips: tripsCount,
            capacityCbm: tripCbm,
            totalVolume,
            dredgerRate,
            transporterRate,
            dredgerAmount,
            transporterAmount,
            tripCbm,
            totalTripsVolume: totalVolume,
            transporterBillingCbm,
            dredgerBillingCbm,
            dumpingLocation,
            notes,
            reference: reference || `trip-${index + 2}`,
            rowNumber: index + 2,
            actualLoadedCbm: actualLoadedCbm || undefined,
          } satisfies Trip;
        })
        .filter((trip): trip is Trip => Boolean(trip));

      const paymentRows = ((payData.values as unknown[][]) || []).slice(1);
      const loadedPayments: Payment[] = paymentRows
        .map((row, index) => ({
          id: String(row[5] || `PAY-${index + 2}`).trim(),
          date: String(row[0] || "").trim(),
          entityType: ((String(row[1] || "dredger").trim().toLowerCase() as EntityType) || "dredger"),
          entityId: String(row[2] || "").trim(),
          amount: parseMoney(row[3]) || 0,
          paymentMethod: String(row[4] || "Bank Transfer").trim(),
          reference: String(row[5] || `PAY-${index + 2}`).trim(),
          notes: String(row[6] || "").trim(),
          rowNumber: index + 2,
        }))
        .filter((payment) => payment.date || payment.entityId || payment.reference);

      const configRows = (configData.values as unknown[][]) || [];
      const configObject = configRows.reduce<AppConfig>((acc, row) => {
        const key = String(row?.[0] || "").trim();
        const value = String(row?.[1] || "").trim();
        if (!key) return acc;
        acc[key] = value;
        acc[key.toLowerCase()] = value;
        return acc;
      }, {});

      setDredgers(loadedDredgers);
      setTransporters(loadedTransporters);
      setTrips(loadedTrips);
      setPayments(loadedPayments);
      setAppConfig(configObject);
      setSyncMessage("Data refreshed successfully from Dredgers, Transporters, Trips, Payments, and Config sheets.");
      setTimeout(() => setSyncMessage(null), 2500);
    } catch (error) {
      console.error("Load error:", error);
      setErrorMessage("Unable to refresh from Google Sheets right now. Showing the most recent cached data.");
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    void loadDataFromSheets();
  }, []);

  const submitToAppsScript = async (action: string, data: Record<string, unknown>) => {
    const payload = { action, ...data };
    const formData = new URLSearchParams();

    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    });

    console.log(`[GAS] Sending action="${action}"`, Object.fromEntries(formData.entries()));

    // Attempt 1: standard fetch with redirect follow
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: formData,
        redirect: "follow",
      });

      // Try to read response, but don't fail if we can't
      try {
        const responseText = await response.text();
        if (responseText.trim()) {
          const result = JSON.parse(responseText) as { success?: boolean; error?: string };
          console.log(`[GAS] Response for "${action}":`, result);
          if (result.success === false) {
            throw new Error(result.error || "Apps Script reported failure.");
          }
          return result;
        }
      } catch (parseErr) {
        // Response was unreadable or non-JSON — request was likely sent successfully
        console.warn(`[GAS] Could not parse response for "${action}", assuming success:`, parseErr);
      }

      return { success: true };
    } catch (fetchError) {
      // CORS or network error — the request may have still reached GAS
      // Retry with no-cors (fire-and-forget, opaque response)
      console.warn(`[GAS] Standard fetch failed for "${action}", retrying with no-cors:`, fetchError);

      try {
        await fetch(APPS_SCRIPT_URL, {
          method: "POST",
          body: formData,
          mode: "no-cors",
          redirect: "follow",
        });
        console.log(`[GAS] no-cors request sent for "${action}" (opaque response, assuming success)`);
        return { success: true };
      } catch (noCorsError) {
        console.error(`[GAS] no-cors fallback also failed for "${action}":`, noCorsError);
        throw noCorsError;
      }
    }
  };

  const refreshAfterMutation = async (message: string) => {
    setSyncMessage(message);
    setTimeout(() => setSyncMessage(null), 3000);
    await sleep(1200);
    await loadDataFromSheets();
  };

  const dashboardTrips = useMemo(() => {
    return trips.filter((trip) => {
      const tripTime = new Date(toSortableISO(trip.date)).getTime();
      if (dashboardDateFilter.start) {
        const start = new Date(dashboardDateFilter.start).getTime();
        if (tripTime < start) return false;
      }
      if (dashboardDateFilter.end) {
        const end = new Date(dashboardDateFilter.end).getTime();
        if (tripTime > end) return false;
      }
      return true;
    });
  }, [trips, dashboardDateFilter]);

  const dashboardPayments = useMemo(() => {
    return payments.filter((payment) => {
      const paymentTime = new Date(toSortableISO(payment.date)).getTime();
      if (dashboardDateFilter.start) {
        const start = new Date(dashboardDateFilter.start).getTime();
        if (paymentTime < start) return false;
      }
      if (dashboardDateFilter.end) {
        const end = new Date(dashboardDateFilter.end).getTime();
        if (paymentTime > end) return false;
      }
      return true;
    });
  }, [payments, dashboardDateFilter]);

  const overallStats = useMemo(() => {
    const totals = dashboardTrips.reduce(
      (acc, trip) => {
        acc.totalVolume += trip.totalVolume || 0;
        acc.totalTrips += trip.trips || 0;
        acc.totalDredgerCost += trip.dredgerAmount || 0;
        acc.totalTransporterCost += trip.transporterAmount || 0;
        return acc;
      },
      {
        totalVolume: 0,
        totalTrips: 0,
        totalDredgerCost: 0,
        totalTransporterCost: 0,
      },
    );

    const totalPaid = dashboardPayments.reduce((sum, payment) => sum + (payment.amount || 0), 0);

    return {
      ...totals,
      totalPaid,
    };
  }, [dashboardTrips, dashboardPayments]);

  const calculateDredgerEarnings = (
    dredgerId: string,
    sourceTrips: Trip[] = trips,
    sourcePayments: Payment[] = payments,
  ) => {
    const dredger = dredgers.find((item) => item.id === dredgerId);
    const relevantTrips = sourceTrips.filter((trip) => trip.dredgerId === dredgerId);
    const totalVolume = relevantTrips.reduce((sum, trip) => sum + (trip.totalVolume || 0), 0);
    const totalAmount = relevantTrips.reduce((sum, trip) => sum + (trip.dredgerAmount || 0), 0);
    const totalPaid = sourcePayments
      .filter(
        (payment) =>
          payment.entityType === "dredger" &&
          (payment.entityId === dredgerId || payment.entityId === dredger?.code || payment.entityId === dredger?.name),
      )
      .reduce((sum, payment) => sum + (payment.amount || 0), 0);

    return {
      totalVolume,
      totalAmount,
      totalPaid,
      balance: totalAmount - totalPaid,
    };
  };

  const calculateTransporterEarnings = (
    transporterId: string,
    sourceTrips: Trip[] = trips,
    sourcePayments: Payment[] = payments,
  ) => {
    const transporter = transporters.find((item) => item.id === transporterId || item.code === transporterId);
    const relevantTrips = sourceTrips.filter((trip) => trip.transporterId === transporterId);
    const totalTrips = relevantTrips.reduce((sum, trip) => sum + (trip.trips || 0), 0);
    const totalVolume = relevantTrips.reduce((sum, trip) => sum + (trip.totalVolume || 0), 0);
    const totalAmount = relevantTrips.reduce((sum, trip) => sum + (trip.transporterAmount || 0), 0);
    const totalPaid = sourcePayments
      .filter(
        (payment) =>
          payment.entityType === "transporter" &&
          (payment.entityId === transporterId || payment.entityId === transporter?.code),
      )
      .reduce((sum, payment) => sum + (payment.amount || 0), 0);

    return {
      totalTrips,
      totalVolume,
      totalAmount,
      totalPaid,
      balance: totalAmount - totalPaid,
    };
  };

  const filteredTrips = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const filtered = trips.filter((trip) => {
      const tripTime = new Date(toSortableISO(trip.date)).getTime();
      if (dateFilter.start) {
        const start = new Date(dateFilter.start).getTime();
        if (tripTime < start) return false;
      }
      if (dateFilter.end) {
        const end = new Date(dateFilter.end).getTime();
        if (tripTime > end) return false;
      }
      if (!term) return true;
      const transporter = transporters.find((item) => item.id === trip.transporterId);
      const dredger = dredgers.find((item) => item.id === trip.dredgerId);
      return [trip.plateNumber, trip.dumpingLocation, transporter?.name, transporter?.contractor, dredger?.name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });

    // Sort from latest to oldest
    return filtered.sort((a, b) => {
      const dateA = new Date(toSortableISO(a.date)).getTime();
      const dateB = new Date(toSortableISO(b.date)).getTime();
      return dateB - dateA;
    });
  }, [trips, dateFilter, searchTerm, transporters, dredgers]);

  const sortedPayments = useMemo(
    () => [...payments].sort((a, b) => new Date(toSortableISO(b.date)).getTime() - new Date(toSortableISO(a.date)).getTime()),
    [payments],
  );

  const filteredPaymentsList = useMemo(() => {
    const query = paymentFilter.query.trim().toLowerCase();
    return sortedPayments.filter((payment) => {
      const typeMatch = paymentFilter.entityType ? payment.entityType === paymentFilter.entityType : true;
      if (!typeMatch) return false;
      if (!query) return true;
      const entityLabel = getPaymentEntityLabel(payment).toLowerCase();
      return (
        entityLabel.includes(query) ||
        payment.entityId.toLowerCase().includes(query) ||
        payment.reference.toLowerCase().includes(query) ||
        payment.notes.toLowerCase().includes(query)
      );
    });
  }, [sortedPayments, paymentFilter, dredgers, transporters]);

  const transporterReportRows = useMemo<TransporterReportGroup[]>(() => {
    const filtered = trips.filter((trip) => {
      const transporter = transporters.find((item) => item.id === trip.transporterId);
      const truck = transporter?.trucks.find((item) => item.id === trip.truckId || item.plateNumber === trip.plateNumber);
      const tripDate = new Date(toSortableISO(trip.date)).getTime();

      if (trReportFilter.start) {
        const start = new Date(trReportFilter.start).getTime();
        if (tripDate < start) return false;
      }
      if (trReportFilter.end) {
        const end = new Date(trReportFilter.end).getTime();
        if (tripDate > end) return false;
      }
      if (trReportFilter.plate && !trip.plateNumber.toLowerCase().includes(trReportFilter.plate.toLowerCase())) return false;
      if (
        trReportFilter.truckName &&
        !(truck?.truckName || "").toLowerCase().includes(trReportFilter.truckName.toLowerCase())
      )
        return false;
      if (trReportFilter.dredgerId && trip.dredgerId !== trReportFilter.dredgerId) return false;
      if (
        trReportFilter.contractor &&
        (transporter?.contractor?.trim().toLowerCase() || "") !== trReportFilter.contractor.trim().toLowerCase()
      )
        return false;
      return true;
    });

    const groups = new Map<string, TransporterReportGroup>();

    filtered.forEach((row) => {
      const dredger = dredgers.find((item) => item.id === row.dredgerId);
      const transporter = transporters.find((item) => item.id === row.transporterId);
      const truck = transporter?.trucks.find((item) => item.id === row.truckId || item.plateNumber === row.plateNumber);

      let key = "Unknown";
      switch (trReportFilter.groupBy) {
        case "truckName":
          key = truck?.truckName || "Unnamed Truck";
          break;
        case "plate":
          key = row.plateNumber || "Unknown Plate";
          break;
        case "dredger":
          key = dredger?.name || row.dredgerId || "Unknown Dredger";
          break;
        case "contractor":
          key = transporter?.contractor?.trim() || "Unassigned";
          break;
        case "date":
        default:
          key = toSortableISO(row.date);
          break;
      }

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          rows: [],
          totalTrips: 0,
          totalVolume: 0,
          totalAmount: 0,
        });
      }

      const group = groups.get(key);
      if (!group) return;
      group.rows.push(row);
      group.totalTrips += row.trips || 0;
      group.totalVolume += row.totalVolume || 0;
      group.totalAmount += row.transporterAmount || 0;
    });

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        rows: [...group.rows].sort(
          (a, b) => new Date(toSortableISO(b.date)).getTime() - new Date(toSortableISO(a.date)).getTime(),
        ),
      }))
      .sort((a, b) => {
        if (trReportFilter.groupBy === "date") {
          return new Date(b.key).getTime() - new Date(a.key).getTime();
        }
        return a.key.localeCompare(b.key);
      });
  }, [trips, transporters, dredgers, trReportFilter]);

  const downloadWorkbook = (fileName: string, sheetName: string, rows: Record<string, unknown>[]) => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    XLSX.writeFile(workbook, `${sanitizeFileName(fileName)}.xlsx`);
  };

  const downloadTemplate = (type: "dredgers" | "transporters" | "trips" | "payments") => {
    if (type === "dredgers") {
      downloadWorkbook("dredgers-template", "Dredgers", [
        {
          Code: "DR-001",
          Name: "Blue River Dredger",
          RatePerCbm: 2500,
          Status: "active",
          Contractor: "River Works Ltd",
          ContractNumber: "CNT-2026-001",
        },
      ]);
      return;
    }

    if (type === "transporters") {
      downloadWorkbook("transporters-template", "Transporters", [
        {
          Code: "TR-001",
          Name: "Delta Haulage",
          RatePerCbm: 1800,
          Status: "active",
          Contractor: "Delta Logistics",
          ContractNumber: "CNT-2026-002",
          PlateNumber: "ABC-123XY",
          TransporterBillingCbm: 25,
          DredgerBillingCbm: 23,
          TruckName: "TP01",
        },
      ]);
      return;
    }

    if (type === "trips") {
      downloadWorkbook("trips-template", "Trips", [
        {
          Date: new Date().toISOString().split("T")[0],
          DredgerCode: "DR-001",
          TransporterCode: "TR-001",
          PlateNumber: "ABC-123XY",
          Trips: 8,
          DredgerRate: 2500,
          TransporterRate: 1800,
          DumpingLocation: "Site A",
          Notes: "Morning shift",
          TransporterBillingCbm: 25,
          DredgerBillingCbm: 23,
          ActualLoadedCbm: 23,
          DredgerAmount: 460000,
          TransporterAmount: 360000,
          TotalTripsVolume: 184,
          Reference: generateReference("TRIP"),
        },
      ]);
      return;
    }

    downloadWorkbook("payments-template", "Payments", [
      {
        Date: new Date().toISOString().split("T")[0],
        EntityType: "dredger",
        EntityCode: "DR-001",
        Amount: 500000,
        PaymentMethod: "Bank Transfer",
        Reference: generateReference("PAY"),
        Notes: "Part payment",
      },
    ]);
  };

  const handleFileImport = async (
    type: "dredgers" | "transporters" | "trips" | "payments",
    file: File,
  ) => {
    try {
      setSyncMessage(`Reading ${file.name}...`);
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });

      if (!rows.length) {
        alert("The selected file is empty.");
        setSyncMessage(null);
        return;
      }

      let successCount = 0;
      let skippedCount = 0;

      for (const rawRow of rows) {
        const row = normalizeRecord(rawRow);
        try {
          if (type === "dredgers") {
            if (!row.code || !row.name) {
              skippedCount += 1;
              continue;
            }
            await submitToAppsScript("saveDredger", {
              Code: row.code,
              Name: row.name,
              RatePerCbm: parseMoney(row.ratepercbm) || 0,
              Status: row.status || "active",
              Contractor: row.contractor || "",
              ContractNumber: row.contractnumber || "",
            });
            successCount += 1;
            continue;
          }

          if (type === "transporters") {
            if (!row.code || !row.name) {
              skippedCount += 1;
              continue;
            }
            await submitToAppsScript("saveTransporter", {
              Code: row.code,
              Name: row.name,
              RatePerCbm: parseMoney(row.ratepercbm) || 0,
              Status: row.status || "active",
              Contractor: row.contractor || "",
              ContractNumber: row.contractnumber || "",
              PlateNumber: row.platenumber || "",
              TruckName: row.truckname || "",
              TransporterBillingCbm: parseMoney(row.transporterbillingcbm) || 0,
              DredgerBillingCbm: parseMoney(row.dredgerbillingcbm) || 0,
            });
            successCount += 1;
            continue;
          }

          if (type === "trips") {
            if (!row.date || !row.dredgercode || !row.transportercode || !row.platenumber || !row.trips) {
              skippedCount += 1;
              continue;
            }
            await submitToAppsScript("saveTrip", {
              Date: formatDisplayDate(row.date),
              DredgerCode: row.dredgercode,
              TransporterCode: row.transportercode,
              PlateNumber: row.platenumber,
              Trips: parseMoney(row.trips) || 0,
              DredgerRate: parseMoney(row.dredgerrate) || 0,
              TransporterRate: parseMoney(row.transporterrate) || 0,
              DumpingLocation: row.dumpinglocation || "",
              Notes: row.notes || "",
              TransporterBillingCbm: parseMoney(row.transporterbillingcbm) || 0,
              DredgerBillingCbm: parseMoney(row.dredgerbillingcbm) || 0,
              ActualLoadedCbm: parseMoney(row.actualloadedcbm) || 0,
              DredgerAmount: parseMoney(row.dredgeramount) || 0,
              TransporterAmount: parseMoney(row.transporteramount) || 0,
              TotalTripsVolume: parseMoney(row.totaltripsvolume) || 0,
              Reference: row.reference || generateReference("TRIP"),
            });
            successCount += 1;
            continue;
          }

          const entityCode = row.entitycode || row.entityid;
          if (!row.date || !row.entitytype || !entityCode || !row.amount) {
            skippedCount += 1;
            continue;
          }
          await submitToAppsScript("savePayment", {
            Date: formatDisplayDate(row.date),
            EntityType: row.entitytype,
            EntityCode: entityCode,
            Amount: parseMoney(row.amount) || 0,
            PaymentMethod: row.paymentmethod || "Bank Transfer",
            Reference: row.reference || generateReference("PAY"),
            Notes: row.notes || "",
          });
          successCount += 1;
        } catch (error) {
          console.error("Import row failed:", error, rawRow);
          skippedCount += 1;
        }
      }

      await refreshAfterMutation(`Import completed: ${successCount} saved, ${skippedCount} skipped.`);
    } catch (error) {
      console.error("Import error:", error);
      setErrorMessage("The file could not be imported. Please confirm the template columns match.");
    }
  };

  const exportToExcel = (type: "dredgers" | "transporters" | "trips" | "payments") => {
    if (type === "dredgers") {
      downloadWorkbook("dredgers-export", "Dredgers", dredgers.map((dredger) => ({
        Code: dredger.code,
        Name: dredger.name,
        RatePerCbm: dredger.ratePerCbm,
        Status: dredger.status,
        Contractor: dredger.contractor,
        ContractNumber: dredger.contractNumber,
      })));
      return;
    }

    if (type === "transporters") {
      downloadWorkbook(
        "transporters-export",
        "Transporters",
        transporters.map((transporter) => ({
          Code: transporter.code,
          Name: transporter.name,
          RatePerCbm: transporter.ratePerCbm,
          Status: transporter.status,
          Contractor: transporter.contractor,
          ContractNumber: transporter.contractNumber,
          TruckCount: transporter.trucks.length,
          Trucks: transporter.trucks
            .map(
              (truck) =>
                `${truck.truckName || "Unnamed"} (${truck.plateNumber}) T:${truck.transporterBillingCbm ?? 0} D:${truck.dredgerBillingCbm ?? 0}`,
            )
            .join(" | "),
        })),
      );
      return;
    }

    if (type === "trips") {
      downloadWorkbook(
        "trips-export",
        "Trips",
        filteredTrips.map((trip) => {
          const dredger = dredgers.find((item) => item.id === trip.dredgerId);
          const transporter = transporters.find((item) => item.id === trip.transporterId);
          return {
            Date: formatDisplayDate(trip.date),
            Dredger: dredger?.name || dredger?.code || trip.dredgerId,
            Transporter: transporter?.name || transporter?.code || trip.transporterId,
            PlateNumber: trip.plateNumber,
            Trips: trip.trips,
            CapacityCbm: trip.capacityCbm,
            TotalVolume: trip.totalVolume,
            DredgerRate: trip.dredgerRate,
            TransporterRate: trip.transporterRate,
            DredgerAmount: trip.dredgerAmount,
            TransporterAmount: trip.transporterAmount,
            DumpingLocation: trip.dumpingLocation,
            Notes: trip.notes,
            Reference: trip.reference,
          };
        }),
      );
      return;
    }

    downloadWorkbook(
      "payments-export",
      "Payments",
      filteredPaymentsList.map((payment) => ({
        Date: formatDisplayDate(payment.date),
        EntityType: payment.entityType,
        Entity: getPaymentEntityLabel(payment),
        EntityCode: payment.entityId,
        Amount: payment.amount,
        PaymentMethod: payment.paymentMethod,
        Reference: payment.reference,
        Notes: payment.notes,
      })),
    );
  };

  const exportTrucksReport = () => {
    downloadWorkbook(
      "trucks-report",
      "Trucks",
      transporters.flatMap((transporter) =>
        transporter.trucks.map((truck) => ({
          TransporterCode: transporter.code,
          Transporter: transporter.name,
          Contractor: transporter.contractor,
          TruckName: truck.truckName || "Unnamed",
          PlateNumber: truck.plateNumber,
          TransporterBillingCbm: truck.transporterBillingCbm ?? 0,
          DredgerBillingCbm: truck.dredgerBillingCbm ?? 0,
          CapacityCbm: truck.capacityCbm,
          Status: truck.status,
        })),
      ),
    );
  };

  const exportElementToPdf = async (
    element: HTMLDivElement | null,
    fileName: string,
    orientation: "portrait" | "landscape" = "landscape",
  ) => {
    if (!element) return;
    try {
      setIsExportingPdf(true);
      await sleep(150);
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        windowWidth: element.scrollWidth,
      });

      const pdf = new jsPDF(orientation, "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 6;
      const imageWidth = pageWidth - margin * 2;
      const imageHeight = (canvas.height * imageWidth) / canvas.width;
      const imageData = canvas.toDataURL("image/png");

      let heightLeft = imageHeight;
      let position = margin;

      pdf.addImage(imageData, "PNG", margin, position, imageWidth, imageHeight, undefined, "FAST");
      heightLeft -= pageHeight - margin * 2;

      while (heightLeft > 0) {
        position = heightLeft - imageHeight + margin;
        pdf.addPage();
        pdf.addImage(imageData, "PNG", margin, position, imageWidth, imageHeight, undefined, "FAST");
        heightLeft -= pageHeight - margin * 2;
      }

      pdf.save(`${sanitizeFileName(fileName)}.pdf`);
    } catch (error) {
      console.error("PDF export failed:", error);
      setErrorMessage("PDF export failed. Please try again.");
    } finally {
      setIsExportingPdf(false);
    }
  };

  const downloadTransporterReportPdf = async () => {
    await exportElementToPdf(reportTransporterReportRef.current, "transporter-report", "landscape");
  };

  const downloadReportsAsPdf = async () => {
    await exportElementToPdf(reportSectionRef.current, "dredging-reports", "landscape");
  };

  const downloadTransporterReportExcel = () => {
    downloadWorkbook(
      "transporter-report",
      "Transporter Report",
      transporterReportRows.flatMap((group) =>
        group.rows.map((row) => {
          const dredger = dredgers.find((item) => item.id === row.dredgerId);
          const transporter = transporters.find((item) => item.id === row.transporterId);
          const truck = transporter?.trucks.find((item) => item.id === row.truckId || item.plateNumber === row.plateNumber);
          return {
            Group: trReportFilter.groupBy === "date" ? formatDisplayDate(group.key) : group.key,
            Date: formatDisplayDate(row.date),
            Dredger: dredger?.name || row.dredgerId,
            Transporter: transporter?.name || row.transporterId,
            Contractor: transporter?.contractor || "",
            TruckName: truck?.truckName || "",
            PlateNumber: row.plateNumber,
            Trips: row.trips,
            CapacityCbm: row.capacityCbm,
            TotalVolume: row.totalVolume,
            Amount: row.transporterAmount,
            Reference: row.reference,
          };
        }),
      ),
    );
  };

  const openAddTruckModal = (transporterId: string) => {
    setTruckForm({
      transporterId,
      truckName: "",
      plateNumber: "",
      transporterBillingCbm: undefined,
      dredgerBillingCbm: undefined,
      status: "active",
    });
    setShowAddTruckModal(true);
  };

  const handleAddTruckSubmit = async () => {
    const transporter = transporters.find((item) => item.id === truckForm.transporterId);
    if (!transporter || !truckForm.plateNumber?.trim()) {
      alert("Please select a transporter and enter a plate number.");
      return;
    }

    const plateNumber = truckForm.plateNumber.trim().toUpperCase();
    if (transporter.trucks.some((truck) => truck.plateNumber.toUpperCase() === plateNumber)) {
      alert("This truck already exists for the selected transporter.");
      return;
    }

    setIsSavingTruck(true);
    try {
      await submitToAppsScript("addTruck", {
        Code: transporter.code,
        Name: transporter.name,
        RatePerCbm: transporter.ratePerCbm,
        Status: transporter.status,
        Contractor: transporter.contractor,
        ContractNumber: transporter.contractNumber,
        PlateNumber: plateNumber,
        TruckName: truckForm.truckName?.trim() || "Unnamed",
        TransporterBillingCbm: truckForm.transporterBillingCbm || 0,
        DredgerBillingCbm: truckForm.dredgerBillingCbm || 0,
      });
      setShowAddTruckModal(false);
      setTruckForm({ transporterId: "" });
      await refreshAfterMutation("Truck saved successfully.");
    } catch (error) {
      console.error("Add truck failed:", error);
      setErrorMessage("Truck could not be saved.");
    } finally {
      setIsSavingTruck(false);
    }
  };

  const saveTransporter = async () => {
    if (!transporterForm.code?.trim() || !transporterForm.name?.trim()) {
      alert("Please fill in both the transporter code and name.");
      return;
    }

    setIsSavingTransporter(true);
    try {
      await submitToAppsScript(editingItem ? "updateTransporter" : "saveTransporter", {
        Code: transporterForm.code.trim(),
        Name: transporterForm.name.trim(),
        RatePerCbm: transporterForm.ratePerCbm || 0,
        Status: transporterForm.status || "active",
        Contractor: transporterForm.contractor || "",
        ContractNumber: transporterForm.contractNumber || "",
        rowNumber: (editingItem as Transporter | null)?.rowNumber,
        Row: (editingItem as Transporter | null)?.rowNumber,
      });
      setShowTransporterModal(false);
      setEditingItem(null);
      setTransporterForm({});
      await refreshAfterMutation("Transporter saved successfully.");
    } catch (error) {
      console.error("Save transporter failed:", error);
      setErrorMessage("Transporter could not be saved.");
    } finally {
      setIsSavingTransporter(false);
    }
  };

  const saveDredger = async () => {
    if (!dredgerForm.code?.trim() || !dredgerForm.name?.trim()) {
      alert("Please fill in both the dredger code and name.");
      return;
    }

    setIsSavingDredger(true);
    try {
      await submitToAppsScript("saveDredger", {
        Code: dredgerForm.code.trim(),
        Name: dredgerForm.name.trim(),
        RatePerCbm: dredgerForm.ratePerCbm || 0,
        Status: dredgerForm.status || "active",
        Contractor: dredgerForm.contractor || "",
        ContractNumber: dredgerForm.contractNumber || "",
        rowNumber: (editingItem as Dredger | null)?.rowNumber,
        Row: (editingItem as Dredger | null)?.rowNumber,
      });
      setShowDredgerModal(false);
      setEditingItem(null);
      setDredgerForm({});
      await refreshAfterMutation("Dredger saved successfully.");
    } catch (error) {
      console.error("Save dredger failed:", error);
      setErrorMessage("Dredger could not be saved.");
    } finally {
      setIsSavingDredger(false);
    }
  };

  const saveTrip = async () => {
    if (!tripForm.date || !tripForm.dredgerId || !tripForm.transporterId || !tripForm.truckId || !tripForm.trips) {
      alert("Please complete the required trip fields.");
      return;
    }

    const truck = allTrucks.find((item) => item.id === tripForm.truckId);
    const dredger = dredgers.find((item) => item.id === tripForm.dredgerId);
    const transporter = transporters.find((item) => item.id === tripForm.transporterId);

    if (!truck || !dredger || !transporter) {
      alert("Trip references are incomplete. Please reselect the trip details.");
      return;
    }

    const previousEditingItem = editingItem as Trip | null;
    const tripsCount = Number(tripForm.trips) || 0;
    const dredgerRate = tripForm.dredgerRate ?? dredger.ratePerCbm ?? 0;
    const transporterRate = tripForm.transporterRate ?? truck.ratePerCbm ?? transporter.ratePerCbm ?? 0;
    let actualLoadedCbm = tripForm.capacityCbm || 0;

    const truckDredgerCbm = truck.dredgerBillingCbm || truck.capacityCbm || 0;
    const truckTransporterCbm = truck.transporterBillingCbm || truck.capacityCbm || 0;

    let transporterBillingCbm: number;
    let dredgerBillingCbm: number;

    if (!actualLoadedCbm || actualLoadedCbm === truckDredgerCbm) {
      actualLoadedCbm = truckDredgerCbm;
      transporterBillingCbm = truckTransporterCbm;
      dredgerBillingCbm = truckDredgerCbm;
    } else {
      transporterBillingCbm = actualLoadedCbm;
      dredgerBillingCbm = actualLoadedCbm;
    }

    const totalTripsVolume = tripsCount * actualLoadedCbm;
    const dredgerAmount = tripForm.dredgerAmount ?? tripsCount * dredgerBillingCbm * dredgerRate;
    const transporterAmount = tripForm.transporterAmount ?? tripsCount * transporterBillingCbm * transporterRate;
    const reference = previousEditingItem?.reference || generateReference("TRIP");

    const optimisticTrip: Trip = {
      id: previousEditingItem?.id || reference,
      date: tripForm.date,
      dredgerId: dredger.id,
      transporterId: transporter.id,
      truckId: truck.id,
      plateNumber: truck.plateNumber,
      trips: tripsCount,
      capacityCbm: actualLoadedCbm,
      totalVolume: totalTripsVolume,
      dredgerRate,
      transporterRate,
      dredgerAmount,
      transporterAmount,
      tripCbm: actualLoadedCbm,
      totalTripsVolume,
      transporterBillingCbm,
      dredgerBillingCbm,
      dumpingLocation: tripForm.dumpingLocation || "",
      notes: tripForm.notes || "",
      reference,
      rowNumber: previousEditingItem?.rowNumber,
      actualLoadedCbm,
    };

    setShowTripModal(false);
    setEditingItem(null);
    setTripForm({});
    setErrorMessage(null);
    setSyncMessage(previousEditingItem ? "Trip update queued. Syncing to Google Sheets in the background..." : "Trip queued. Syncing to Google Sheets in the background...");
    setIsSavingTrip(false);

    setTrips((prev) => {
      if (previousEditingItem) {
        return prev.map((trip) => (trip.id === previousEditingItem.id ? optimisticTrip : trip));
      }
      return [...prev, optimisticTrip];
    });

    const action = previousEditingItem ? "updateTrip" : "saveTrip";

    void submitToAppsScript(action, {
      Date: formatDisplayDate(tripForm.date),
      DredgerCode: dredger.code,
      TransporterCode: transporter.code,
      PlateNumber: truck.plateNumber,
      Trips: tripsCount,
      DredgerRate: dredgerRate,
      TransporterRate: transporterRate,
      DumpingLocation: tripForm.dumpingLocation || "",
      Notes: tripForm.notes || "",
      TransporterBillingCbm: transporterBillingCbm,
      DredgerBillingCbm: dredgerBillingCbm,
      ActualLoadedCbm: actualLoadedCbm,
      DredgerAmount: dredgerAmount,
      TransporterAmount: transporterAmount,
      TotalTripsVolume: totalTripsVolume,
      Reference: reference,
      rowNumber: previousEditingItem?.rowNumber,
      Row: previousEditingItem?.rowNumber,
    })
      .then(async () => {
        await refreshAfterMutation(previousEditingItem ? "Trip updated successfully." : "Trip saved successfully.");
      })
      .catch((error) => {
        console.error("Save trip failed:", error);
        setErrorMessage("Trip was added locally, but Google Sheets sync failed. Please refresh and try again.");
        if (previousEditingItem) {
          setTrips((prev) => prev.map((trip) => (trip.id === optimisticTrip.id ? previousEditingItem : trip)));
        } else {
          setTrips((prev) => prev.filter((trip) => trip.id !== optimisticTrip.id));
        }
      });
  };

  const savePayment = async () => {
    if (!paymentForm.date || !paymentForm.entityType || !paymentForm.entityId || !paymentForm.amount) {
      alert("Please complete the required payment fields.");
      return;
    }

    setIsSavingPayment(true);
    try {
      const reference = paymentForm.reference || (editingItem as Payment | null)?.reference || generateReference("PAY");

      if (editingItem) {
        await submitToAppsScript("deletePayment", {
          Reference: (editingItem as Payment).reference,
          rowNumber: (editingItem as Payment | null)?.rowNumber,
          Row: (editingItem as Payment | null)?.rowNumber,
        });
      }

      await submitToAppsScript("savePayment", {
        Date: formatDisplayDate(paymentForm.date),
        EntityType: paymentForm.entityType,
        EntityCode: paymentForm.entityId,
        Amount: paymentForm.amount,
        PaymentMethod: paymentForm.paymentMethod || "Bank Transfer",
        Reference: reference,
        Notes: paymentForm.notes || "",
      });
      setShowPaymentModal(false);
      setEditingItem(null);
      setPaymentForm({ entityType: "dredger" });
      await refreshAfterMutation(editingItem ? "Payment updated successfully." : "Payment saved successfully.");
    } catch (error) {
      console.error("Save payment failed:", error);
      setErrorMessage("Payment could not be saved.");
    } finally {
      setIsSavingPayment(false);
    }
  };

  const deleteItem = async (type: "dredger" | "transporter" | "trip" | "payment", id: string) => {
    const confirmed = window.confirm(`Are you sure you want to delete this ${type}?`);
    if (!confirmed) return;

    try {
      if (type === "dredger") {
        const dredger = dredgers.find((item) => item.id === id);
        await submitToAppsScript("deleteDredger", {
          id,
          Code: dredger?.code,
          rowNumber: dredger?.rowNumber,
          Row: dredger?.rowNumber,
        });
      }

      if (type === "transporter") {
        const transporter = transporters.find((item) => item.id === id);
        await submitToAppsScript("deleteTransporter", {
          id,
          Code: transporter?.code,
          rowNumber: transporter?.rowNumber,
          Row: transporter?.rowNumber,
        });
      }

      if (type === "trip") {
        const trip = trips.find((item) => item.id === id || item.reference === id);
        await submitToAppsScript("deleteTrip", {
          id,
          Reference: trip?.reference,
          rowNumber: trip?.rowNumber,
          Row: trip?.rowNumber,
        });
      }

      if (type === "payment") {
        const payment = payments.find((item) => item.id === id || item.reference === id);
        await submitToAppsScript("deletePayment", {
          id,
          Reference: payment?.reference,
          rowNumber: payment?.rowNumber,
          Row: payment?.rowNumber,
        });
      }

      await refreshAfterMutation(`${type.charAt(0).toUpperCase() + type.slice(1)} deleted successfully.`);
    } catch (error) {
      console.error(`Delete ${type} failed:`, error);
      setErrorMessage(`The ${type} could not be deleted.`);
    }
  };

  const deleteTruck = async (transporterId: string, truckId: string) => {
    const transporter = transporters.find((item) => item.id === transporterId);
    const truck = transporter?.trucks.find((item) => item.id === truckId);
    if (!transporter || !truck) return;

    const confirmed = window.confirm(`Delete truck ${truck.plateNumber}?`);
    if (!confirmed) return;

    try {
      await submitToAppsScript("deleteTruck", {
        transporterId,
        truckId,
        Code: transporter.code,
        PlateNumber: truck.plateNumber,
      });
      await refreshAfterMutation("Truck deleted successfully.");
    } catch (error) {
      console.error("Delete truck failed:", error);
      setErrorMessage("The truck could not be deleted.");
    }
  };

  const totalProjectCost = overallStats.totalDredgerCost + overallStats.totalTransporterCost;
  const dashboardTitle =
    appConfig.AppTitle || appConfig.apptitle || appConfig.Title || appConfig.title || "Dredging Operations Dashboard";
  const dashboardSubtitle =
    appConfig.AppSubtitle ||
    appConfig.appsubtitle ||
    appConfig.Subtitle ||
    appConfig.subtitle ||
    "Sand dredging, haulage tracking, contractor billing, payments, and reporting.";

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-blue-950/40 bg-gradient-to-r from-blue-950 via-blue-900 to-slate-900 text-white shadow-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10 backdrop-blur-sm">
              <Ship className="h-8 w-8 text-cyan-200" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{dashboardTitle}</h1>
              <p className="text-sm text-blue-100/90">{dashboardSubtitle}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {latestTripDisplay && (
              <div className="rounded-full bg-white/10 px-3 py-2 text-blue-50 ring-1 ring-white/10">
                Latest trip: <span className="font-semibold">{latestTripDisplay}</span>
              </div>
            )}
            <button
              onClick={() => void loadDataFromSheets()}
              className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-4 py-2 font-medium text-slate-950 transition hover:bg-cyan-300"
            >
              <RefreshCcw className={`h-4 w-4 ${loadingData ? "animate-spin" : ""}`} />
              {loadingData ? "Refreshing..." : "Refresh Data"}
            </button>
          </div>
        </div>
      </header>

      <nav className="sticky top-[92px] z-20 border-b border-slate-200 bg-white/90 shadow-sm backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex gap-1 overflow-x-auto py-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium whitespace-nowrap transition ${
                  activeTab === tab.id
                    ? "border-blue-600 bg-blue-50 text-blue-700 shadow-sm"
                    : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {(syncMessage || errorMessage) && (
          <div className="mb-6 space-y-3">
            {syncMessage && (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
                <CheckCircle2 className="h-5 w-5" />
                <span>{syncMessage}</span>
              </div>
            )}
            {errorMessage && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-5 w-5" />
                  <span>{errorMessage}</span>
                </div>
                <button className="text-sm font-medium underline" onClick={() => setErrorMessage(null)}>
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === "dashboard" && (
          <div className="space-y-6">
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Project Overview</h2>
                <p className="text-sm text-slate-500">Filter the summary cards and overview tables by date range.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-600">Range</span>
                <input
                  type="date"
                  value={dashboardDateFilter.start}
                  onChange={(e) => setDashboardDateFilter((prev) => ({ ...prev, start: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
                <span className="text-slate-400">to</span>
                <input
                  type="date"
                  value={dashboardDateFilter.end}
                  onChange={(e) => setDashboardDateFilter((prev) => ({ ...prev, end: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
                {(dashboardDateFilter.start || dashboardDateFilter.end) && (
                  <button
                    onClick={() => setDashboardDateFilter({ start: "", end: "" })}
                    className="text-sm font-medium text-red-600 hover:text-red-800"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
              <StatCard
                label="Total Volume"
                value={`${overallStats.totalVolume.toLocaleString()} CBM`}
                tone="text-blue-700"
                iconBg="bg-blue-100"
                icon={<Activity className="h-6 w-6 text-blue-700" />}
              />
              <StatCard
                label="Total Trips"
                value={overallStats.totalTrips.toLocaleString()}
                tone="text-emerald-700"
                iconBg="bg-emerald-100"
                icon={<Truck className="h-6 w-6 text-emerald-700" />}
              />
              <StatCard
                label="Dredger Cost"
                value={formatCurrency(overallStats.totalDredgerCost)}
                tone="text-amber-700"
                iconBg="bg-amber-100"
                icon={<Ship className="h-6 w-6 text-amber-700" />}
              />
              <StatCard
                label="Transport Cost"
                value={formatCurrency(overallStats.totalTransporterCost)}
                tone="text-violet-700"
                iconBg="bg-violet-100"
                icon={<Truck className="h-6 w-6 text-violet-700" />}
              />
              <StatCard
                label="Total Paid"
                value={formatCurrency(overallStats.totalPaid)}
                tone="text-rose-700"
                iconBg="bg-rose-100"
                icon={<NairaIcon className="text-xl text-rose-700" />}
              />
            </div>

            <div className="grid grid-cols-1 gap-6">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                  <h3 className="text-lg font-bold">Dredger Summary</h3>
                  <button onClick={() => setActiveTab("dredgers")} className="text-sm font-medium text-blue-600 hover:underline">
                    View all
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-[760px] w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">Dredger</th>
                        <th className="px-4 py-3 text-right font-medium">Volume</th>
                        <th className="px-4 py-3 text-right font-medium">Rate / CBM</th>
                        <th className="px-4 py-3 text-right font-medium">Amount</th>
                        <th className="px-4 py-3 text-right font-medium">Paid</th>
                        <th className="px-4 py-3 text-right font-medium">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dredgers.map((dredger) => {
                        const earnings = calculateDredgerEarnings(dredger.id, dashboardTrips, dashboardPayments);
                        return (
                          <tr key={dredger.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                            <td className="px-4 py-3">
                              <div className="font-medium">{dredger.name}</div>
                              <div className="text-xs text-slate-500">{dredger.code}</div>
                            </td>
                            <td className="px-4 py-3 text-right">{earnings.totalVolume.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">{formatCurrency(dredger.ratePerCbm)}</td>
                            <td className="px-4 py-3 text-right">{formatCurrency(earnings.totalAmount)}</td>
                            <td className="px-4 py-3 text-right text-emerald-700">{formatCurrency(earnings.totalPaid)}</td>
                            <td className={`px-4 py-3 text-right font-semibold ${earnings.balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                              {formatCurrency(earnings.balance)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="border-t-2 border-slate-200 bg-slate-100 font-semibold text-slate-800">
                      <tr>
                        <td className="px-4 py-3">Totals</td>
                        <td className="px-4 py-3 text-right">
                          {dredgers
                            .reduce(
                              (sum, dredger) => sum + calculateDredgerEarnings(dredger.id, dashboardTrips, dashboardPayments).totalVolume,
                              0,
                            )
                            .toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(dredgers.reduce((sum, dredger) => sum + (dredger.ratePerCbm || 0), 0))}
                        </td>
                        <td className="px-4 py-3 text-right text-amber-700">
                          {formatCurrency(
                            dredgers.reduce(
                              (sum, dredger) => sum + calculateDredgerEarnings(dredger.id, dashboardTrips, dashboardPayments).totalAmount,
                              0,
                            ),
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-emerald-700">
                          {formatCurrency(
                            dredgers.reduce(
                              (sum, dredger) => sum + calculateDredgerEarnings(dredger.id, dashboardTrips, dashboardPayments).totalPaid,
                              0,
                            ),
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-rose-700">
                          {formatCurrency(
                            dredgers.reduce(
                              (sum, dredger) => sum + calculateDredgerEarnings(dredger.id, dashboardTrips, dashboardPayments).balance,
                              0,
                            ),
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                  <h3 className="text-lg font-bold">Transporters Summary</h3>
                  <button
                    onClick={() => setActiveTab("transporters")}
                    className="text-sm font-medium text-blue-600 hover:underline"
                  >
                    View all
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-[760px] w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">Contractor</th>
                        <th className="px-4 py-3 text-right font-medium">Volume</th>
                        <th className="px-4 py-3 text-right font-medium">Trips</th>
                        <th className="px-4 py-3 text-right font-medium">Amount</th>
                        <th className="px-4 py-3 text-right font-medium">Paid</th>
                        <th className="px-4 py-3 text-right font-medium">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contractorGroups.map((group) => {
                        const totals = group.transportersList.reduce(
                          (acc, transporter) => {
                            const stats = calculateTransporterEarnings(transporter.id, dashboardTrips, dashboardPayments);
                            acc.trips += stats.totalTrips;
                            acc.volume += stats.totalVolume;
                            acc.amount += stats.totalAmount;
                            return acc;
                          },
                          { trips: 0, volume: 0, amount: 0 },
                        );
                        const paid = getContractorPaymentTotal(group.displayName, group.transportersList, dashboardPayments);
                        const balance = totals.amount - paid;
                        return (
                          <tr key={group.displayName} className="border-t border-slate-100 hover:bg-slate-50/70">
                            <td className="px-4 py-3 font-medium">{group.displayName}</td>
                            <td className="px-4 py-3 text-right">{totals.volume.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">{totals.trips.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">{formatCurrency(totals.amount)}</td>
                            <td className="px-4 py-3 text-right text-emerald-700">{formatCurrency(paid)}</td>
                            <td className={`px-4 py-3 text-right font-semibold ${balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                              {formatCurrency(balance)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="border-t-2 border-slate-200 bg-slate-100 font-semibold text-slate-800">
                      <tr>
                        <td className="px-4 py-3">Totals</td>
                        <td className="px-4 py-3 text-right">
                          {contractorGroups.reduce((sum, group) => {
                            const groupVolume = group.transportersList.reduce(
                              (groupSum, transporter) =>
                                groupSum + calculateTransporterEarnings(transporter.id, dashboardTrips, dashboardPayments).totalVolume,
                              0,
                            );
                            return sum + groupVolume;
                          }, 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {contractorGroups.reduce((sum, group) => {
                            const groupTrips = group.transportersList.reduce(
                              (groupSum, transporter) =>
                                groupSum + calculateTransporterEarnings(transporter.id, dashboardTrips, dashboardPayments).totalTrips,
                              0,
                            );
                            return sum + groupTrips;
                          }, 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-amber-700">
                          {formatCurrency(
                            contractorGroups.reduce((sum, group) => {
                              const groupAmount = group.transportersList.reduce(
                                (groupSum, transporter) =>
                                  groupSum + calculateTransporterEarnings(transporter.id, dashboardTrips, dashboardPayments).totalAmount,
                                0,
                              );
                              return sum + groupAmount;
                            }, 0),
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-emerald-700">
                          {formatCurrency(
                            contractorGroups.reduce(
                              (sum, group) => sum + getContractorPaymentTotal(group.displayName, group.transportersList, dashboardPayments),
                              0,
                            ),
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-rose-700">
                          {formatCurrency(
                            contractorGroups.reduce((sum, group) => {
                              const groupAmount = group.transportersList.reduce(
                                (groupSum, transporter) =>
                                  groupSum + calculateTransporterEarnings(transporter.id, dashboardTrips, dashboardPayments).totalAmount,
                                0,
                              );
                              const groupPaid = getContractorPaymentTotal(group.displayName, group.transportersList, dashboardPayments);
                              return sum + (groupAmount - groupPaid);
                            }, 0),
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                  <h3 className="text-lg font-bold">Recent Trips</h3>
                  <button onClick={() => setActiveTab("trips")} className="text-sm font-medium text-blue-600 hover:underline">
                    View all
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-[760px] w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">Date</th>
                        <th className="px-4 py-3 text-left font-medium">Dredger</th>
                        <th className="px-4 py-3 text-left font-medium">Transporter</th>
                        <th className="px-4 py-3 text-left font-medium">Plate</th>
                        <th className="px-4 py-3 text-right font-medium">Trips</th>
                        <th className="px-4 py-3 text-right font-medium">Volume</th>
                        <th className="px-4 py-3 text-left font-medium">Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboardTrips
                        .slice()
                        .sort((a, b) => new Date(toSortableISO(b.date)).getTime() - new Date(toSortableISO(a.date)).getTime())
                        .slice(0, 10)
                        .map((trip) => {
                          const dredger = dredgers.find((item) => item.id === trip.dredgerId);
                          const transporter = transporters.find((item) => item.id === trip.transporterId);
                          return (
                            <tr key={trip.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                              <td className="px-4 py-3">{formatDisplayDate(trip.date)}</td>
                              <td className="px-4 py-3">{dredger?.name || trip.dredgerId}</td>
                              <td className="px-4 py-3">{transporter?.name || trip.transporterId}</td>
                              <td className="px-4 py-3 font-mono text-xs">{trip.plateNumber}</td>
                              <td className="px-4 py-3 text-right">{trip.trips}</td>
                              <td className="px-4 py-3 text-right">{trip.totalVolume.toFixed(2)} CBM</td>
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

        {activeTab === "dredgers" && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <h2 className="text-2xl font-bold">Dredgers Management</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => downloadTemplate("dredgers")}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2.5 text-white transition hover:bg-slate-800"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Download Template
                </button>
                <input
                  ref={dredgerFileInput}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFileImport("dredgers", file);
                    if (dredgerFileInput.current) dredgerFileInput.current.value = "";
                  }}
                />
                <button
                  onClick={() => dredgerFileInput.current?.click()}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-white transition hover:bg-emerald-700"
                >
                  <Upload className="h-4 w-4" />
                  Import Excel
                </button>
                <button
                  onClick={() => {
                    setEditingItem(null);
                    setDredgerForm({ status: "active" });
                    setShowDredgerModal(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-white transition hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" />
                  Add Dredger
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-[920px] w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Code</th>
                      <th className="px-4 py-3 text-left font-medium">Name</th>
                      <th className="px-4 py-3 text-right font-medium">Rate/CBM</th>
                      <th className="px-4 py-3 text-left font-medium">Contractor</th>
                      <th className="px-4 py-3 text-left font-medium">Contract #</th>
                      <th className="px-4 py-3 text-center font-medium">Status</th>
                      <th className="px-4 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dredgers.map((dredger) => (
                      <tr key={dredger.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-mono">{dredger.code}</td>
                        <td className="px-4 py-3 font-medium">{dredger.name}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(dredger.ratePerCbm)}</td>
                        <td className="px-4 py-3">{dredger.contractor}</td>
                        <td className="px-4 py-3 font-mono text-xs">{dredger.contractNumber}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${dredger.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>
                            {dredger.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => {
                                setEditingItem(dredger);
                                setDredgerForm(dredger);
                                setShowDredgerModal(true);
                              }}
                              className="rounded-lg p-2 text-blue-600 transition hover:bg-blue-50"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => void deleteItem("dredger", dredger.id)}
                              className="rounded-lg p-2 text-rose-600 transition hover:bg-rose-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 text-lg font-bold">Dredger Earnings Summary</h3>
              <div className="overflow-x-auto">
                <table className="min-w-[820px] w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Dredger</th>
                      <th className="px-4 py-3 text-right font-medium">Total Volume</th>
                      <th className="px-4 py-3 text-right font-medium">Rate</th>
                      <th className="px-4 py-3 text-right font-medium">Total Amount</th>
                      <th className="px-4 py-3 text-right font-medium">Total Paid</th>
                      <th className="px-4 py-3 text-right font-medium">Balance Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dredgers.map((dredger) => {
                      const earnings = calculateDredgerEarnings(dredger.id);
                      return (
                        <tr key={dredger.id} className="border-t border-slate-100">
                          <td className="px-4 py-3">
                            <div className="font-medium">{dredger.name}</div>
                            <div className="text-xs text-slate-500">{dredger.code}</div>
                          </td>
                          <td className="px-4 py-3 text-right">{earnings.totalVolume.toLocaleString()} CBM</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(dredger.ratePerCbm)}</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(earnings.totalAmount)}</td>
                          <td className="px-4 py-3 text-right text-emerald-700">{formatCurrency(earnings.totalPaid)}</td>
                          <td className={`px-4 py-3 text-right font-bold ${earnings.balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>
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

        {activeTab === "transporters" && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <h2 className="text-2xl font-bold">Transporters Management</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={exportTrucksReport}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-white transition hover:bg-indigo-700"
                >
                  <Download className="h-4 w-4" />
                  Download Trucks Report
                </button>
                <button
                  onClick={() => downloadTemplate("transporters")}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2.5 text-white transition hover:bg-slate-800"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Download Template
                </button>
                <input
                  ref={transporterFileInput}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFileImport("transporters", file);
                    if (transporterFileInput.current) transporterFileInput.current.value = "";
                  }}
                />
                <button
                  onClick={() => transporterFileInput.current?.click()}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-white transition hover:bg-emerald-700"
                >
                  <Upload className="h-4 w-4" />
                  Import Excel
                </button>
                <button
                  onClick={() => {
                    setEditingItem(null);
                    setTransporterForm({ status: "active" });
                    setShowTransporterModal(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-white transition hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" />
                  Add Transporter
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-[1060px] w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Code</th>
                      <th className="px-4 py-3 text-left font-medium">Name</th>
                      <th className="px-4 py-3 text-right font-medium">Rate/CBM</th>
                      <th className="px-4 py-3 text-left font-medium">Trucks</th>
                      <th className="px-4 py-3 text-left font-medium">Contractor</th>
                      <th className="px-4 py-3 text-center font-medium">Status</th>
                      <th className="px-4 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transporters.map((transporter) => (
                      <tr key={transporter.id} className="border-t border-slate-100 align-top hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-mono">{transporter.code}</td>
                        <td className="px-4 py-3 font-medium">{transporter.name}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(transporter.ratePerCbm)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {transporter.trucks.map((truck) => (
                              <span
                                key={truck.id}
                                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800"
                              >
                                {truck.truckName || "Unnamed"} - {truck.plateNumber} - {truck.capacityCbm}CBM
                                <button
                                  onClick={() => void deleteTruck(transporter.id, truck.id)}
                                  className="ml-1 text-rose-700 hover:text-rose-900"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                            <button
                              onClick={() => openAddTruckModal(transporter.id)}
                              className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 transition hover:bg-emerald-200"
                            >
                              + Add Truck
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3">{transporter.contractor}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${transporter.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>
                            {transporter.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => {
                                setEditingItem(transporter);
                                setTransporterForm(transporter);
                                setShowTransporterModal(true);
                              }}
                              className="rounded-lg p-2 text-blue-600 transition hover:bg-blue-50"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => void deleteItem("transporter", transporter.id)}
                              className="rounded-lg p-2 text-rose-600 transition hover:bg-rose-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 text-lg font-bold">Transporter Earnings Summary</h3>
              <div className="overflow-x-auto">
                <table className="min-w-[920px] w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Transporter</th>
                      <th className="px-4 py-3 text-right font-medium">Total Trips</th>
                      <th className="px-4 py-3 text-right font-medium">Total Volume</th>
                      <th className="px-4 py-3 text-right font-medium">Rate</th>
                      <th className="px-4 py-3 text-right font-medium">Total Amount</th>
                      <th className="px-4 py-3 text-right font-medium">Total Paid</th>
                      <th className="px-4 py-3 text-right font-medium">Balance Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transporters.map((transporter) => {
                      const earnings = calculateTransporterEarnings(transporter.id);
                      return (
                        <tr key={transporter.id} className="border-t border-slate-100">
                          <td className="px-4 py-3">
                            <div className="font-medium">{transporter.name}</div>
                            <div className="text-xs text-slate-500">{transporter.code}</div>
                          </td>
                          <td className="px-4 py-3 text-right">{earnings.totalTrips.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">{earnings.totalVolume.toLocaleString()} CBM</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(transporter.ratePerCbm)}</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(earnings.totalAmount)}</td>
                          <td className="px-4 py-3 text-right text-emerald-700">{formatCurrency(earnings.totalPaid)}</td>
                          <td className={`px-4 py-3 text-right font-bold ${earnings.balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>
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

        {activeTab === "trips" && (
          <div className="space-y-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <h2 className="text-2xl font-bold">Daily Trip Reports</h2>
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search plate, transporter, or location..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="rounded-xl border border-slate-300 py-2.5 pr-3 pl-9 text-sm"
                  />
                </div>
                <input
                  type="date"
                  value={dateFilter.start}
                  onChange={(e) => setDateFilter((prev) => ({ ...prev, start: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                />
                <input
                  type="date"
                  value={dateFilter.end}
                  onChange={(e) => setDateFilter((prev) => ({ ...prev, end: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                />
                <button
                  onClick={() => downloadTemplate("trips")}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2.5 text-white transition hover:bg-slate-800"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Template
                </button>
                <input
                  ref={tripsFileInput}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFileImport("trips", file);
                    if (tripsFileInput.current) tripsFileInput.current.value = "";
                  }}
                />
                <button
                  onClick={() => tripsFileInput.current?.click()}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-white transition hover:bg-emerald-700"
                >
                  <Upload className="h-4 w-4" />
                  Import
                </button>
                <button
                  onClick={() => {
                    setEditingItem(null);
                    setTripForm({ date: new Date().toISOString().split("T")[0] });
                    setShowTripModal(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-white transition hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" />
                  Add Trip
                </button>
                <button
                  onClick={() => exportToExcel("trips")}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-white transition hover:bg-emerald-800"
                >
                  <Download className="h-4 w-4" />
                  Export
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-[1100px] w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Date</th>
                      <th className="px-4 py-3 text-left font-medium">Dredger</th>
                      <th className="px-4 py-3 text-left font-medium">Transporter</th>
                      <th className="px-4 py-3 text-left font-medium">Truck</th>
                      <th className="px-4 py-3 text-right font-medium">Trips</th>
                      <th className="px-4 py-3 text-right font-medium">Capacity</th>
                      <th className="px-4 py-3 text-right font-medium">Total Volume</th>
                      <th className="px-4 py-3 text-left font-medium">Dumping Location</th>
                      <th className="px-4 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrips.map((trip) => {
                      const dredger = dredgers.find((item) => item.id === trip.dredgerId);
                      const transporter = transporters.find((item) => item.id === trip.transporterId);
                      const truck = transporter?.trucks.find((item) => item.id === trip.truckId || item.plateNumber === trip.plateNumber);
                      const truckDisplay = truck
                        ? `${truck.plateNumber}${truck.truckName ? ` - ${truck.truckName}` : ""}`
                        : trip.plateNumber;
                      const capacityCbm = trip.capacityCbm ?? truck?.capacityCbm ?? 0;
                      const totalVolume = trip.totalVolume ?? capacityCbm * (trip.trips ?? 0);
                      return (
                        <tr key={trip.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                          <td className="px-4 py-3">{formatDisplayDate(trip.date)}</td>
                          <td className="px-4 py-3">{dredger?.name || trip.dredgerId}</td>
                          <td className="px-4 py-3">{transporter?.name || trip.transporterId}</td>
                          <td className="px-4 py-3 font-mono text-xs">{truckDisplay}</td>
                          <td className="px-4 py-3 text-right">{trip.trips}</td>
                          <td className="px-4 py-3 text-right">{capacityCbm ? `${capacityCbm.toFixed(2)} CBM` : ""}</td>
                          <td className="px-4 py-3 text-right font-medium">{totalVolume ? `${totalVolume.toFixed(2)} CBM` : ""}</td>
                          <td className="px-4 py-3">{trip.dumpingLocation}</td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => {
                                  setEditingItem(trip);
                                  setTripForm({
                                    ...trip,
                                    date: toSortableISO(trip.date),
                                    capacityCbm:
                                      trip.actualLoadedCbm ??
                                      trip.dredgerBillingCbm ??
                                      truck?.dredgerBillingCbm ??
                                      truck?.capacityCbm ??
                                      trip.capacityCbm,
                                  });
                                  setShowTripModal(true);
                                }}
                                className="rounded-lg p-2 text-blue-600 transition hover:bg-blue-50"
                              >
                                <Edit className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => void deleteItem("trip", trip.id)}
                                className="rounded-lg p-2 text-rose-600 transition hover:bg-rose-50"
                              >
                                <Trash2 className="h-4 w-4" />
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
          </div>
        )}

        {activeTab === "payments" && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <h2 className="text-2xl font-bold">Payments Register</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => downloadTemplate("payments")}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2.5 text-white transition hover:bg-slate-800"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Template
                </button>
                <input
                  ref={paymentsFileInput}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFileImport("payments", file);
                    if (paymentsFileInput.current) paymentsFileInput.current.value = "";
                  }}
                />
                <button
                  onClick={() => paymentsFileInput.current?.click()}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-white transition hover:bg-emerald-700"
                >
                  <Upload className="h-4 w-4" />
                  Import
                </button>
                <button
                  onClick={() => {
                    setEditingItem(null);
                    setPaymentForm({ date: new Date().toISOString().split("T")[0], entityType: "dredger" });
                    setShowPaymentModal(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-white transition hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" />
                  Add Payment
                </button>
                <button
                  onClick={() => exportToExcel("payments")}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-white transition hover:bg-emerald-800"
                >
                  <Download className="h-4 w-4" />
                  Export
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-4 lg:flex-row lg:items-center">
                <div className="text-sm font-semibold text-slate-700">Filter</div>
                <select
                  value={paymentFilter.entityType}
                  onChange={(e) => setPaymentFilter((prev) => ({ ...prev, entityType: e.target.value as "" | EntityType }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">All Types</option>
                  <option value="dredger">Dredger</option>
                  <option value="transporter">Transporter</option>
                </select>
                <input
                  type="text"
                  placeholder="Search entity, code, reference, or notes"
                  value={paymentFilter.query}
                  onChange={(e) => setPaymentFilter((prev) => ({ ...prev, query: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm lg:min-w-[320px]"
                />
                <button
                  onClick={() => setPaymentFilter({ entityType: "", query: "" })}
                  className="text-sm font-medium text-rose-600 hover:text-rose-800"
                >
                  Clear
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[1000px] w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Date</th>
                      <th className="px-4 py-3 text-left font-medium">Type</th>
                      <th className="px-4 py-3 text-left font-medium">Entity</th>
                      <th className="px-4 py-3 text-right font-medium">Amount</th>
                      <th className="px-4 py-3 text-left font-medium">Payment Method</th>
                      <th className="px-4 py-3 text-left font-medium">Reference</th>
                      <th className="px-4 py-3 text-left font-medium">Notes</th>
                      <th className="px-4 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPaymentsList.map((payment) => (
                      <tr key={payment.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                        <td className="px-4 py-3">{formatDisplayDate(payment.date)}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${payment.entityType === "dredger" ? "bg-amber-100 text-amber-700" : "bg-violet-100 text-violet-700"}`}>
                            {payment.entityType}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium">{getPaymentEntityLabel(payment)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-emerald-700">{formatCurrency(payment.amount)}</td>
                        <td className="px-4 py-3">{payment.paymentMethod}</td>
                        <td className="px-4 py-3 font-mono text-xs">{payment.reference}</td>
                        <td className="px-4 py-3 text-slate-600">{payment.notes}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => {
                                setEditingItem(payment);
                                setPaymentForm({ ...payment, date: toSortableISO(payment.date) || payment.date });
                                setShowPaymentModal(true);
                              }}
                              className="rounded-lg p-2 text-blue-600 transition hover:bg-blue-50"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => void deleteItem("payment", payment.id)}
                              className="rounded-lg p-2 text-rose-600 transition hover:bg-rose-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === "transporterReport" && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between print:hidden">
              <h2 className="text-2xl font-bold">Transporter Report</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void downloadTransporterReportPdf()}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-white transition hover:bg-blue-700"
                >
                  <Download className="h-4 w-4" />
                  PDF
                </button>
                <button
                  onClick={downloadTransporterReportExcel}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-white transition hover:bg-emerald-700"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Excel
                </button>
                <input
                  type="date"
                  value={trReportFilter.start}
                  onChange={(e) => setTrReportFilter((prev) => ({ ...prev, start: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="date"
                  value={trReportFilter.end}
                  onChange={(e) => setTrReportFilter((prev) => ({ ...prev, end: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder="Plate #"
                  value={trReportFilter.plate}
                  onChange={(e) => setTrReportFilter((prev) => ({ ...prev, plate: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder="Truck name"
                  value={trReportFilter.truckName}
                  onChange={(e) => setTrReportFilter((prev) => ({ ...prev, truckName: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
                <select
                  value={trReportFilter.dredgerId}
                  onChange={(e) => setTrReportFilter((prev) => ({ ...prev, dredgerId: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">All Dredgers</option>
                  {dredgers.map((dredger) => (
                    <option key={dredger.id} value={dredger.id}>
                      {dredger.name}
                    </option>
                  ))}
                </select>
                <select
                  value={trReportFilter.contractor}
                  onChange={(e) => setTrReportFilter((prev) => ({ ...prev, contractor: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">All Contractors</option>
                  {contractorOptions.map((contractor) => (
                    <option key={contractor} value={contractor}>
                      {contractor}
                    </option>
                  ))}
                </select>
                <select
                  value={trReportFilter.groupBy}
                  onChange={(e) =>
                    setTrReportFilter((prev) => ({
                      ...prev,
                      groupBy: e.target.value as "date" | "truckName" | "plate" | "dredger" | "contractor",
                    }))
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="date">Group by Date</option>
                  <option value="truckName">Group by Truck Name</option>
                  <option value="plate">Group by Plate Number</option>
                  <option value="dredger">Group by Dredger</option>
                  <option value="contractor">Group by Contractor</option>
                </select>
                <button
                  onClick={() =>
                    setTrReportFilter({
                      start: "",
                      end: "",
                      plate: "",
                      truckName: "",
                      dredgerId: "",
                      contractor: "",
                      groupBy: "date",
                    })
                  }
                  className="text-sm font-medium text-rose-600 hover:text-rose-800"
                >
                  Reset
                </button>
              </div>
            </div>

            <div
              className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${isExportingPdf ? "shadow-none" : ""}`}
              ref={reportTransporterReportRef}
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <h3 className="text-lg font-bold">Grouped Results</h3>
                <div className="text-sm text-slate-500">Grouping by {trReportFilter.groupBy}</div>
              </div>
              <div className="divide-y divide-slate-200">
                {transporterReportRows.length === 0 && (
                  <div className="p-8 text-center text-slate-500">No data for the selected filters.</div>
                )}
                {transporterReportRows.map((group) => (
                  <div key={group.key} className="page-break-inside-avoid p-4">
                    <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                      <h4 className={`text-lg font-bold ${trReportFilter.groupBy === "date" ? "text-rose-700" : "text-slate-800"}`}>
                        {trReportFilter.groupBy === "date" ? formatDisplayDate(group.key) : group.key || "(Unspecified)"}
                      </h4>
                      <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                        <span>
                          Trips: <strong>{group.totalTrips.toLocaleString()}</strong>
                        </span>
                        <span>
                          Total CBM: <strong>{group.totalVolume.toLocaleString()}</strong>
                        </span>
                        <span>
                          Total Amount: <strong>{formatCurrency(group.totalAmount)}</strong>
                        </span>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-[980px] w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-3 py-2 text-left">Date</th>
                            <th className="px-3 py-2 text-left">Dredger</th>
                            <th className="px-3 py-2 text-left">Transporter</th>
                            <th className="px-3 py-2 text-left">Truck</th>
                            <th className="px-3 py-2 text-right">Cubic Capacity</th>
                            <th className="px-3 py-2 text-right">Trips</th>
                            <th className="px-3 py-2 text-right">Volume</th>
                            <th className="px-3 py-2 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row) => {
                            const dredger = dredgers.find((item) => item.id === row.dredgerId);
                            const transporter = transporters.find((item) => item.id === row.transporterId);
                            const truck = transporter?.trucks.find((item) => item.id === row.truckId || item.plateNumber === row.plateNumber);
                            return (
                              <tr key={row.id} className="border-t border-slate-100">
                                <td className="px-3 py-2">{formatDisplayDate(row.date)}</td>
                                <td className="px-3 py-2">{dredger?.name || row.dredgerId}</td>
                                <td className="px-3 py-2">{transporter?.name || row.transporterId}</td>
                                <td className="px-3 py-2 font-mono text-xs">
                                  {truck ? `${truck.truckName || "Unnamed"} (${truck.plateNumber})` : row.plateNumber}
                                </td>
                                <td className="px-3 py-2 text-right">{(row.capacityCbm || truck?.capacityCbm || 0).toLocaleString()}</td>
                                <td className="px-3 py-2 text-right">{row.trips.toLocaleString()}</td>
                                <td className="px-3 py-2 text-right">{row.totalVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                <td className="px-3 py-2 text-right font-medium">{formatCurrency(row.transporterAmount)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-slate-50 font-semibold text-slate-700">
                          <tr>
                            <td className="px-3 py-2" colSpan={5}>
                              Group Totals
                            </td>
                            <td className="px-3 py-2 text-right">{group.totalTrips.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right">{group.totalVolume.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right text-blue-700">{formatCurrency(group.totalAmount)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "reports" && (
          <div className="space-y-6" ref={reportSectionRef}>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between print:hidden">
              <h2 className="text-2xl font-bold">Comprehensive Reports</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => exportToExcel("trips")}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-white transition hover:bg-emerald-700"
                >
                  <Download className="h-4 w-4" />
                  Export Trips
                </button>
                <button
                  onClick={() => exportToExcel("dredgers")}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-white transition hover:bg-blue-700"
                >
                  <Download className="h-4 w-4" />
                  Export Dredgers
                </button>
                <button
                  onClick={() => exportToExcel("transporters")}
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-white transition hover:bg-violet-700"
                >
                  <Download className="h-4 w-4" />
                  Export Transporters
                </button>
                <button
                  onClick={() => exportToExcel("payments")}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-white transition hover:bg-amber-700"
                >
                  <Download className="h-4 w-4" />
                  Export Payments
                </button>
                <button
                  onClick={() => void downloadReportsAsPdf()}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-white transition hover:bg-black"
                >
                  <Download className="h-4 w-4" />
                  Download PDF
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-3">
                <div className="rounded-2xl bg-slate-100 p-3">
                  <FileSpreadsheet className="h-6 w-6 text-slate-700" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Overall Project Summary</h3>
                  {latestTripDisplay && <p className="text-sm text-slate-500">Updated to {latestTripDisplay}</p>}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                <StatCard
                  label="Total Volume"
                  value={`${overallStats.totalVolume.toLocaleString()} CBM`}
                  tone="text-blue-700"
                  iconBg="bg-blue-100"
                  icon={<Activity className="h-6 w-6 text-blue-700" />}
                />
                <StatCard
                  label="Total Trips"
                  value={overallStats.totalTrips.toLocaleString()}
                  tone="text-emerald-700"
                  iconBg="bg-emerald-100"
                  icon={<Truck className="h-6 w-6 text-emerald-700" />}
                />
                <StatCard
                  label="Dredger Cost"
                  value={formatCurrency(overallStats.totalDredgerCost)}
                  tone="text-amber-700"
                  iconBg="bg-amber-100"
                  icon={<Ship className="h-6 w-6 text-amber-700" />}
                />
                <StatCard
                  label="Transport Cost"
                  value={formatCurrency(overallStats.totalTransporterCost)}
                  tone="text-violet-700"
                  iconBg="bg-violet-100"
                  icon={<Truck className="h-6 w-6 text-violet-700" />}
                />
                <StatCard
                  label="Total Paid"
                  value={formatCurrency(overallStats.totalPaid)}
                  tone="text-rose-700"
                  iconBg="bg-rose-100"
                  icon={<NairaIcon className="text-xl text-rose-700" />}
                />
              </div>
              <div className="mt-6 grid grid-cols-1 gap-4 border-t border-slate-200 pt-6 md:grid-cols-3">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Total Project Cost</p>
                  <p className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(totalProjectCost)}</p>
                </div>
                <div className="rounded-2xl bg-emerald-50 p-4">
                  <p className="text-sm text-emerald-700">Total Payments Made</p>
                  <p className="mt-2 text-2xl font-bold text-emerald-700">{formatCurrency(overallStats.totalPaid)}</p>
                </div>
                <div className="rounded-2xl bg-rose-50 p-4">
                  <p className="text-sm text-rose-700">Outstanding Balance</p>
                  <p className="mt-2 text-2xl font-bold text-rose-700">{formatCurrency(totalProjectCost - overallStats.totalPaid)}</p>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-xl font-bold">Dredger Performance Report</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Dredger</th>
                      <th className="px-4 py-3 text-left font-medium">Contractor</th>
                      <th className="px-4 py-3 text-right font-medium">Rate/CBM</th>
                      <th className="px-4 py-3 text-right font-medium">Total Volume</th>
                      <th className="px-4 py-3 text-right font-medium">Total Amount</th>
                      <th className="px-4 py-3 text-right font-medium">Total Paid</th>
                      <th className="px-4 py-3 text-right font-medium">Balance</th>
                      <th className="px-4 py-3 text-center font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dredgers.map((dredger) => {
                      const earnings = calculateDredgerEarnings(dredger.id);
                      return (
                        <tr key={dredger.id} className="border-t border-slate-100">
                          <td className="px-4 py-3">
                            <div className="font-medium">{dredger.name}</div>
                            <div className="text-xs text-slate-500">{dredger.code}</div>
                          </td>
                          <td className="px-4 py-3">{dredger.contractor}</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(dredger.ratePerCbm)}</td>
                          <td className="px-4 py-3 text-right">{earnings.totalVolume.toLocaleString()} CBM</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(earnings.totalAmount)}</td>
                          <td className="px-4 py-3 text-right text-emerald-700">{formatCurrency(earnings.totalPaid)}</td>
                          <td className={`px-4 py-3 text-right font-semibold ${earnings.balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                            {formatCurrency(earnings.balance)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${earnings.balance > 0 ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                              {earnings.balance > 0 ? "Due" : "Paid"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-xl font-bold">Transporter Performance Report</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[920px] w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Contractor</th>
                      <th className="px-4 py-3 text-right font-medium">Total Trips</th>
                      <th className="px-4 py-3 text-right font-medium">Total Volume</th>
                      <th className="px-4 py-3 text-right font-medium">Total Amount</th>
                      <th className="px-4 py-3 text-right font-medium">Total Paid</th>
                      <th className="px-4 py-3 text-right font-medium">Balance</th>
                      <th className="px-4 py-3 text-center font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contractorGroups.map((group) => {
                      const totals = group.transportersList.reduce(
                        (acc, transporter) => {
                          const stats = calculateTransporterEarnings(transporter.id);
                          acc.totalTrips += stats.totalTrips;
                          acc.totalVolume += stats.totalVolume;
                          acc.totalAmount += stats.totalAmount;
                          return acc;
                        },
                        { totalTrips: 0, totalVolume: 0, totalAmount: 0 },
                      );
                      const totalPaid = getContractorPaymentTotal(group.displayName, group.transportersList);
                      const balance = totals.totalAmount - totalPaid;
                      return (
                        <tr key={group.displayName} className="border-t border-slate-100">
                          <td className="px-4 py-3 font-medium">{group.displayName}</td>
                          <td className="px-4 py-3 text-right">{totals.totalTrips.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">{totals.totalVolume.toLocaleString()} CBM</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(totals.totalAmount)}</td>
                          <td className="px-4 py-3 text-right text-emerald-700">{formatCurrency(totalPaid)}</td>
                          <td className={`px-4 py-3 text-right font-semibold ${balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                            {formatCurrency(balance)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${balance > 0 ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                              {balance > 0 ? "Due" : "Paid"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 text-xl font-bold">
                <NairaIcon className="text-2xl" />
                Accounting Summary
              </h3>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div>
                  <h4 className="mb-3 font-semibold">Dredger Payments</h4>
                  <div className="space-y-3">
                    {dredgers.map((dredger) => {
                      const earnings = calculateDredgerEarnings(dredger.id);
                      return (
                        <div key={dredger.id} className="flex items-center justify-between rounded-2xl bg-slate-50 p-4">
                          <div>
                            <div className="font-medium">{dredger.name}</div>
                            <div className="text-xs text-slate-500">{dredger.code}</div>
                          </div>
                          <div className="text-right text-sm">
                            <div className="text-slate-600">Due: {formatCurrency(earnings.totalAmount)}</div>
                            <div className="text-emerald-700">Paid: {formatCurrency(earnings.totalPaid)}</div>
                            <div className={`font-bold ${earnings.balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                              Balance: {formatCurrency(earnings.balance)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <h4 className="mb-3 font-semibold">Transporter Payments by Contractor</h4>
                  <div className="space-y-3">
                    {contractorGroups.map((group) => {
                      const totalAmount = group.transportersList.reduce(
                        (sum, transporter) => sum + calculateTransporterEarnings(transporter.id).totalAmount,
                        0,
                      );
                      const totalPaid = getContractorPaymentTotal(group.displayName, group.transportersList);
                      const balance = totalAmount - totalPaid;
                      return (
                        <div key={group.displayName} className="flex items-center justify-between rounded-2xl bg-slate-50 p-4">
                          <div>
                            <div className="font-medium">{group.displayName}</div>
                            <div className="text-xs text-slate-500">{group.transportersList.length} transporter(s)</div>
                          </div>
                          <div className="text-right text-sm">
                            <div className="text-slate-600">Due: {formatCurrency(totalAmount)}</div>
                            <div className="text-emerald-700">Paid: {formatCurrency(totalPaid)}</div>
                            <div className={`font-bold ${balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                              Balance: {formatCurrency(balance)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {showDredgerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-xl font-bold">{editingItem ? "Edit" : "Add"} Dredger</h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Code</label>
                <input
                  type="text"
                  value={dredgerForm.code || ""}
                  onChange={(e) => setDredgerForm((prev) => ({ ...prev, code: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  placeholder="DR-001"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
                <input
                  type="text"
                  value={dredgerForm.name || ""}
                  onChange={(e) => setDredgerForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  placeholder="Dredger Name"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Rate per CBM (₦)</label>
                <input
                  type="number"
                  step="0.01"
                  value={dredgerForm.ratePerCbm ?? ""}
                  onChange={(e) =>
                    setDredgerForm((prev) => ({
                      ...prev,
                      ratePerCbm: e.target.value ? parseFloat(e.target.value) : undefined,
                    }))
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Contractor</label>
                <input
                  type="text"
                  value={dredgerForm.contractor || ""}
                  onChange={(e) => setDredgerForm((prev) => ({ ...prev, contractor: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  placeholder="Contractor Name"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Contract Number</label>
                <input
                  type="text"
                  value={dredgerForm.contractNumber || ""}
                  onChange={(e) => setDredgerForm((prev) => ({ ...prev, contractNumber: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  placeholder="CNT-2026-001"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
                <select
                  value={dredgerForm.status || "active"}
                  onChange={(e) => setDredgerForm((prev) => ({ ...prev, status: e.target.value as EntityStatus }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowDredgerModal(false);
                  setEditingItem(null);
                  setDredgerForm({});
                }}
                className="rounded-xl border border-slate-300 px-4 py-2.5 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveDredger()}
                disabled={isSavingDredger}
                className={`rounded-xl bg-blue-600 px-4 py-2.5 text-white hover:bg-blue-700 ${isSavingDredger ? "cursor-not-allowed opacity-60" : ""}`}
              >
                {isSavingDredger ? "Saving..." : editingItem ? "Update" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTransporterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-xl font-bold">{editingItem ? "Edit" : "Add"} Transporter</h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Code</label>
                <input
                  type="text"
                  value={transporterForm.code || ""}
                  onChange={(e) => setTransporterForm((prev) => ({ ...prev, code: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  placeholder="TR-001"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
                <input
                  type="text"
                  value={transporterForm.name || ""}
                  onChange={(e) => setTransporterForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  placeholder="Transporter Name"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Rate per CBM (₦)</label>
                <input
                  type="number"
                  step="0.01"
                  value={transporterForm.ratePerCbm ?? ""}
                  onChange={(e) =>
                    setTransporterForm((prev) => ({
                      ...prev,
                      ratePerCbm: e.target.value ? parseFloat(e.target.value) : undefined,
                    }))
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Contractor</label>
                <input
                  type="text"
                  value={transporterForm.contractor || ""}
                  onChange={(e) => setTransporterForm((prev) => ({ ...prev, contractor: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  placeholder="Contractor Name"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Contract Number</label>
                <input
                  type="text"
                  value={transporterForm.contractNumber || ""}
                  onChange={(e) => setTransporterForm((prev) => ({ ...prev, contractNumber: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  placeholder="CNT-2026-002"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
                <select
                  value={transporterForm.status || "active"}
                  onChange={(e) => setTransporterForm((prev) => ({ ...prev, status: e.target.value as EntityStatus }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowTransporterModal(false);
                  setEditingItem(null);
                  setTransporterForm({});
                }}
                className="rounded-xl border border-slate-300 px-4 py-2.5 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveTransporter()}
                disabled={isSavingTransporter}
                className={`rounded-xl bg-blue-600 px-4 py-2.5 text-white hover:bg-blue-700 ${isSavingTransporter ? "cursor-not-allowed opacity-60" : ""}`}
              >
                {isSavingTransporter ? "Saving..." : editingItem ? "Update" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTripModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-xl font-bold">{editingItem ? "Edit" : "Add"} Trip Report</h3>
              {editingItem && (editingItem as Trip).rowNumber && (
                <div className="text-right">
                  <div className="text-[10px] font-mono text-slate-400">Ref: {(editingItem as Trip).reference}</div>
                  <div className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-mono text-slate-600">
                    Sheet Row: {(editingItem as Trip).rowNumber}
                  </div>
                </div>
              )}
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto pr-1">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Date</label>
                <input
                  type="date"
                  value={tripForm.date || ""}
                  onChange={(e) => setTripForm((prev) => ({ ...prev, date: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Dredger</label>
                  <select
                    value={tripForm.dredgerId || ""}
                    onChange={(e) => setTripForm((prev) => ({ ...prev, dredgerId: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  >
                    <option value="">Select Dredger</option>
                    {dredgers
                      .filter((dredger) => dredger.status === "active")
                      .map((dredger) => (
                        <option key={dredger.id} value={dredger.id}>
                          {dredger.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Transporter</label>
                  <select
                    value={tripForm.transporterId || ""}
                    onChange={(e) => setTripForm((prev) => ({ ...prev, transporterId: e.target.value, truckId: "" }))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  >
                    <option value="">Select Transporter</option>
                    {transporters
                      .filter((transporter) => transporter.status === "active")
                      .map((transporter) => (
                        <option key={transporter.id} value={transporter.id}>
                          {transporter.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Truck</label>
                <select
                  value={tripForm.truckId || ""}
                  onChange={(e) => {
                    const selectedTruckId = e.target.value;
                    const truck = allTrucks.find((item) => item.id === selectedTruckId);
                    setTripForm((prev) => ({
                      ...prev,
                      truckId: selectedTruckId,
                      capacityCbm: truck?.dredgerBillingCbm || truck?.capacityCbm || 0,
                    }));
                  }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  disabled={!tripForm.transporterId}
                >
                  <option value="">Select Truck</option>
                  {transporters
                    .find((transporter) => transporter.id === tripForm.transporterId)
                    ?.trucks.filter((truck) => truck.status === "active")
                    .map((truck) => (
                      <option key={truck.id} value={truck.id}>
                        {truck.truckName || "Unnamed"} ({truck.plateNumber} — Dredger: {truck.dredgerBillingCbm ?? truck.capacityCbm}CBM)
                      </option>
                    ))}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Actual Loaded per Trip (CBM)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={tripForm.capacityCbm ?? ""}
                    onChange={(e) =>
                      setTripForm((prev) => ({
                        ...prev,
                        capacityCbm: e.target.value ? parseFloat(e.target.value) : undefined,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                    placeholder="Actual loaded volume per trip"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Number of Trips</label>
                  <input
                    type="number"
                    value={tripForm.trips ?? ""}
                    onChange={(e) =>
                      setTripForm((prev) => ({
                        ...prev,
                        trips: e.target.value ? parseInt(e.target.value, 10) : 0,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                    placeholder="0"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Dumping Location</label>
                <input
                  type="text"
                  value={tripForm.dumpingLocation || ""}
                  onChange={(e) => setTripForm((prev) => ({ ...prev, dumpingLocation: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  placeholder="Site A, Location B, etc."
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Notes</label>
                <textarea
                  value={tripForm.notes || ""}
                  onChange={(e) => setTripForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  rows={3}
                  placeholder="Additional notes..."
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowTripModal(false);
                  setEditingItem(null);
                  setTripForm({});
                }}
                className="rounded-xl border border-slate-300 px-4 py-2.5 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveTrip()}
                disabled={isSavingTrip}
                className={`rounded-xl bg-blue-600 px-4 py-2.5 text-white hover:bg-blue-700 ${isSavingTrip ? "cursor-not-allowed opacity-60" : ""}`}
              >
                {isSavingTrip ? "Saving..." : editingItem ? "Update Trip" : "Save Trip"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddTruckModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="mb-4 border-b border-slate-200 pb-3 text-xl font-bold">Add Truck</h3>
            <div className="flex-1 space-y-4 overflow-y-auto pr-1">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Truck Name</label>
                <input
                  type="text"
                  value={truckForm.truckName || ""}
                  onChange={(e) => setTruckForm((prev) => ({ ...prev, truckName: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  placeholder="e.g. TP01"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Plate Number</label>
                <input
                  type="text"
                  value={truckForm.plateNumber || ""}
                  onChange={(e) => setTruckForm((prev) => ({ ...prev, plateNumber: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  placeholder="ABC-123XY"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Transporter Billing CBM</label>
                  <input
                    type="number"
                    step="0.01"
                    value={truckForm.transporterBillingCbm ?? ""}
                    onChange={(e) =>
                      setTruckForm((prev) => ({
                        ...prev,
                        transporterBillingCbm: e.target.value ? parseFloat(e.target.value) : undefined,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                    placeholder="Transporter billing capacity"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Dredger Billing CBM</label>
                  <input
                    type="number"
                    step="0.01"
                    value={truckForm.dredgerBillingCbm ?? ""}
                    onChange={(e) =>
                      setTruckForm((prev) => ({
                        ...prev,
                        dredgerBillingCbm: e.target.value ? parseFloat(e.target.value) : undefined,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                    placeholder="Dredger billing capacity"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
                <select
                  value={truckForm.status || "active"}
                  onChange={(e) => setTruckForm((prev) => ({ ...prev, status: e.target.value as EntityStatus }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowAddTruckModal(false);
                  setTruckForm({ transporterId: "" });
                }}
                className="rounded-xl border border-slate-300 px-4 py-2.5 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleAddTruckSubmit()}
                disabled={isSavingTruck}
                className={`rounded-xl bg-blue-600 px-4 py-2.5 text-white hover:bg-blue-700 ${isSavingTruck ? "cursor-not-allowed opacity-60" : ""}`}
              >
                {isSavingTruck ? "Saving..." : "Save Truck"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-xl font-bold">{editingItem ? "Edit" : "Add"} Payment</h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Date</label>
                <input
                  type="date"
                  value={paymentForm.date || ""}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, date: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Payment Type</label>
                <select
                  value={paymentForm.entityType || "dredger"}
                  onChange={(e) =>
                    setPaymentForm((prev) => ({
                      ...prev,
                      entityType: e.target.value as EntityType,
                      entityId: "",
                    }))
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                >
                  <option value="dredger">Dredger</option>
                  <option value="transporter">Transporter</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Entity</label>
                <select
                  value={paymentForm.entityId || ""}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, entityId: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                >
                  <option value="">Select Entity</option>
                  {(paymentForm.entityType || "dredger") === "dredger"
                    ? dredgers.map((dredger) => (
                        <option key={dredger.code} value={dredger.code}>
                          {dredger.name} ({dredger.code})
                        </option>
                      ))
                    : transporters
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((transporter) => (
                          <option key={transporter.code} value={transporter.code}>
                            {transporter.name} ({transporter.code}
                            {transporter.contractor ? ` - ${transporter.contractor}` : ""})
                          </option>
                        ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Amount (₦)</label>
                <input
                  type="number"
                  step="0.01"
                  value={paymentForm.amount ?? ""}
                  onChange={(e) =>
                    setPaymentForm((prev) => ({
                      ...prev,
                      amount: e.target.value ? parseFloat(e.target.value) : undefined,
                    }))
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Payment Method</label>
                <select
                  value={paymentForm.paymentMethod || "Bank Transfer"}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, paymentMethod: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                >
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Check">Check</option>
                  <option value="Cash">Cash</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Notes</label>
                <textarea
                  value={paymentForm.notes || ""}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
                  rows={3}
                  placeholder="Payment notes..."
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowPaymentModal(false);
                  setEditingItem(null);
                  setPaymentForm({ entityType: "dredger" });
                }}
                className="rounded-xl border border-slate-300 px-4 py-2.5 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void savePayment()}
                disabled={isSavingPayment}
                className={`rounded-xl bg-blue-600 px-4 py-2.5 text-white hover:bg-blue-700 ${isSavingPayment ? "cursor-not-allowed opacity-60" : ""}`}
              >
                {isSavingPayment ? "Saving..." : editingItem ? "Update" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          @page { size: landscape; margin: 10mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-hidden { display: none !important; }
          .page-break-inside-avoid { page-break-inside: avoid; break-inside: avoid; }
        }
      `}</style>
    </div>
  );
};

export default DredgingDashboard;
;
