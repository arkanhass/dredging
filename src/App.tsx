import { useState, useMemo } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { DredgersPage } from './components/DredgersPage';
import { TransportersPage } from './components/TransportersPage';
import { TripsPage } from './components/TripsPage';
import { PaymentsPage } from './components/PaymentsPage';
import { ReportsPage } from './components/ReportsPage';
import ImportPage from './components/ImportPage';
import { useStore } from './store/useStore';
import { 
  calculateDredgerSummaries, 
  calculateTransporterSummaries, 
  calculateDumpingLocationSummaries 
} from './utils/calculations';
import { exportToExcel, exportDataBackup } from './utils/excel';
import { Dredger, Transporter, Trip, Payment, Truck } from './types';

type Tab = 'dashboard' | 'dredgers' | 'transporters' | 'trips' | 'payments' | 'reports' | 'import';

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const store = useStore();

  // Calculate summaries
  const dredgerSummaries = useMemo(() => 
    calculateDredgerSummaries(store.dredgers, store.trips, store.payments, dateFrom || undefined, dateTo || undefined),
    [store.dredgers, store.trips, store.payments, dateFrom, dateTo]
  );

  const transporterSummaries = useMemo(() => 
    calculateTransporterSummaries(store.transporters, store.trips, store.payments, dateFrom || undefined, dateTo || undefined),
    [store.transporters, store.trips, store.payments, dateFrom, dateTo]
  );

  const locationSummaries = useMemo(() => 
    calculateDumpingLocationSummaries(store.trips, dateFrom || undefined, dateTo || undefined),
    [store.trips, dateFrom, dateTo]
  );

  const totalTrips = store.trips.length;
  const totalVolume = store.trips.reduce((sum, t) => sum + t.volumeCubicMeter, 0);

  const handleExport = () => {
    exportToExcel(
      dredgerSummaries,
      transporterSummaries,
      store.trips,
      store.payments,
      store.dredgers,
      store.transporters
    );
  };

  const handleBackup = () => {
    exportDataBackup(
      store.dredgers,
      store.transporters,
      store.trips,
      store.payments
    );
  };

  // Import handlers
  const handleImportDredgers = (importedDredgers: Dredger[]) => {
    importedDredgers.forEach(dredger => {
      store.addDredger(dredger.name, dredger.ratePerCubicMeter);
    });
  };

  const handleImportTransporters = (importedTransporters: Transporter[]) => {
    importedTransporters.forEach(transporter => {
      store.addTransporter(transporter.name, transporter.ratePerCubicMeter);
    });
  };

  const handleImportTrucks = (importedTrucks: { transporterId: string; truck: Truck }[]) => {
    importedTrucks.forEach(({ transporterId, truck }) => {
      store.addTruck(transporterId, truck.name, truck.plateNumber, truck.capacityCubicMeter);
    });
  };

  const handleImportTrips = (importedTrips: Trip[]) => {
    importedTrips.forEach(trip => {
      store.addTrip(
        trip.date,
        trip.dredgerName,
        trip.transporterName,
        trip.plateNumber,
        trip.dumpingLocation
      );
    });
  };

  const handleImportPayments = (importedPayments: Payment[]) => {
    importedPayments.forEach(payment => {
      store.addPayment(
        payment.date,
        payment.entityType,
        payment.entityId,
        payment.amount,
        payment.description
      );
    });
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <Dashboard
            dredgerSummaries={dredgerSummaries}
            transporterSummaries={transporterSummaries}
            locationSummaries={locationSummaries}
            totalTrips={totalTrips}
            totalVolume={totalVolume}
          />
        );
      case 'dredgers':
        return (
          <DredgersPage
            dredgers={store.dredgers}
            onAdd={store.addDredger}
            onUpdate={store.updateDredger}
            onDelete={store.deleteDredger}
          />
        );
      case 'transporters':
        return (
          <TransportersPage
            transporters={store.transporters}
            onAddTransporter={store.addTransporter}
            onUpdateTransporter={store.updateTransporter}
            onDeleteTransporter={store.deleteTransporter}
            onAddTruck={store.addTruck}
            onUpdateTruck={store.updateTruck}
            onDeleteTruck={store.deleteTruck}
          />
        );
      case 'trips':
        return (
          <TripsPage
            trips={store.trips}
            dredgers={store.dredgers}
            transporters={store.transporters}
            onAdd={store.addTrip}
            onDelete={store.deleteTrip}
          />
        );
      case 'payments':
        return (
          <PaymentsPage
            payments={store.payments}
            dredgers={store.dredgers}
            transporters={store.transporters}
            onAdd={store.addPayment}
            onUpdate={store.updatePayment}
            onDelete={store.deletePayment}
          />
        );
      case 'reports':
        return (
          <ReportsPage
            dredgerSummaries={dredgerSummaries}
            transporterSummaries={transporterSummaries}
            locationSummaries={locationSummaries}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
          />
        );
      case 'import':
        return (
          <ImportPage
            dredgers={store.dredgers}
            transporters={store.transporters}
            onImportDredgers={handleImportDredgers}
            onImportTransporters={handleImportTransporters}
            onImportTrucks={handleImportTrucks}
            onImportTrips={handleImportTrips}
            onImportPayments={handleImportPayments}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Layout
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onExport={handleExport}
      onBackup={handleBackup}
    >
      {renderContent()}
    </Layout>
  );
}
