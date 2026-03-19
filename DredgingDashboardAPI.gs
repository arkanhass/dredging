// =============================================
//   GAS Web App - Dredging / Transport Management
// =============================================

const SHEET_ID = '1RNPjQ-JxUJiF85pBb-0sqbdkWwmGV1Q23cT5qgFFauM';

function doGet(e)  { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
   let action;
let data = {};

if (e.postData && e.postData.contents) {
  // POST → JSON body
  const parsed = JSON.parse(e.postData.contents);
  action = parsed.action;
  data   = parsed.data || parsed;
} else if (e.parameter) {
  // GET → query parameters
  action = e.parameter.action;
  data   = e.parameter;   // all query params become the data object
} else {
  action = null;
  data   = {};
}

    // ────────────────────────────────────────────────
    //  Main action routing
    // ────────────────────────────────────────────────
    if (action === 'saveDredger')     return saveDredger(ss, data);
    if (action === 'saveTransporter') return saveTransporter(ss, data);
    if (action === 'saveTrip')        return saveTrip(ss, data);
    if (action === 'updateTrip')      return updateTrip(ss, data);
    if (action === 'savePayment')     return savePayment(ss, data);

    if (action === 'deleteDredger')   return deleteRow(ss, 'Dredgers',    'Code', data.code || data.Code);
    if (action === 'deleteTransporter') return deleteRow(ss, 'Transporters','Code', data.code || data.Code);
    if (action === 'deleteTrip')      return deleteTrip(ss, data);
    if (action === 'deletePayment')   return deletePayment(ss, data);

    // Truck-specific actions
    if (action === 'addTruck')        return saveTransporter(ss, data);   // re-uses same logic
    if (action === 'deleteTruck')     return deleteTruck(ss, data);

    // ────────────────────────────────────────────────
// READ ACTIONS (via GET or POST)
// ────────────────────────────────────────────────

if (action === 'getDredgers' || e.parameter?.action === 'getDredgers') {
  return getAllRows(ss, 'Dredgers');
}

if (action === 'getTransporters' || e.parameter?.action === 'getTransporters') {
  return getAllRows(ss, 'Transporters');
}

if (action === 'getTrips' || e.parameter?.action === 'getTrips') {
  return getAllRows(ss, 'Trips');
}

if (action === 'getPayments' || e.parameter?.action === 'getPayments') {
  return getAllRows(ss, 'Payments');
}

    return jsonResponse({ success: false, error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message + ' → ' + err.stack });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ────────────────────────────────────────────────
//  SAVE / UPDATE TRANSPORTER + TRUCK
// ────────────────────────────────────────────────
function saveTransporter(ss, data) {
  const sheet = ss.getSheetByName('Transporters');
  const rows  = sheet.getDataRange().getValues();
  let found = false;

  // 1. Update base info on ALL rows with this Code
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.Code)) {
      sheet.getRange(i + 1, 2).setValue(data.Name           || '');
      sheet.getRange(i + 1, 3).setValue(data.RatePerCbm     || 0);
      sheet.getRange(i + 1, 4).setValue(data.Status         || 'active');
      sheet.getRange(i + 1, 5).setValue(data.Contractor     || '');
      sheet.getRange(i + 1, 6).setValue(data.ContractNumber || '');
      found = true;
    }
  }

  // 2. Truck handling (when PlateNumber is sent)
  if (data.PlateNumber && String(data.PlateNumber).trim()) {
    let truckRow = -1;

    // Find existing truck line
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.Code) &&
          String(rows[i][6]) === String(data.PlateNumber)) {
        truckRow = i + 1;
        break;
      }
    }

    if (truckRow > 0) {
      // Update existing truck row
      sheet.getRange(truckRow, 7).setValue(data.PlateNumber);
      sheet.getRange(truckRow, 8).setValue(Number(data.TransporterBillingCbm) || 0);  // H
      sheet.getRange(truckRow, 9).setValue(Number(data.DredgerBillingCbm)     || 0);  // I
      sheet.getRange(truckRow,10).setValue(data.TruckName || 'Unnamed');
    } else {
      // Append new truck row
      sheet.appendRow([
        data.Code,
        data.Name           || '',
        Number(data.RatePerCbm)     || 0,
        data.Status         || 'active',
        data.Contractor     || '',
        data.ContractNumber || '',
        data.PlateNumber,
        Number(data.TransporterBillingCbm) || 0,
        Number(data.DredgerBillingCbm)     || 0,
        data.TruckName || 'Unnamed'
      ]);
      found = true;
    }
  }

  // 3. Completely new transporter (no truck info)
  if (!found) {
    sheet.appendRow([
      data.Code,
      data.Name           || '',
      Number(data.RatePerCbm)     || 0,
      data.Status         || 'active',
      data.Contractor     || '',
      data.ContractNumber || '',
      data.PlateNumber    || '',
      Number(data.TransporterBillingCbm) || 0,
      Number(data.DredgerBillingCbm)     || 0,
      data.TruckName      || ''
    ]);
  }

  return jsonResponse({ success: true });
}

