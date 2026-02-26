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

interface Truck {
  id: string;
  plateNumber: string;
  capacityCbm: number;
  transporterId: string;
  status: 'active' | 'inactive';
}

interface Transporter {
  id: string;
  name: string;
  code: string;
  ratePerCbm: number;
  status: 'active' | 'inactive';
  contractor: string;
  contractNumber: string;
  trucks: Truck[];
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
      
      // Load Dredgers
      const dredgersResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Dredgers?key=${GOOGLE_SHEETS_CONFIG.apiKey}`
      );
      const dredgersData = await dredgersResponse.json();
      const dredgersRows = dredgersData.values || [];
      const loadedDredgers: Dredger[] = dredgersRows.slice(1).map((row: any[], index: number) => ({
        id: (row[0] || index).toString(),
        code: row[0] || `DR-${index}`,
        name: row[1] || 'Unknown',
        ratePerCbm: parseFloat(row[2]) || 0,
        status: (row[3] || 'active').toLowerCase() as 'active' | 'inactive',
        contractor: row[4] || '',
        contractNumber: row[5] || '',
      })).filter((d: Dredger) => d.code);
      setDredgers(loadedDredgers);

      // Load Transporters
      const transportersResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Transporters?key=${GOOGLE_SHEETS_CONFIG.apiKey}`
      );
      const transportersData = await transportersResponse.json();
      const transportersRows = transportersData.values || [];
      
      // Group by transporter code
      const transporterMap = new Map<string, Transporter>();
      transportersRows.slice(1).forEach((row: any[], index: number) => {
        const code = row[0] || `TR-${index}`;
        if (!transporterMap.has(code)) {
          transporterMap.set(code, {
            id: code,
            code,
            name: row[1] || 'Unknown',
            ratePerCbm: parseFloat(row[2]) || 0,
            status: (row[3] || 'active').toLowerCase() as 'active' | 'inactive',
            contractor: row[4] || '',
            contractNumber: row[5] || '',
            trucks: [],
          });
        }
        // Add truck if plate number exists
        if (row[6]) {
          const transporter = transporterMap.get(code)!;
          transporter.trucks.push({
            id: `${code}-${row[6]}`,
            plateNumber: row[6],
            capacityCbm: parseFloat(row[7]) || 0,
            transporterId: code,
            status: 'active',
          });
        }
      });
      setTransporters(Array.from(transporterMap.values()));

      // Load Trips
      const tripsResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Trips?key=${GOOGLE_SHEETS_CONFIG.apiKey}`
      );
      const tripsData = await tripsResponse.json();
      const tripsRows = tripsData.values || [];
      const loadedTrips: Trip[] = tripsRows.slice(1).map((row: any[], index: number) => {
        const dredger = loadedDredgers.find(d => d.code === row[1]);
        const transporter = Array.from(transporterMap.values()).find(t => t.code === row[2]);
        const truck = transporter?.trucks.find(tr => tr.plateNumber === row[3]);
        
        return {
          id: `trip-${index}`,
          date: row[0] || new Date().toISOString().split('T')[0],
          dredgerId: dredger?.id || '',
          transporterId: transporter?.id || '',
          truckId: truck?.id || '',
          plateNumber: row[3] || '',
          trips: parseInt(row[4]) || 0,
          capacityCbm: truck?.capacityCbm || parseFloat(row[5]) || 0,
          totalVolume: (parseInt(row[4]) || 0) * (truck?.capacityCbm || parseFloat(row[5]) || 0),
          dredgerRate: parseFloat(row[5]) || dredger?.ratePerCbm || 0,
          transporterRate: parseFloat(row[6]) || transporter?.ratePerCbm || 0,
          dumpingLocation: row[7] || '',
          notes: row[8] || '',
        };
      });
      setTrips(loadedTrips);

      // Load Payments
      const paymentsResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.spreadsheetId}/values/Payments?key=${GOOGLE_SHEETS_CONFIG.apiKey}`
      );
      const paymentsData = await paymentsResponse.json();
      const paymentsRows = paymentsData.values || [];
      const loadedPayments: Payment[] = paymentsRows.slice(1).map((row: any[], index: number) => ({
        id: `pay-${index}`,
        date: row[0] || new Date().toISOString().split('T')[0],
        entityType: (row[1] || 'dredger').toLowerCase() as 'dredger' | 'transporter',
        entityId: row[2] || '',
        amount: parseFloat(row[3]) || 0,
        paymentMethod: row[4] || 'Bank Transfer',
        reference: row[5] || `PAY-${index}`,
        notes: row[6] || '',
      }));
      setPayments(loadedPayments);
      
    } catch (err) {
      alert('Failed to load data from Google Sheets. Please check your API key and sheet permissions.');
      console.error('Error loading data:', err);
    }
  };

  // Calculations - using stored trip rates for historical accuracy
  const calculateDredgerEarnings = (dredgerId: string) => {
    const dredgerTrips = trips.filter(t => t.dredgerId === dredgerId);
    const totalVolume = dredgerTrips.reduce((sum, t) => sum + t.totalVolume, 0);
    // Use stored trip rate for each trip (historical rate preservation)
    const totalAmount = dredgerTrips.reduce((sum, t) => sum + (t.totalVolume * (t.dredgerRate || 0)), 0);
    const totalPaid = payments.filter(p => p.entityType === 'dredger' && p.entityId === dredgerId).reduce((sum, p) => sum + p.amount, 0);
    return { totalVolume, totalAmount, totalPaid, balance: totalAmount - totalPaid };
  };

  const calculateTransporterEarnings = (transporterId: string) => {
    const transporterTrips = trips.filter(t => t.transporterId === transporterId);
    const totalTrips = transporterTrips.reduce((sum, t) => sum + t.trips, 0);
    const totalVolume = transporterTrips.reduce((sum, t) => sum + t.totalVolume, 0);
    // Use stored trip rate for each trip (historical rate preservation)
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

  // CRUD Operations - Now saving to Google Sheets
  const saveDredger = async () => {
    try {
      const dredgerData = {
        Code: dredgerForm.code,
        Name: dredgerForm.name,
        RatePerCbm: dredgerForm.ratePerCbm,
        Status: dredgerForm.status || 'active',
        Contractor: dredgerForm.contractor || '',
        ContractNumber: dredgerForm.contractNumber || '',
      };

      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'saveDredger', data: dredgerData }),
      });
      const result = await response.json();
      
      if (result.success) {
        await loadDataFromSheets(); // Refresh data from sheets
        setShowDredgerModal(false);
        setEditingItem(null);
        setDredgerForm({});
        alert('Dredger saved successfully!');
      } else {
        alert('Error saving dredger: ' + result.error);
      }
    } catch (error) {
      alert('Error saving dredger: ' + error);
    }
  };

  const saveTransporter = async () => {
    try {
      const transporterData = {
        Code: transporterForm.code,
        Name: transporterForm.name,
        RatePerCbm: transporterForm.ratePerCbm,
        Status: transporterForm.status || 'active',
        Contractor: transporterForm.contractor || '',
        ContractNumber: transporterForm.contractNumber || '',
        PlateNumber: '', // Will be added separately for trucks
        CapacityCbm: 0,
      };

      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'saveTransporter', data: transporterData }),
      });
      const result = await response.json();
      
      if (result.success) {
        await loadDataFromSheets(); // Refresh data from sheets
        setShowTransporterModal(false);
        setEditingItem(null);
        setTransporterForm({});
        alert('Transporter saved successfully!');
      } else {
        alert('Error saving transporter: ' + result.error);
      }
    } catch (error) {
      alert('Error saving transporter: ' + error);
    }
  };

  const saveTrip = async () => {
    try {
      const allTrucks = transporters.flatMap(t => t.trucks);
      const truck = allTrucks.find(tr => tr.id === tripForm.truckId);
      const dredger = dredgers.find(d => d.id === tripForm.dredgerId);
      const transporter = transporters.find(t => t.id === tripForm.transporterId);
      
      const tripData = {
        Date: tripForm.date,
        DredgerCode: dredger?.code || '',
        TransporterCode: transporter?.code || '',
        PlateNumber: truck?.plateNumber || '',
        Trips: tripForm.trips || 0,
        DredgerRate: dredger?.ratePerCbm || 0,
        TransporterRate: transporter?.ratePerCbm || 0,
        DumpingLocation: tripForm.dumpingLocation || '',
        Notes: tripForm.notes || '',
        DredgerAmount: (tripForm.trips || 0) * (truck?.capacityCbm || 0) * (dredger?.ratePerCbm || 0),
        TransporterAmount: (tripForm.trips || 0) * (truck?.capacityCbm || 0) * (transporter?.ratePerCbm || 0),
      };

      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'saveTrip', data: tripData }),
      });
      const result = await response.json();
      
      if (result.success) {
        await loadDataFromSheets(); // Refresh data from sheets
        setShowTripModal(false);
        setEditingItem(null);
        setTripForm({});
        alert('Trip saved successfully!');
      } else {
        alert('Error saving trip: ' + result.error);
      }
    } catch (error) {
      alert('Error saving trip: ' + error);
    }
  };

  const savePayment = async () => {
    try {
      const entity = paymentForm.entityType === 'dredger' 
        ? dredgers.find(d => d.id === paymentForm.entityId)
        : transporters.find(t => t.id === paymentForm.entityId);
      
      const paymentData = {
        Date: paymentForm.date,
        EntityType: paymentForm.entityType,
        EntityCode: entity?.code || '',
        Amount: paymentForm.amount,
        PaymentMethod: paymentForm.paymentMethod || 'Bank Transfer',
        Reference: paymentForm.reference || `PAY-${Date.now()}`,
        Notes: paymentForm.notes || '',
      };

      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'savePayment', data: paymentData }),
      });
      const result = await response.json();
      
      if (result.success) {
        await loadDataFromSheets(); // Refresh data from sheets
        setShowPaymentModal(false);
        setEditingItem(null);
        setPaymentForm({});
        alert('Payment saved successfully!');
      } else {
        alert('Error saving payment: ' + result.error);
      }
    } catch (error) {
      alert('Error saving payment: ' + error);
    }
  };

  const deleteItem = async (type: 'dredger' | 'transporter' | 'trip' | 'payment', id: string) => {
    if (!confirm('Are you sure you want to delete this item? This will delete it from Google Sheets permanently.')) return;
    
    try {
      let response;
      let result;
      
      if (type === 'dredger') {
        const dredger = dredgers.find(d => d.id === id);
        response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'deleteDredger', code: dredger?.code }),
        });
        result = await response.json();
        if (result.success) setDredgers(dredgers.filter(d => d.id !== id));
      } else if (type === 'transporter') {
        const transporter = transporters.find(t => t.id === id);
        response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'deleteTransporter', code: transporter?.code }),
        });
        result = await response.json();
        if (result.success) setTransporters(transporters.filter(t => t.id !== id));
      } else if (type === 'trip') {
        const trip = trips.find(t => t.id === id);
        response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify({ 
            action: 'deleteTrip', 
            date: trip?.date,
            dredgerCode: dredgers.find(d => d.id === trip?.dredgerId)?.code
          }),
        });
        result = await response.json();
        if (result.success) setTrips(trips.filter(t => t.id !== id));
      } else if (type === 'payment') {
        const payment = payments.find(p => p.id === id);
        response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify({ 
            action: 'deletePayment', 
            date: payment?.date,
            reference: payment?.reference
          }),
        });
        result = await response.json();
        if (result.success) setPayments(payments.filter(p => p.id !== id));
      }
      
      if (result && !result.success) {
        alert('Error deleting: ' + result.error);
      } else if (result && result.success) {
        alert('Deleted successfully!');
      }
    } catch (error) {
      alert('Error deleting: ' + error);
    }
  };

  const addTruck = async (transporterId: string) => {
    const plateNumber = prompt('Enter truck plate number:');
    const capacityStr = prompt('Enter truck capacity (CBM):');
    if (!plateNumber || !capacityStr) return;
    
    const capacity = parseFloat(capacityStr);
    const transporter = transporters.find(t => t.id === transporterId);
    
    if (!transporter) {
      alert('Transporter not found!');
      return;
    }
    
    try {
      const truckData = {
        Code: transporter.code,
        Name: transporter.name,
        RatePerCbm: transporter.ratePerCbm,
        Status: transporter.status,
        Contractor: transporter.contractor,
        ContractNumber: transporter.contractNumber,
        PlateNumber: plateNumber,
        CapacityCbm: capacity,
      };

      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'saveTransporter', data: truckData }),
      });
      const result = await response.json();
      
      if (result.success) {
        await loadDataFromSheets(); // Refresh data from sheets
        alert('Truck added successfully!');
      } else {
        alert('Error adding truck: ' + result.error);
      }
    } catch (error) {
      alert('Error adding truck: ' + error);
    }
  };

  const deleteTruck = async (transporterId: string, truckId: string) => {
    if (!confirm('Delete this truck? Note: This will remove the truck row from Google Sheets.')) return;
    
    const transporter = transporters.find(t => t.id === transporterId);
    const truck = transporter?.trucks.find(tr => tr.id === truckId);
    
    if (!transporter || !truck) {
      alert('Truck not found!');
      return;
    }
    
    // For trucks, we need to delete the specific row from Transporters sheet
    // This is complex because multiple trucks can have same transporter code
    // For now, we'll just refresh and let user know they need to delete manually in Sheets
    alert('Note: Truck deletion from Google Sheets requires manual action. Please delete the truck row directly in Google Sheets "Transporters" tab, then click "Sync Data" in the dashboard.');
    
    // Still remove from local state
    setTransporters(transporters.map(t => {
      if (t.id === transporterId) {
        return { ...t, trucks: t.trucks.filter(tr => tr.id !== truckId) };
      }
      return t;
    }));
  };

  // Download template
  const downloadTemplate = (type: 'dredgers' | 'transporters' | 'trips' | 'payments') => {
    let csv = '';
    let filename = '';
    
    if (type === 'dredgers') {
      csv = 'Code,Name,RatePerCbm,Status,Contractor,ContractNumber\n';
      csv += 'DR-001,Dredger Alpha,1550,active,Marine Works Ltd,CNT-2024-001\n';
      filename = 'dredgers_template.csv';
    } else if (type === 'transporters') {
      csv = 'Code,Name,RatePerCbm,Status,Contractor,ContractNumber,PlateNumber,CapacityCbm\n';
      csv += 'TR-001,Quick Haul Transport,850,active,Quick Haul Ltd,CNT-2024-101,ABC-123,15\n';
      csv += 'TR-001,Quick Haul Transport,850,active,Quick Haul Ltd,CNT-2024-101,ABC-124,18\n';
      filename = 'transporters_template.csv';
    } else if (type === 'trips') {
      csv = 'Date,DredgerCode,TransporterCode,PlateNumber,Trips,DredgerRate,TransporterRate,DumpingLocation,Notes\n';
      csv += '2024-01-15,DR-001,TR-001,ABC-123,5,1500,850,Site A - North,\n';
      csv += '2024-01-15,DR-001,TR-001,ABC-124,6,1500,850,Site A - South,\n';
      csv += '2024-01-15,DR-002,TR-002,XYZ-456,10,1600,900,Site B - East,\n';
      filename = 'trips_template.csv';
    } else if (type === 'payments') {
      csv = 'Date,EntityType,EntityId,Amount,PaymentMethod,Reference,Notes\n';
      csv += '2024-01-10,dredger,1,5000000,Bank Transfer,PAY-2024-001,Advance payment\n';
      filename = 'payments_template.csv';
    }
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  // Import from Excel
  const handleFileImport = (type: 'dredgers' | 'transporters' | 'trips' | 'payments', file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      const workbook = XLSX.read(data, { type: 'binary' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);
      
      if (type === 'dredgers') {
        const newDredgers: Dredger[] = jsonData.map((row: any, index: number) => ({
          id: Date.now().toString() + index,
          code: row.Code || row.code || `DR-${Date.now()}-${index}`,
          name: row.Name || row.name || 'Unknown',
          ratePerCbm: parseFloat(row.RatePerCbm || row.ratePerCbm || row['Rate/CBM'] || 0),
          status: (row.Status || row.status || 'active').toLowerCase(),
          contractor: row.Contractor || row.contractor || '',
          contractNumber: row.ContractNumber || row.contractNumber || row['Contract Number'] || '',
        }));
        setDredgers([...dredgers, ...newDredgers]);
        alert(`Successfully imported ${newDredgers.length} dredgers!`);
      } else if (type === 'transporters') {
        // Group by transporter code/name
        const transporterMap = new Map<string, Transporter>();
        jsonData.forEach((row: any) => {
          const code = row.Code || row.code || `TR-${Date.now()}`;
          if (!transporterMap.has(code)) {
            transporterMap.set(code, {
              id: Date.now().toString() + Math.random(),
              code,
              name: row.Name || row.name || 'Unknown',
              ratePerCbm: parseFloat(row.RatePerCbm || row.ratePerCbm || row['Rate/CBM'] || 0),
              status: (row.Status || row.status || 'active').toLowerCase(),
              contractor: row.Contractor || row.contractor || '',
              contractNumber: row.ContractNumber || row.contractNumber || row['Contract Number'] || '',
              trucks: [],
            });
          }
          const transporter = transporterMap.get(code)!;
          if (row.PlateNumber || row.plateNumber || row['Plate Number']) {
            transporter.trucks.push({
              id: Date.now().toString() + Math.random(),
              plateNumber: row.PlateNumber || row.plateNumber || row['Plate Number'],
              capacityCbm: parseFloat(row.CapacityCbm || row.capacityCbm || row['Capacity CBM'] || 0),
              transporterId: transporter.id,
              status: 'active',
            });
          }
        });
        const newTransporters = Array.from(transporterMap.values());
        setTransporters([...transporters, ...newTransporters]);
        alert(`Successfully imported ${newTransporters.length} transporters!`);
      } else if (type === 'trips') {
        const allTrucks = transporters.flatMap(t => t.trucks);
        const errors: string[] = [];
        const newTrips: Trip[] = jsonData.map((row: any, index: number) => {
          const dredgerCode = row.DredgerCode || row['Dredger Code'] || row.dredgerCode;
          const transporterCode = row.TransporterCode || row['Transporter Code'] || row.transporterCode;
          const plateNumber = row.PlateNumber || row['Plate Number'] || row.plateNumber;
          
          const dredger = dredgers.find(d => d.code === dredgerCode);
          const transporter = transporters.find(t => t.code === transporterCode);
          const truck = allTrucks.find(t => t.plateNumber === plateNumber);
          
          if (!dredger) errors.push(`Row ${index + 2}: Dredger code "${dredgerCode}" not found`);
          if (!transporter) errors.push(`Row ${index + 2}: Transporter code "${transporterCode}" not found`);
          if (!truck) errors.push(`Row ${index + 2}: Truck plate "${plateNumber}" not found`);
          
          const capacity = truck?.capacityCbm || parseFloat(row.CapacityCbm || row.capacityCbm || 0);
          const tripsCount = parseInt(row.Trips || row.trips || 0);
          const dredgerRate = parseFloat(row.DredgerRate || row['Dredger Rate'] || dredger?.ratePerCbm || 0);
          const transporterRate = parseFloat(row.TransporterRate || row['Transporter Rate'] || transporter?.ratePerCbm || 0);
          
          return {
            id: Date.now().toString() + Math.random(),
            date: row.Date || row.date || new Date().toISOString().split('T')[0],
            dredgerId: dredger?.id || '',
            transporterId: transporter?.id || '',
            truckId: truck?.id || '',
            plateNumber: plateNumber || '',
            trips: tripsCount,
            capacityCbm: capacity,
            totalVolume: tripsCount * capacity,
            dredgerRate: dredgerRate,
            transporterRate: transporterRate,
            dumpingLocation: row.DumpingLocation || row['Dumping Location'] || row.dumpingLocation || '',
            notes: row.Notes || row.notes || '',
          };
        });
        
        const validTrips = newTrips.filter((_, index) => {
          const hasErrors = errors.some(e => e.startsWith(`Row ${index + 2}:`));
          return !hasErrors;
        });
        
        if (errors.length > 0) {
          alert(`Import completed with ${errors.length} errors:\n\n${errors.slice(0, 10).join('\n')}${errors.length > 10 ? '\n...and more' : ''}\n\n${validTrips.length} trips imported successfully.`);
        } else {
          alert(`Successfully imported ${validTrips.length} trips!`);
        }
        
        setTrips([...trips, ...validTrips]);
      } else if (type === 'payments') {
        const newPayments: Payment[] = jsonData.map((row: any) => ({
          id: Date.now().toString() + Math.random(),
          date: row.Date || row.date || new Date().toISOString().split('T')[0],
          entityType: (row.EntityType || row.entityType || 'dredger').toLowerCase(),
          entityId: row.EntityId || row.entityId || row['Entity ID'] || '',
          amount: parseFloat(row.Amount || row.amount || 0),
          paymentMethod: row.PaymentMethod || row['Payment Method'] || row.paymentMethod || 'Bank Transfer',
          reference: row.Reference || row.reference || `PAY-${Date.now()}`,
          notes: row.Notes || row.notes || '',
        }));
        setPayments([...payments, ...newPayments]);
        alert(`Successfully imported ${newPayments.length} payments!`);
      }
    };
    reader.readAsBinaryString(file);
  };

  // Export to Excel (CSV format)
  const exportToExcel = (type: 'trips' | 'dredgers' | 'transporters' | 'payments') => {
    let csv = '';
    let filename = '';
    
    if (type === 'trips') {
      csv = 'Date,Dredger Code,Dredger,Transporter Code,Transporter,Plate Number,Trips,Capacity (CBM),Total Volume (CBM),Dredger Rate,Transporter Rate,Dredger Amount,Transporter Amount,Dumping Location,Notes\n';
      trips.forEach(t => {
        const dredger = dredgers.find(d => d.id === t.dredgerId);
        const transporter = transporters.find(tr => tr.id === t.transporterId);
        const dredgerAmount = t.totalVolume * (t.dredgerRate || 0);
        const transporterAmount = t.totalVolume * (t.transporterRate || 0);
        csv += `${t.date},${dredger?.code || ''},${dredger?.name || ''},${transporter?.code || ''},${transporter?.name || ''},${t.plateNumber},${t.trips},${t.capacityCbm},${t.totalVolume},${t.dredgerRate || 0},${t.transporterRate || 0},${dredgerAmount},${transporterAmount},${t.dumpingLocation},${t.notes}\n`;
      });
      filename = 'trip_report.csv';
    } else if (type === 'dredgers') {
      csv = 'Code,Name,Rate (per CBM),Status,Contractor,Contract Number\n';
      dredgers.forEach(d => {
        csv += `${d.code},${d.name},${d.ratePerCbm},${d.status},${d.contractor},${d.contractNumber}\n`;
      });
      filename = 'dredgers_report.csv';
    } else if (type === 'transporters') {
      csv = 'Code,Name,Rate (per CBM),Status,Contractor,Contract Number,Truck Plate,Capacity (CBM)\n';
      transporters.forEach(t => {
        t.trucks.forEach(truck => {
          csv += `${t.code},${t.name},${t.ratePerCbm},${t.status},${t.contractor},${t.contractNumber},${truck.plateNumber},${truck.capacityCbm}\n`;
        });
      });
      filename = 'transporters_report.csv';
    } else if (type === 'payments') {
      csv = 'Date,Type,Entity,Amount,Payment Method,Reference,Notes\n';
      payments.forEach(p => {
        const entity = p.entityType === 'dredger' ? dredgers.find(d => d.id === p.entityId)?.name : transporters.find(t => t.id === p.entityId)?.name;
        csv += `${p.date},${p.entityType},${entity || ''},${p.amount},${p.paymentMethod},${p.reference},${p.notes}\n`;
      });
      filename = 'payments_report.csv';
    }
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  // Filter trips by date
  const filteredTrips = trips.filter(t => {
    const matchSearch = !searchTerm || 
      t.plateNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.dumpingLocation.toLowerCase().includes(searchTerm.toLowerCase());
    const matchDate = (!dateFilter.start || t.date >= dateFilter.start) && 
                      (!dateFilter.end || t.date <= dateFilter.end);
    return matchSearch && matchDate;
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
                  <div className="bg-red-100 p-3 rounded-full">
                    <DollarSign className="w-6 h-6 text-red-600" />
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Summary Tables */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Dredger Summary */}
              <div className="bg-white rounded-lg shadow">
                <div className="p-4 border-b flex justify-between items-center">
                  <h3 className="font-bold text-lg">Dredger Summary</h3>
                  <button onClick={() => setActiveTab('dredgers')} className="text-blue-600 hover:underline text-sm">View All</button>
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
                      {dredgers.map(dredger => {
                        const earnings = calculateDredgerEarnings(dredger.id);
                        return (
                          <tr key={dredger.id} className="border-t hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <div className="font-medium">{dredger.name}</div>
                              <div className="text-sm text-gray-500">{dredger.code}</div>
                            </td>
                            <td className="px-4 py-3 text-right">{earnings.totalVolume.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">{formatCurrency(earnings.totalAmount)}</td>
                            <td className="px-4 py-3 text-right text-green-600">{formatCurrency(earnings.totalPaid)}</td>
                            <td className={`px-4 py-3 text-right font-medium ${earnings.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {formatCurrency(earnings.balance)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Transporter Summary */}
              <div className="bg-white rounded-lg shadow">
                <div className="p-4 border-b flex justify-between items-center">
                  <h3 className="font-bold text-lg">Transporter Summary</h3>
                  <button onClick={() => setActiveTab('transporters')} className="text-blue-600 hover:underline text-sm">View All</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Transporter</th>
                        <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Trips</th>
                        <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Volume (CBM)</th>
                        <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Amount</th>
                        <th className="px-4 py-2 text-right text-sm font-medium text-gray-600">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transporters.map(transporter => {
                        const earnings = calculateTransporterEarnings(transporter.id);
                        return (
                          <tr key={transporter.id} className="border-t hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <div className="font-medium">{transporter.name}</div>
                              <div className="text-sm text-gray-500">{transporter.code}</div>
                            </td>
                            <td className="px-4 py-3 text-right">{earnings.totalTrips.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">{earnings.totalVolume.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right">{formatCurrency(earnings.totalAmount)}</td>
                            <td className={`px-4 py-3 text-right font-medium ${earnings.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
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
                          <td className="px-4 py-3">{trip.date}</td>
                          <td className="px-4 py-3">{dredger?.name}</td>
                          <td className="px-4 py-3">{transporter?.name}</td>
                          <td className="px-4 py-3 font-mono text-sm">{trip.plateNumber}</td>
                          <td className="px-4 py-3 text-right">{trip.trips}</td>
                          <td className="px-4 py-3 text-right">{trip.totalVolume} CBM</td>
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
        {activeTab === 'dredgers' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <h2 className="text-2xl font-bold">Dredgers Management</h2>
              <div className="flex space-x-2">
                <button
                  onClick={() => downloadTemplate('dredgers')}
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
                    if (file) handleFileImport('dredgers', file);
                    if (dredgerFileInput.current) dredgerFileInput.current.value = '';
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
                  onClick={() => { setEditingItem(null); setDredgerForm({}); setShowDredgerModal(true); }}
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
                  {dredgers.map(dredger => {
                    return (
                      <tr key={dredger.id} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono">{dredger.code}</td>
                        <td className="px-4 py-3 font-medium">{dredger.name}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(dredger.ratePerCbm)}</td>
                        <td className="px-4 py-3">{dredger.contractor}</td>
                        <td className="px-4 py-3 font-mono text-sm">{dredger.contractNumber}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${dredger.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                            {dredger.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end space-x-2">
                            <button
                              onClick={() => { setEditingItem(dredger); setDredgerForm(dredger); setShowDredgerModal(true); }}
                              className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deleteItem('dredger', dredger.id)}
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

            {/* Dredger Earnings Summary */}
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
                    {dredgers.map(dredger => {
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
                          <td className={`px-4 py-3 text-right font-bold ${earnings.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
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
        {activeTab === 'transporters' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <h2 className="text-2xl font-bold">Transporters Management</h2>
              <div className="flex space-x-2">
                <button
                  onClick={() => downloadTemplate('transporters')}
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
                    if (file) handleFileImport('transporters', file);
                    if (transporterFileInput.current) transporterFileInput.current.value = '';
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
                  onClick={() => { setEditingItem(null); setTransporterForm({}); setShowTransporterModal(true); }}
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
                  {transporters.map(transporter => (
                    <tr key={transporter.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono">{transporter.code}</td>
                      <td className="px-4 py-3 font-medium">{transporter.name}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(transporter.ratePerCbm)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {transporter.trucks.map(truck => (
                            <span key={truck.id} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-mono">
                              {truck.plateNumber} ({truck.capacityCbm} CBM)
                              <button
                                onClick={(e) => { e.stopPropagation(); deleteTruck(transporter.id, truck.id); }}
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
                        <span className={`px-2 py-1 rounded text-xs font-medium ${transporter.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                          {transporter.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end space-x-2">
                          <button
                            onClick={() => { setEditingItem(transporter); setTransporterForm(transporter); setShowTransporterModal(true); }}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => deleteItem('transporter', transporter.id)}
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

            {/* Transporter Earnings Summary */}
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
                    {transporters.map(transporter => {
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
                          <td className={`px-4 py-3 text-right font-bold ${earnings.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
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
        {activeTab === 'trips' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center flex-wrap gap-4">
              <h2 className="text-2xl font-bold">Daily Trip Reports</h2>
              <div className="flex space-x-2">
                <input
                  type="text"
                  placeholder="Search plate or location..."
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
                  onClick={() => downloadTemplate('trips')}
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
                    if (file) handleFileImport('trips', file);
                    if (tripsFileInput.current) tripsFileInput.current.value = '';
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
                  onClick={() => { setEditingItem(null); setTripForm({ date: new Date().toISOString().split('T')[0] }); setShowTripModal(true); }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"
                >
                  <Plus className="w-5 h-5" />
                  <span>Add Trip</span>
                </button>
                <button
                  onClick={() => exportToExcel('trips')}
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
                  {filteredTrips.map(trip => {
                    const dredger = dredgers.find(d => d.id === trip.dredgerId);
                    const transporter = transporters.find(t => t.id === trip.transporterId);
                    const truck = transporter?.trucks.find(tr => tr.id === trip.truckId || tr.plateNumber === trip.plateNumber);
                    const truckDisplay = truck?.id ? `${truck.plateNumber} (${truck.capacityCbm} CBM)` : trip.plateNumber;
                    return (
                      <tr key={trip.id} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3">{trip.date}</td>
                        <td className="px-4 py-3">{dredger?.name}</td>
                        <td className="px-4 py-3">{transporter?.name}</td>
                        <td className="px-4 py-3 font-mono text-sm">{truckDisplay}</td>
                        <td className="px-4 py-3 text-right">{trip.trips}</td>
                        <td className="px-4 py-3 text-right">{trip.capacityCbm} CBM</td>
                        <td className="px-4 py-3 text-right font-medium">{trip.totalVolume} CBM</td>
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

        {/* Payments Tab */}
        {activeTab === 'payments' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <h2 className="text-2xl font-bold">Payments Register</h2>
              <div className="flex space-x-2">
                <button
                  onClick={() => downloadTemplate('payments')}
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
                    if (file) handleFileImport('payments', file);
                    if (paymentsFileInput.current) paymentsFileInput.current.value = '';
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
                  onClick={() => { setEditingItem(null); setPaymentForm({ date: new Date().toISOString().split('T')[0] }); setShowPaymentModal(true); }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"
                >
                  <Plus className="w-5 h-5" />
                  <span>Add Payment</span>
                </button>
                <button
                  onClick={() => exportToExcel('payments')}
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
                  {payments.map(payment => {
                    const entity = payment.entityType === 'dredger' 
                      ? dredgers.find(d => d.id === payment.entityId)
                      : transporters.find(t => t.id === payment.entityId);
                    return (
                      <tr key={payment.id} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3">{payment.date}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${payment.entityType === 'dredger' ? 'bg-orange-100 text-orange-800' : 'bg-purple-100 text-purple-800'}`}>
                            {payment.entityType}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium">{entity?.name}</td>
                        <td className="px-4 py-3 text-right font-bold text-green-600">{formatCurrency(payment.amount)}</td>
                        <td className="px-4 py-3">{payment.paymentMethod}</td>
                        <td className="px-4 py-3 font-mono text-sm">{payment.reference}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{payment.notes}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end space-x-2">
                            <button
                              onClick={() => { setEditingItem(payment); setPaymentForm(payment); setShowPaymentModal(true); }}
                              className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deleteItem('payment', payment.id)}
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

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold">Comprehensive Reports</h2>
            
            {/* Export All Reports */}
            <div className="flex space-x-2">
              <button onClick={() => exportToExcel('trips')} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2">
                <Download className="w-5 h-5" />
                <span>Export Trips</span>
              </button>
              <button onClick={() => exportToExcel('dredgers')} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2">
                <Download className="w-5 h-5" />
                <span>Export Dredgers</span>
              </button>
              <button onClick={() => exportToExcel('transporters')} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center space-x-2">
                <Download className="w-5 h-5" />
                <span>Export Transporters</span>
              </button>
              <button onClick={() => exportToExcel('payments')} className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 flex items-center space-x-2">
                <Download className="w-5 h-5" />
                <span>Export Payments</span>
              </button>
            </div>

            {/* Overall Summary Report */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="font-bold text-xl mb-4 flex items-center space-x-2">
                <FileSpreadsheet className="w-6 h-6" />
                <span>Overall Project Summary</span>
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Total Volume Dredged</p>
                  <p className="text-2xl font-bold text-blue-600">{overallStats.totalVolume.toLocaleString()} CBM</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Total Trips Completed</p>
                  <p className="text-2xl font-bold text-green-600">{overallStats.totalTrips.toLocaleString()}</p>
                </div>
                <div className="bg-orange-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Total Dredger Cost</p>
                  <p className="text-2xl font-bold text-orange-600">{formatCurrency(overallStats.totalDredgerCost)}</p>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Total Transport Cost</p>
                  <p className="text-2xl font-bold text-purple-600">{formatCurrency(overallStats.totalTransporterCost)}</p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm text-gray-600">Total Project Cost</p>
                    <p className="text-2xl font-bold text-gray-800">{formatCurrency(overallStats.totalDredgerCost + overallStats.totalTransporterCost)}</p>
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

            {/* Dredger Detailed Report */}
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
                    {dredgers.map(dredger => {
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
                          <td className={`px-4 py-3 text-right font-bold ${earnings.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
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

            {/* Transporter Detailed Report */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="font-bold text-xl mb-4">Transporter Performance Report</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Transporter</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Contractor</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Rate/CBM</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Total Trips</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Total Volume</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Total Amount</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Total Paid</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Balance</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transporters.map(transporter => {
                      const earnings = calculateTransporterEarnings(transporter.id);
                      return (
                        <tr key={transporter.id} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="font-medium">{transporter.name}</div>
                            <div className="text-sm text-gray-500">{transporter.code}</div>
                          </td>
                          <td className="px-4 py-3">{transporter.contractor}</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(transporter.ratePerCbm)}</td>
                          <td className="px-4 py-3 text-right">{earnings.totalTrips.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">{earnings.totalVolume.toLocaleString()} CBM</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(earnings.totalAmount)}</td>
                          <td className="px-4 py-3 text-right text-green-600">{formatCurrency(earnings.totalPaid)}</td>
                          <td className={`px-4 py-3 text-right font-bold ${earnings.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
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

            {/* Accounting Summary */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="font-bold text-xl mb-4 flex items-center space-x-2">
                <DollarSign className="w-6 h-6" />
                <span>Accounting Summary</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold mb-3">Dredger Payments</h4>
                  <div className="space-y-2">
                    {dredgers.map(dredger => {
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
                            <div className={`font-bold ${earnings.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                              Balance: {formatCurrency(earnings.balance)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold mb-3">Transporter Payments</h4>
                  <div className="space-y-2">
                    {transporters.map(transporter => {
                      const earnings = calculateTransporterEarnings(transporter.id);
                      return (
                        <div key={transporter.id} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                          <div>
                            <div className="font-medium">{transporter.name}</div>
                            <div className="text-sm text-gray-500">{transporter.code}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-gray-600">Due: {formatCurrency(earnings.totalAmount)}</div>
                            <div className="text-sm text-green-600">Paid: {formatCurrency(earnings.totalPaid)}</div>
                            <div className={`font-bold ${earnings.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                              Balance: {formatCurrency(earnings.balance)}
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

      {/* Dredger Modal */}
      {showDredgerModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">{editingItem ? 'Edit' : 'Add'} Dredger</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Code</label>
                <input
                  type="text"
                  value={dredgerForm.code || ''}
                  onChange={(e) => setDredgerForm({ ...dredgerForm, code: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="DR-001"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={dredgerForm.name || ''}
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
                  value={dredgerForm.ratePerCbm || ''}
                  onChange={(e) => setDredgerForm({ ...dredgerForm, ratePerCbm: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Contractor</label>
                <input
                  type="text"
                  value={dredgerForm.contractor || ''}
                  onChange={(e) => setDredgerForm({ ...dredgerForm, contractor: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Contractor Name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Contract Number</label>
                <input
                  type="text"
                  value={dredgerForm.contractNumber || ''}
                  onChange={(e) => setDredgerForm({ ...dredgerForm, contractNumber: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="CNT-2024-XXX"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Status</label>
                <select
                  value={dredgerForm.status || 'active'}
                  onChange={(e) => setDredgerForm({ ...dredgerForm, status: e.target.value as 'active' | 'inactive' })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button onClick={() => { setShowDredgerModal(false); setEditingItem(null); setDredgerForm({}); }} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={saveDredger} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transporter Modal */}
      {showTransporterModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">{editingItem ? 'Edit' : 'Add'} Transporter</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Code</label>
                <input
                  type="text"
                  value={transporterForm.code || ''}
                  onChange={(e) => setTransporterForm({ ...transporterForm, code: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="TR-001"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={transporterForm.name || ''}
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
                  value={transporterForm.ratePerCbm || ''}
                  onChange={(e) => setTransporterForm({ ...transporterForm, ratePerCbm: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Contractor</label>
                <input
                  type="text"
                  value={transporterForm.contractor || ''}
                  onChange={(e) => setTransporterForm({ ...transporterForm, contractor: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Contractor Name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Contract Number</label>
                <input
                  type="text"
                  value={transporterForm.contractNumber || ''}
                  onChange={(e) => setTransporterForm({ ...transporterForm, contractNumber: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="CNT-2024-XXX"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Status</label>
                <select
                  value={transporterForm.status || 'active'}
                  onChange={(e) => setTransporterForm({ ...transporterForm, status: e.target.value as 'active' | 'inactive' })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button onClick={() => { setShowTransporterModal(false); setEditingItem(null); setTransporterForm({}); }} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={saveTransporter} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trip Modal */}
      {showTripModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-xl font-bold mb-4">{editingItem ? 'Edit' : 'Add'} Trip Report</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Date</label>
                <input
                  type="date"
                  value={tripForm.date || ''}
                  onChange={(e) => setTripForm({ ...tripForm, date: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Dredger</label>
                  <select
                    value={tripForm.dredgerId || ''}
                    onChange={(e) => setTripForm({ ...tripForm, dredgerId: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">Select Dredger</option>
                    {dredgers.filter(d => d.status === 'active').map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Transporter</label>
                  <select
                    value={tripForm.transporterId || ''}
                    onChange={(e) => {
                      setTripForm({ ...tripForm, transporterId: e.target.value, truckId: '' });
                    }}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">Select Transporter</option>
                    {transporters.filter(t => t.status === 'active').map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Truck</label>
                <select
                  value={tripForm.truckId || ''}
                  onChange={(e) => {
                    setTripForm({ ...tripForm, truckId: e.target.value });
                  }}
                  className="w-full px-3 py-2 border rounded-lg"
                  disabled={!tripForm.transporterId}
                >
                  <option value="">Select Truck</option>
                  {transporters
                    .find(t => t.id === tripForm.transporterId)
                    ?.trucks.filter(tr => tr.status === 'active')
                    .map(truck => (
                      <option key={truck.id} value={truck.id}>
                        {truck.plateNumber} ({truck.capacityCbm} CBM)
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Number of Trips</label>
                <input
                  type="number"
                  value={tripForm.trips || ''}
                  onChange={(e) => setTripForm({ ...tripForm, trips: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="0"
                />
              </div>
              {tripForm.truckId && (
                <div className="bg-blue-50 p-3 rounded">
                  <p className="text-sm text-blue-800">
                    <strong>Calculated Volume:</strong>{' '}
                    {(tripForm.trips || 0) * (transporters.flatMap(t => t.trucks).find(tr => tr.id === tripForm.truckId)?.capacityCbm || 0)} CBM
                  </p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700">Dumping Location</label>
                <input
                  type="text"
                  value={tripForm.dumpingLocation || ''}
                  onChange={(e) => setTripForm({ ...tripForm, dumpingLocation: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Site A, Location B, etc."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Notes</label>
                <textarea
                  value={tripForm.notes || ''}
                  onChange={(e) => setTripForm({ ...tripForm, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  rows={2}
                  placeholder="Additional notes..."
                />
              </div>
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button onClick={() => { setShowTripModal(false); setEditingItem(null); setTripForm({}); }} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={saveTrip} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">{editingItem ? 'Edit' : 'Add'} Payment</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Date</label>
                <input
                  type="date"
                  value={paymentForm.date || ''}
                  onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Payment Type</label>
                <select
                  value={paymentForm.entityType || 'dredger'}
                  onChange={(e) => setPaymentForm({ ...paymentForm, entityType: e.target.value as 'dredger' | 'transporter', entityId: '' })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="dredger">Dredger</option>
                  <option value="transporter">Transporter</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Entity</label>
                <select
                  value={paymentForm.entityId || ''}
                  onChange={(e) => setPaymentForm({ ...paymentForm, entityId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="">Select Entity</option>
                  {paymentForm.entityType === 'dredger'
                    ? dredgers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)
                    : transporters.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Amount (₦)</label>
                <input
                  type="number"
                  step="0.01"
                  value={paymentForm.amount || ''}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Payment Method</label>
                <select
                  value={paymentForm.paymentMethod || 'Bank Transfer'}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Check">Check</option>
                  <option value="Cash">Cash</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Reference Number</label>
                <input
                  type="text"
                  value={paymentForm.reference || ''}
                  onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="PAY-2024-XXX"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Notes</label>
                <textarea
                  value={paymentForm.notes || ''}
                  onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  rows={2}
                  placeholder="Payment notes..."
                />
              </div>
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button onClick={() => { setShowPaymentModal(false); setEditingItem(null); setPaymentForm({}); }} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={savePayment} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DredgingDashboard;
