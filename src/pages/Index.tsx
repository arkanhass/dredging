import React, { useState, useRef, useMemo } from "react";
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
  TrendingUp,
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { toast } from "sonner";

// New hooks
import {
  useDredgers,
  useTransporters,
  useTrips,
  usePayments,
  useSaveEntity,
} from "@/hooks/useDredgingData";

// Recharts for Charts Tab
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";

// Types (kept from your original)
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
  transporterBillingCbm?: number;
  dredgerBillingCbm?: number;
  dumpingLocation: string;
  notes: string;
  reference: string;
  rowNumber?: number;
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

// Date Helpers (kept and cleaned)
const formatDisplayDate = (d: string) => {
  if (!d) return "";
  const iso = d.split("T")[0];
  const [y, m, day] = iso.split("-");
  return `${day}-${m}-${y}`;
};

const toSortableISO = (d: string): string => {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toISOString().split("T")[0];
};

const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

// Colors for Charts
const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

const DredgingDashboard: React.FC = () => {
  // Queries
  const { data: dredgers = [], isLoading: dredgersLoading } = useDredgers();
  const { data: transporters = [], isLoading: transportersLoading } = useTransporters();
  const { data: trips = [], isLoading: tripsLoading, error: tripsError } = useTrips();
  const { data: payments = [], isLoading: paymentsLoading } = usePayments();

  const { mutate: saveEntity, isPending: isSaving } = useSaveEntity();

  // UI State
  const [activeTab, setActiveTab] = useState<"dashboard" | "dredgers" | "transporters" | "trips" | "payments" | "reports" | "transporterReport" | "charts">("dashboard");

  // Global Filter
  const [globalDateFilter, setGlobalDateFilter] = useState({ start: "", end: "" });

  // Form & Modal States
  const [showDredgerModal, setShowDredgerModal] = useState(false);
  const [showTransporterModal, setShowTransporterModal] = useState(false);
  const [showTripModal, setShowTripModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showAddTruckModal, setShowAddTruckModal] = useState(false);

  const [editingItem, setEditingItem] = useState<any>(null);
  const [dredgerForm, setDredgerForm] = useState<Partial<Dredger>>({});
  const [transporterForm, setTransporterForm] = useState<Partial<Transporter>>({});
  const [tripForm, setTripForm] = useState<Partial<Trip>>({});
  const [paymentForm, setPaymentForm] = useState<Partial<Payment>>({ entityType: "dredger" });
  const [truckForm, setTruckForm] = useState<any>({ transporterId: "" });

  // Search
  const [searchTerm, setSearchTerm] = useState("");

  // Refs for PDF
  const reportOverallRef = useRef<HTMLDivElement>(null);
  const reportTransporterReportRef = useRef<HTMLDivElement>(null);

  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // Filtered Data using Global Filter
  const filteredTrips = useMemo(() => {
  const tripsArray = trips ?? []; // fallback
  return tripsArray.filter((t) => {
    const iso = toSortableISO(t.date ?? ''); // safe
    const inRange =
      (!globalDateFilter.start || iso >= globalDateFilter.start) &&
      (!globalDateFilter.end || iso <= globalDateFilter.end);
    const matchesSearch = !searchTerm ||
      (t.plateNumber ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.dumpingLocation ?? '').toLowerCase().includes(searchTerm.toLowerCase());
    return inRange && matchesSearch;
  });
}, [trips, globalDateFilter, searchTerm]);

  // Dashboard Stats (using global filter)
  const dashboardStats = useMemo(() => ({
    totalVolume: filteredTrips.reduce((sum, t) => sum + (t.totalVolume ?? 0), 0),
    totalTrips: filteredTrips.reduce((sum, t) => sum + (t.trips ?? 0), 0),
    totalDredgerCost: filteredTrips.reduce((sum, t) => sum + (t.dredgerAmount ?? 0), 0),
    totalTransporterCost: filteredTrips.reduce((sum, t) => sum + (t.transporterAmount ?? 0), 0),
    totalPaid: payments.reduce((sum, p) => sum + p.amount, 0),
  }), [filteredTrips, payments]);

  // Charts Data
  const monthlyVolumeData = useMemo(() => {
  const map = new Map<string, number>();
  (filteredTrips ?? []).forEach((t) => {
    const dateStr = t.date ?? '';  // fallback if undefined
    const month = dateStr.substring(0, 7) || 'Unknown';
    map.set(month, (map.get(month) || 0) + (t.totalVolume ?? 0));
  });
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, volume]) => ({ month, volume: Math.round(volume) }));
}, [filteredTrips]);

  const topTransportersData = useMemo(() => {
  const map = new Map<string, number>();
  (filteredTrips ?? []).forEach((t) => {
    const name = transporters.find(tr => tr.id === t.transporterId)?.name || "Unknown";
    map.set(name, (map.get(name) || 0) + (t.totalVolume ?? 0));
  });
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, volume]) => ({ name, volume: Math.round(volume) }));
}, [filteredTrips, transporters]);

  // ────────────────────────────────────────────────
  // CRUD Handlers (using new mutation)
  // ────────────────────────────────────────────────
  const handleSave = (action: string, data: any, successMessage: string) => {
    saveEntity({ action, data }, {
      onSuccess: () => {
        toast.success(successMessage);
        // Close modals
        setShowDredgerModal(false);
        setShowTransporterModal(false);
        setShowTripModal(false);
        setShowPaymentModal(false);
        setShowAddTruckModal(false);
        setEditingItem(null);
      },
      onError: () => toast.error("Operation failed"),
    });
  };

  // Keep your existing modals and forms, just update the onClick handlers to use handleSave

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-900 to-indigo-900 text-white shadow-xl">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Ship className="w-10 h-10" />
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Dredging Operations</h1>
              <p className="text-blue-200 text-sm">Sand Dredging & Haulage Management</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-sm">
              <div className="font-medium">Live Dashboard</div>
              <div className="text-blue-300 text-xs">Updated in real-time</div>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="bg-white border-b shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex overflow-x-auto gap-1 py-3">
            {[
              { id: "dashboard", label: "Dashboard", icon: BarChart3 },
              { id: "dredgers", label: "Dredgers", icon: Ship },
              { id: "transporters", label: "Transporters", icon: Truck },
              { id: "trips", label: "Trips", icon: Calendar },
              { id: "payments", label: "Payments", icon: Activity },
              { id: "charts", label: "Charts", icon: TrendingUp },
              { id: "transporterReport", label: "Transporter Report", icon: Truck },
              { id: "reports", label: "Full Reports", icon: FileSpreadsheet },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? "bg-blue-600 text-white shadow-md"
                    : "hover:bg-gray-100 text-gray-700"
                }`}
              >
                <tab.icon className="w-5 h-5" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Global Filter Bar */}
      <div className="bg-white border-b shadow-sm sticky top-[73px] z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center gap-4">
          <span className="font-medium text-gray-700">Filter Period:</span>
          <input
            type="date"
            value={globalDateFilter.start}
            onChange={(e) => setGlobalDateFilter({ ...globalDateFilter, start: e.target.value })}
            className="border rounded-lg px-4 py-2"
          />
          <span className="text-gray-400">-</span>
          <input
            type="date"
            value={globalDateFilter.end}
            onChange={(e) => setGlobalDateFilter({ ...globalDateFilter, end: e.target.value })}
            className="border rounded-lg px-4 py-2"
          />
          <button
            onClick={() => setGlobalDateFilter({ start: "", end: "" })}
            className="text-red-600 hover:text-red-700 text-sm font-medium"
          >
            Clear Filter
          </button>
          <input
            type="text"
            placeholder="Search plate, transporter, or location..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 min-w-[260px] border rounded-lg px-4 py-2"
          />
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Dashboard Tab */}
        {activeTab === "dashboard" && (
          <div className="space-y-8">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
              <div className="bg-white rounded-2xl shadow p-6">
                <p className="text-gray-500 text-sm">Total Volume</p>
                <p className="text-4xl font-bold text-blue-600 mt-2">{dashboardStats.totalVolume.toLocaleString()} CBM</p>
              </div>
              <div className="bg-white rounded-2xl shadow p-6">
                <p className="text-gray-500 text-sm">Total Trips</p>
                <p className="text-4xl font-bold text-green-600 mt-2">{dashboardStats.totalTrips}</p>
              </div>
              <div className="bg-white rounded-2xl shadow p-6">
                <p className="text-gray-500 text-sm">Dredger Cost</p>
                <p className="text-4xl font-bold text-orange-600 mt-2">{formatCurrency(dashboardStats.totalDredgerCost)}</p>
              </div>
              <div className="bg-white rounded-2xl shadow p-6">
                <p className="text-gray-500 text-sm">Transport Cost</p>
                <p className="text-4xl font-bold text-purple-600 mt-2">{formatCurrency(dashboardStats.totalTransporterCost)}</p>
              </div>
              <div className="bg-white rounded-2xl shadow p-6">
                <p className="text-gray-500 text-sm">Total Paid</p>
                <p className="text-4xl font-bold text-emerald-600 mt-2">{formatCurrency(dashboardStats.totalPaid)}</p>
              </div>
            </div>
          </div>
        )}

        {/* Charts Tab - NEW */}
        {activeTab === "charts" && (
          <div className="space-y-8">
            <h2 className="text-3xl font-bold text-gray-800">Analytics & Charts</h2>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Monthly Volume Trend */}
              <div className="bg-white rounded-2xl shadow p-6">
                <h3 className="font-semibold mb-4">Monthly Volume Trend</h3>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={monthlyVolumeData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="volume" stroke="#3b82f6" strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Top Transporters */}
              <div className="bg-white rounded-2xl shadow p-6">
                <h3 className="font-semibold mb-4">Top 5 Transporters by Volume</h3>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={topTransportersData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="volume" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* Keep your other tabs (Dredgers, Transporters, Trips, etc.) */}
        {/* ... (you can keep the rest of your tabs as they are, just replace setState with the new handlers) */}

      </main>

      {/* Floating Action Button */}
      <button
        onClick={() => setShowTripModal(true)}
        className="fixed bottom-8 right-8 bg-blue-600 text-white w-14 h-14 rounded-full shadow-2xl flex items-center justify-center hover:bg-blue-700 transition-all z-50"
      >
        <Plus className="w-7 h-7" />
      </button>
    </div>
  );
};

export default DredgingDashboard;