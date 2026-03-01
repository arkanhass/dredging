import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, Edit, Trash2, Download, Upload, FileSpreadsheet,
  Ship, Truck, DollarSign, Calendar, BarChart3, Activity
} from 'lucide-react';
import * as XLSX from 'xlsx';

// Types
interface Dredger {
  id: string;
  name: string;
  code: string;
  ratePerCbm: number;
  status: 'active' | 'inactive';
  contractor: string;
  contractNumber: string;
}

interface TruckRecord {
  id: string;
  plateNumber: string;
  capacityCbm: number;
  transporterId: string;
  status: 'active' | 'inactive';
  truckName?: string;
}

interface Transporter {
  id: string;
  name: string;
  code: string;
  ratePerCbm: number;
  status: 'active' | 'inactive';
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
  dumpingLocation: string;
  notes: string;
}

interface Payment {
  id: string;
  date: string;
  entityType: 'dredger' | 'transporter';
  entityId: string;
  amount: number;
  paymentMethod: string;
  reference: string;
  notes: string;
}

// Google Sheets Configuration
const GOOGLE_SHEETS_CONFIG = {
  apiKey: 'AIzaSyAYwHOV-1YIa1lAheSZ-fTlh-_UWnWWpgk',
  spreadsheetId: '1RNPjQ-JxUJiF85pBb-0sqbdkWwmGV1Q23cT5qgFFauM',
};