// ────────────────────────────────────────────────
//  DELETE SINGLE TRUCK
// ────────────────────────────────────────────────
function deleteTruck(ss, data) {
  const sheet = ss.getSheetByName('Transporters');
  const rows  = sheet.getDataRange().getValues();
  const code  = String(data.Code || data.code || '');
  const plate = String(data.PlateNumber || data.plateNumber || '');

  let deleted = 0;

  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === code && String(rows[i][6]) === plate) {
      sheet.deleteRow(i + 1);
      deleted++;
    }
  }

  return jsonResponse({ success: true, deletedCount: deleted });
}

// ────────────────────────────────────────────────
//  TRIP - APPEND
// ────────────────────────────────────────────────
function saveTrip(ss, data) {
  const sheet = ss.getSheetByName('Trips');
  sheet.appendRow([
    data.Date             || '',
    data.DredgerCode      || '',
    data.TransporterCode  || '',
    data.PlateNumber      || '',
    Number(data.Trips)    || 0,
    Number(data.DredgerRate)     || 0,
    Number(data.TransporterRate) || 0,
    data.DumpingLocation  || '',
    data.Notes            || '',
    Number(data.DredgerAmount)     || 0,
    Number(data.TransporterAmount) || 0,
    Number(data.TransporterBillingCbm) || '',
    Number(data.DredgerBillingCbm)     || '',
    data.Reference        || ''
  ]);

  return jsonResponse({ success: true });
}

// ────────────────────────────────────────────────
//  TRIP - UPDATE (delete old + append new)
// ────────────────────────────────────────────────
function updateTrip(ss, data) {
  const sheet = ss.getSheetByName('Trips');
  const row   = Number(data.rowNumber || data.Row || data.row || 0);

  if (row > 1) {
    sheet.deleteRow(row);
  }

  return saveTrip(ss, data);
}

// ────────────────────────────────────────────────
//  DELETE TRIP by row number
// ────────────────────────────────────────────────
function deleteTrip(ss, data) {
  const sheet = ss.getSheetByName('Trips');
  const row   = Number(data.rowNumber || data.Row || data.row || 0);

  if (row > 1) {
    sheet.deleteRow(row);
    return jsonResponse({ success: true });
  }

  return jsonResponse({ success: false, error: 'Invalid row number' });
}

// ────────────────────────────────────────────────
//  PAYMENT - APPEND
// ────────────────────────────────────────────────
function savePayment(ss, data) {
  const sheet = ss.getSheetByName('Payments');
  sheet.appendRow([
    data.Date           || '',
    data.EntityType     || 'dredger',
    data.EntityCode     || '',
    Number(data.Amount) || 0,
    data.PaymentMethod  || 'Bank Transfer',
    data.Reference      || '',
    data.Notes          || ''
  ]);

  return jsonResponse({ success: true });
}

// ────────────────────────────────────────────────
//  DELETE PAYMENT by Reference
// ────────────────────────────────────────────────
function deletePayment(ss, data) {
  const sheet = ss.getSheetByName('Payments');
  const rows  = sheet.getDataRange().getValues();
  const ref   = String((data.Reference || data.reference || '')).trim();

  let found = false;

  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][5]).trim() === ref) {   // column F = index 5
      sheet.deleteRow(i + 1);
      found = true;
    }
  }

  return jsonResponse({ success: found, message: found ? 'Deleted' : 'Reference not found' });
}

// ────────────────────────────────────────────────
//  GENERIC DELETE by key column value
// ────────────────────────────────────────────────
function deleteRow(ss, sheetName, keyColumnName, keyValue) {
  const sheet = ss.getSheetByName(sheetName);
  const data  = sheet.getDataRange().getValues();
  const col   = data[0].indexOf(keyColumnName);

  if (col === -1) {
    return jsonResponse({ success: false, error: 'Column not found' });
  }

  let deleted = 0;

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][col]) === String(keyValue)) {
      sheet.deleteRow(i + 1);
      deleted++;
    }
  }

  return jsonResponse({ success: true, deleted });
}

// ────────────────────────────────────────────────
//  Placeholder for saveDredger (add your version here)
// ────────────────────────────────────────────────
function saveDredger(ss, data) {
  // You should implement this similarly to saveTransporter
  // For now returning success so frontend doesn't break
  const sheet = ss.getSheetByName('Dredgers');

  // Example minimal implementation:
  sheet.appendRow([
    data.Code           || '',
    data.Name           || '',
    Number(data.RatePerCbm)     || 0,
    data.Status         || 'active',
    data.Contractor     || '',
    data.ContractNumber || ''
  ]);

  return jsonResponse({ success: true });
}
// ────────────────────────────────────────────────
// READ ALL ROWS FROM A SHEET (as array of objects)
// ────────────────────────────────────────────────
function getAllRows(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return jsonResponse({ success: false, error: `Sheet ${sheetName} not found` });
  }
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return jsonResponse({ success: true, data: [] });
  }

  const headers = data[0];
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j] ?? '';
    }
    rows.push(obj);
  }

  return jsonResponse({ success: true, data: rows });
}