// Date helpers
const formatDisplayDate = (isoOrRaw: string): string => {
  if (!isoOrRaw) return '';

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrRaw)) {
    const [y, m, d] = isoOrRaw.split('-');
    return `${d}-${m}-${y}`;
  }

  // DD/MM/YYYY or D/M/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(isoOrRaw)) {
    const [d, m, y] = isoOrRaw.split('/');
    return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y}`;
  }

  // DD-MM-YYYY or D-M-YYYY
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(isoOrRaw)) {
    const [d, m, y] = isoOrRaw.split('-');
    return `${d.padStart(2, '0')}-${m.padStart(2, '0')}-${y}`;
  }

  // Fallback: try native Date
  const dt = new Date(isoOrRaw);
  if (!isNaN(dt.getTime())) {
    const d = String(dt.getDate()).padStart(2, '0');
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const y = dt.getFullYear();
    return `${d}-${m}-${y}`;
  }

  return isoOrRaw;
};

const toSortableISO = (d: string): string => {
  if (!d) return '';

  // Already ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;

  // DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(d)) {
    const [day, month, year] = d.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // DD-MM-YYYY
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(d)) {
    const [day, month, year] = d.split('-');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const dt = new Date(d);
  if (!isNaN(dt.getTime())) {
    const day = String(dt.getDate()).padStart(2, '0');
    const month = String(dt.getMonth() + 1).pad(2, '0');
    const year = dt.getFullYear();
    return `${year}-${month}-${day}`;
  }

  return d;
};

const DredgingDashboard: React.FC = () => {
  // State
  const [activeTab, setActiveTab] = useState<'dashboard' | 'dredgers' | 'transporters' | 'trips' | 'payments' | 'reports'>('dashboard');
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
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  
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
      const drRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Dredgers?key=${GOOGLE_SHEETS_CONFIG.apiKey}`);
      const drData = await drRes.json();
      const loadedDredgers = (drData.values || []).slice(1).map((row: any[], i: number) => ({
        id: (row[0] || i).toString(), code: row[0], name: row[1], ratePerCbm: parseFloat(row[2]) || 0,
        status: (row[3] || 'active').toLowerCase() as any, contractor: row[4], contractNumber: row[5]
      })).filter((d: any) => d.code);
      setDredgers(loadedDredgers);
  
      // 2. Load Transporters & Trucks
      const trRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Transporters?key=${GOOGLE_SHEETS_CONFIG.apiKey}`);
      const trData = await trRes.json();
      const trRows = trData.values || [];
      const transporterMap = new Map<string, any>();
  
      trRows.slice(1).forEach((row: any[]) => {
        const code = row[0];
        if (!code) return;
  
        if (!transporterMap.has(code)) {
          transporterMap.set(code, {
            id: code, code, name: row[1], ratePerCbm: parseFloat(row[2]) || 0,
            status: (row[3] || 'active').toLowerCase(), contractor: row[4], contractNumber: row[5],
            trucks: []
          });
        }
  
        const truckName = row[6] || 'Unnamed';
        const plateNumber = row[7];
        const capacity = parseFloat(row[8]);
  
        if (plateNumber) {
          const transporter = transporterMap.get(code);
          if (!transporter.trucks.find((t: any) => t.plateNumber === plateNumber)) {
            transporter.trucks.push({
              id: `${code}-${plateNumber}`,
              truckName: truckName,
              plateNumber: plateNumber,
              capacityCbm: isNaN(capacity) ? 0 : capacity,
            });
          }
        }
      });
      setTransporters(Array.from(transporterMap.values()));
  
      // 3. Load Trips
      const tripRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Trips?key=${GOOGLE_SHEETS_CONFIG.apiKey}`);
      const tripData = await tripRes.json();
      
      setTrips((tripData.values || []).slice(1).map((row: any[], i: number) => {
        const rawDate = row[0] || '';
        const dredgerCode = row[1];
        const transporterCode = row[2];
        const plateNumber = row[3];

        const transporter = transporterMap.get(transporterCode);
        const truck = transporter?.trucks.find((t: any) => t.plateNumber === plateNumber);
        const capacityCbm = truck?.capacityCbm || 0;
        const tripsCount = parseInt(row[4]) || 0;

        return {
          id: `trip-${i}`, 
          date: rawDate, 
          dredgerId: loadedDredgers.find((d: Dredger) => d.code === dredgerCode)?.id || '',
          transporterId: transporterCode, 
          truckId: truck?.id || '',
          plateNumber: plateNumber, 
          trips: tripsCount,
          capacityCbm: capacityCbm,
          totalVolume: tripsCount * capacityCbm,
          dredgerRate: parseFloat(row[5]) || 0, 
          transporterRate: parseFloat(row[6]) || 0, 
          dumpingLocation: row[7],
          notes: row[8] || ''
        } as Trip;
      }));
  
      // 4. Load Payments
      const payRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Payments?key=${GOOGLE_SHEETS_CONFIG.apiKey}`);
      const payData = await payRes.json();
      setPayments((payData.values || []).slice(1).map((row: any[], i: number) => ({
        id: `pay-${i}`, date: row[0], entityType: (row[1] || 'dredger').toLowerCase() as any,
        entityId: row[2], amount: parseFloat(row[3]) || 0, paymentMethod: row[4] || 'Bank Transfer', reference: row[5], notes: row[6] || ''
      })));
  
    } catch (err) { console.error(err); }
  };

  // Calculations
  const calculateDredgerEarnings = (dredgerId: string) => {
    const dredgerTrips = trips.filter(t => t.dredgerId === dredgerId);
    const totalVolume = dredgerTrips.reduce((sum, t) => sum + t.totalVolume, 0);
    const totalAmount = dredgerTrips.reduce((sum, t) => sum + (t.totalVolume * (t.dredgerRate || 0)), 0);
    const totalPaid = payments.filter(p => p.entityType === 'dredger' && p.entityId === dredgerId).reduce((sum, p) => sum + p.amount, 0);
    return { totalVolume, totalAmount, totalPaid, balance: totalAmount - totalPaid };
  };

  const calculateTransporterEarnings = (transporterId: string) => {
    const transporterTrips = trips.filter(t => t.transporterId === transporterId);
    const totalTrips = transporterTrips.reduce((sum, t) => sum + t.trips, 0);
    const totalVolume = transporterTrips.reduce((sum, t) => sum + t.totalVolume, 0);
    const totalAmount = transporterTrips.reduce((sum, t) => sum + (t.totalVolume * (t.transporterRate || 0)), 0);
    const totalPaid = payments.filter(p => p.entityType === 'transporter' && p.entityId === transporterId).reduce((sum, p) => sum + p.amount, 0);
    return { totalTrips, totalVolume, totalAmount, totalPaid, balance: totalAmount - totalPaid };
  };

  const overallStats = {
    totalVolume: trips.reduce((sum, t) => sum + t.totalVolume, 0),
    totalTrips: trips.reduce((sum, t) => sum + t.trips, 0),
    totalDredgerCost: trips.reduce((sum, t) => sum + (t.totalVolume * (t.dredgerRate || 0)), 0),
    totalTransporterCost: trips.reduce((sum, t) => sum + (t.totalVolume * (t.transporterRate || 0)), 0),
    totalPaid: payments.reduce((sum, p) => sum + p.amount, 0),
  };

  // Google Apps Script URL
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwTimTnSOaCkAmPxNAAi3Yio12mr5pxYTywcQfx3lhDkZMzCuKm6omq2g_KxtOdYBws7w/exec';

  // submitToAppsScript (same as you had)
  const submitToAppsScript = async (action: string, data: any, onSuccess: () => void, silent = false) => {
    const payload = { action, data };
    
    try {
      await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: JSON.stringify(payload),
      });

      if (!silent) {
        setTimeout(async () => {
          await loadDataFromSheets();
          onSuccess();
          alert('Action completed! Data reloading...');
        }, 2500);
      } else {
        onSuccess();
        setTimeout(() => loadDataFromSheets(), 3000);
      }

    } catch (error) {
      console.warn("Fetch error (likely CORS false positive):", error);
      if (!silent) {
        setTimeout(async () => {
          await loadDataFromSheets();
          onSuccess();
          alert('Action completed! Data reloading... (UI updated)');
        }, 2500);
      } else {
        onSuccess();
        setTimeout(() => loadDataFromSheets(), 3000);
      }
    }
  };

  // CRUD Operations (same as your current code, unchanged except where we computed totals from capacity – already correct)

  const saveDredger = async () => {
    if (editingItem) {
      setDredgers(prev => prev.map(d => d.id === editingItem.id ? { ...d, ...dredgerForm } as Dredger : d));
    } else {
      const newDredger = { ...dredgerForm, id: `temp-${Date.now()}` } as Dredger;
      setDredgers(prev => [...prev, newDredger]);
    }

    const dredgerData = {
      Code: dredgerForm.code,
      Name: dredgerForm.name,
      RatePerCbm: dredgerForm.ratePerCbm,
      Status: dredgerForm.status || 'active',
      Contractor: dredgerForm.contractor || '',
      ContractNumber: dredgerForm.contractNumber || '',
    };

    setShowDredgerModal(false);
    setEditingItem(null);
    setDredgerForm({});

    submitToAppsScript('saveDredger', dredgerData, () => {}, true);
  };

  const saveTransporter = async () => {
    if (editingItem) {
      setTransporters(prev => prev.map(t => t.id === editingItem.id ? { ...t, ...transporterForm } as Transporter : t));
    } else {
      const newTransporter = { ...transporterForm, id: `temp-${Date.now()}`, trucks: [] } as Transporter;
      setTransporters(prev => [...prev, newTransporter]);
    }

    const transporterData = {
      Code: transporterForm.code,
      Name: transporterForm.name,
      RatePerCbm: transporterForm.ratePerCbm,
      Status: transporterForm.status || 'active',
      Contractor: transporterForm.contractor || '',
      ContractNumber: transporterForm.contractNumber || '',
      PlateNumber: '', 
      CapacityCbm: 0,
    };

    setShowTransporterModal(false);
    setEditingItem(null);
    setTransporterForm({});

    submitToAppsScript('saveTransporter', transporterData, () => {}, true);
  };

  const saveTrip = async () => {
    const allTrucks = transporters.flatMap(t => t.trucks);
    const truck = allTrucks.find(tr => tr.id === tripForm.truckId);
    const dredger = dredgers.find(d => d.id === tripForm.dredgerId);
    const transporter = transporters.find(t => t.id === tripForm.transporterId);
    
    const tripsCount = tripForm.trips || 0;
    const capacity = truck?.capacityCbm || 0;

    const newTrip: Trip = {
      id: editingItem ? editingItem.id : `temp-${Date.now()}`,
      date: tripForm.date || '',
      dredgerId: tripForm.dredgerId || '',
      transporterId: tripForm.transporterId || '',
      truckId: tripForm.truckId || '',
      plateNumber: truck?.plateNumber || '',
      trips: tripsCount,
      capacityCbm: capacity,
      totalVolume: tripsCount * capacity,
      dredgerRate: dredger?.ratePerCbm || 0,
      transporterRate: transporter?.ratePerCbm || 0,
      dumpingLocation: tripForm.dumpingLocation || '',
      notes: tripForm.notes || ''
    };

    if (editingItem) {
      setTrips(prev => prev.map(t => t.id === editingItem.id ? newTrip : t));
    } else {
      setTrips(prev => [...prev, newTrip]);
    }

    const tripData = {
      Date: tripForm.date,
      DredgerCode: dredger?.code || '',
      TransporterCode: transporter?.code || '',
      PlateNumber: truck?.plateNumber || '',
      Trips: tripsCount,
      DredgerRate: dredger?.ratePerCbm || 0,
      TransporterRate: transporter?.ratePerCbm || 0,
      DumpingLocation: tripForm.dumpingLocation || '',
      Notes: tripForm.notes || '',
      DredgerAmount: tripsCount * capacity * (dredger?.ratePerCbm || 0),
      TransporterAmount: tripsCount * capacity * (transporter?.ratePerCbm || 0),
    };

    setShowTripModal(false);
    setEditingItem(null);
    setTripForm({});

    submitToAppsScript('saveTrip', tripData, () => {}, true);
  };

  const savePayment = async () => {
    const entity = paymentForm.entityType === 'dredger' 
      ? dredgers.find(d => d.id === paymentForm.entityId)
      : transporters.find(t => t.id === paymentForm.entityId);
    
    const newPayment: Payment = {
      id: editingItem ? editingItem.id : `temp-${Date.now()}`,
      date: paymentForm.date || '',
      entityType: paymentForm.entityType || 'dredger',
      entityId: paymentForm.entityId || '',
      amount: paymentForm.amount || 0,
      paymentMethod: paymentForm.paymentMethod || 'Bank Transfer',
      reference: paymentForm.reference || '',
      notes: paymentForm.notes || ''
    };

    if (editingItem) {
      setPayments(prev => prev.map(p => p.id === editingItem.id ? newPayment : p));
    } else {
      setPayments(prev => [...prev, newPayment]);
    }

    const paymentData = {
      Date: paymentForm.date,
      EntityType: paymentForm.entityType,
      EntityCode: entity?.code || '',
      Amount: paymentForm.amount,
      PaymentMethod: paymentForm.paymentMethod || 'Bank Transfer',
      Reference: paymentForm.reference || `PAY-${Date.now()}`,
      Notes: paymentForm.notes || '',
    };

    setShowPaymentModal(false);
    setEditingItem(null);
    setPaymentForm({});

    submitToAppsScript('savePayment', paymentData, () => {}, true);
  };

  const deleteItem = async (type: 'dredger' | 'transporter' | 'trip' | 'payment', id: string) => {
    if (!confirm('Are you sure you want to delete this item? This will delete it from Google Sheets permanently.')) return;
    
    let actionData: any = {};
    let actionName = '';

    if (type === 'dredger') {
      setDredgers(prev => prev.filter(d => d.id !== id));
      actionName = 'deleteDredger';
      actionData = { code: dredgers.find(d => d.id === id)?.code };
    } else if (type === 'transporter') {
      setTransporters(prev => prev.filter(t => t.id !== id));
      actionName = 'deleteTransporter';
      actionData = { code: transporters.find(t => t.id === id)?.code };
    } else if (type === 'trip') {
      const trip = trips.find(t => t.id === id);
      setTrips(prev => prev.filter(t => t.id !== id));
      actionName = 'deleteTrip';
      actionData = { 
        date: trip?.date,
        dredgerCode: dredgers.find(d => d.id === trip?.dredgerId)?.code
      };
    } else if (type === 'payment') {
      const payment = payments.find(p => p.id === id);
      setPayments(prev => prev.filter(p => p.id !== id));
      actionName = 'deletePayment';
      actionData = { 
        date: payment?.date,
        reference: payment?.reference
      };
    }

    submitToAppsScript(actionName, actionData, () => {}, true);
  };

  const addTruck = async (transporterId: string) => {
    const transporter = transporters.find(t => t.id === transporterId);
    if (!transporter) return;
    
    const truckName = prompt('Enter truck name (e.g., TP01, WHITE TRUCK):');
    if (!truckName) return;
    const plateNumber = prompt('Enter truck plate number:');
    if (!plateNumber) return;
    const capacityStr = prompt('Enter truck capacity (CBM):');
    if (!capacityStr) return;
    const capacity = parseFloat(capacityStr);
    
    const newTruck: TruckRecord = {
      id: `temp-${Date.now()}`,
      truckName,
      plateNumber,
      capacityCbm: capacity,
      transporterId: transporter.id,
      status: 'active'
    };

    setTransporters(prev => prev.map(t => {
      if (t.id === transporterId) {
        return { ...t, trucks: [...t.trucks, newTruck] };
      }
      return t;
    }));

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

    submitToAppsScript('saveTransporter', truckData, () => {}, true);
  };

  const deleteTruck = async (transporterId: string, truckId: string) => {
    if (!confirm('Are you sure you want to delete this truck? This will delete it from Google Sheets.')) return;

    const transporter = transporters.find(t => t.id === transporterId);
    const truck = transporter?.trucks.find(tr => tr.id === truckId);

    if (!transporter || !truck) return;

    setTransporters(prev => prev.map(t => {
      if (t.id === transporterId) {
        return { ...t, trucks: t.trucks.filter(tr => tr.id !== truckId) };
      }
      return t;
    }));

    const actionData = {
      Code: transporter.code,
      PlateNumber: truck.plateNumber
    };

    submitToAppsScript('deleteTruck', actionData, () => {}, true);
  };

  // downloadTemplate and handleFileImport remain as in your current file (already pasted above) – no change needed for date formatting itself

  // Filter + sort trips
  const filteredTrips = trips
    .filter(t => {
      const lowerSearch = searchTerm.toLowerCase();
      const transporterName =
        transporters.find(tr => tr.id === t.transporterId)?.name.toLowerCase() || '';

      const haystack =
        t.plateNumber.toLowerCase() +
        ' ' +
        transporterName +
        ' ' +
        t.dumpingLocation.toLowerCase();

      const matchSearch = !lowerSearch || haystack.includes(lowerSearch);

      const isoDate = toSortableISO(t.date);
      const afterStart =
        !dateFilter.start || isoDate >= toSortableISO(dateFilter.start);
      const beforeEnd =
        !dateFilter.end || isoDate <= toSortableISO(dateFilter.end);

      return matchSearch && afterStart && beforeEnd;
    })
    .sort((a, b) => {
      const aIso = toSortableISO(a.date);
      const bIso = toSortableISO(b.date);
      return bIso.localeCompare(aIso); // newest first
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
                <p className="text-blue-200 text-sm">Sand Dredging & Haulage Management System</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={loadDataFromSheets}
                className="px-3 py-2 bg-blue-800 hover:bg-blue-700 rounded text-sm flex items-center space-x-1"
              >
                <Upload className="w-4 h-4" />
                <span>Sync Data</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex space-x-1 overflow-x-auto">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
              { id: 'dredgers', label: 'Dredgers', icon: Ship },
              { id: 'transporters', label: 'Transporters', icon: Truck },
              { id: 'trips', label: 'Daily Trips', icon: Calendar },
              { id: 'payments', label: '₦ Payments', icon: Activity },
              { id: 'reports', label: 'Reports', icon: FileSpreadsheet },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-3 flex items-center space-x-2 border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
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
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Stats Cards */}
            {/* ... keep your stats cards exactly as you pasted (omitted for brevity) */}

            {/* Recent Trips */}
            <div className="bg-white rounded-lg shadow">
              <div className="p-4 border-b flex justify-between items-center">
                <h3 className="font-bold text-lg">Recent Trips</h3>
                <button onClick={() => setActiveTab('trips')} className="text-blue-600 hover:underline text-sm">View All</button>
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
                    {trips.slice(-10).reverse().map(trip => {
                      const dredger = dredgers.find(d => d.id === trip.dredgerId);
                      const transporter = transporters.find(t => t.id === trip.transporterId);
                      return (
                        <tr key={trip.id} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-3">{formatDisplayDate(trip.date)}</td>
                          <td className="px-4 py-3">{dredger?.name}</td>
                          <td className="px-4 py-3">{transporter?.name}</td>
                          <td className="px-4 py-3 font-mono text-sm">{trip.plateNumber}</td>
                          <td className="px-4 py-3 text-right">{trip.trips}</td>
                          <td className="px-4 py-3 text-right">
                            {trip.totalVolume != null ? `${trip.totalVolume.toFixed(2)} CBM` : ''}
                          </td>
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

        {/* Dredgers Tab, Transporters Tab, Payments Tab, Reports Tab, Modals */}
        {/* Use exactly the markup you already have for these sections, since they were working.
            The only changes affecting display we needed are in:
            - Recent Trips (above),
            - filteredTrips,
            - Daily Trips table (below). */}

        {/* Trips Tab */}
        {activeTab === 'trips' && (
          <div className="space-y-4">
            {/* header + buttons section: keep exactly as in your code */}

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
                  {filteredTrips.map(trip => {
                    const dredger = dredgers.find(d => d.id === trip.dredgerId);
                    const transporter = transporters.find(t => t.id === trip.transporterId);
                    const truck = transporter?.trucks.find(tr => tr.id === trip.truckId || tr.plateNumber === trip.plateNumber);

                    const truckDisplay = truck
                      ? `(${truck.plateNumber}${truck.truckName ? ' - ' + truck.truckName : ''})`
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
                        <td className="px-4 py-3 text-right">
                          {capacityCbm ? `${capacityCbm.toFixed(2)} CBM` : ''}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {totalVolume ? `${totalVolume.toFixed(2)} CBM` : ''}
                        </td>
                        <td className="px-4 py-3">{trip.dumpingLocation}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end space-x-2">
                            <button
                              onClick={() => { setEditingItem(trip); setTripForm(trip); setShowTripModal(true); }}
                              className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deleteItem('trip', trip.id)}
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

        {/* Payments Tab, Reports Tab, all modals – keep from your working version */}
      </main>
    </div>
  );
};

export default DredgingDashboard;