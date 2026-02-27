const API_URL = "https://script.google.com/macros/s/AKfycbwTimTnSOaCkAmPxNAAi3Yio12mr5pxYTywcQfx3lhDkZMzCuKm6omq2g_KxtOdYBws7w/exec"

async function api(action: string, data?: any) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, data })
  })
  const result = await res.json()
  if (!result.success) throw new Error(result.error || 'Unknown error')
  return result.data
}

export async function getAllData() {
  return api('getAll')
}

export async function saveDredger(dredger: any) {
  return api('saveDredger', dredger)
}

export async function saveTransporter(transporter: any) {
  return api('saveTransporter', transporter)
}

export async function saveTrip(trip: any) {
  return api('saveTrip', trip)
}

export async function savePayment(payment: any) {
  return api('savePayment', payment)
}

export async function deleteDredger(code: string) {
  return api('deleteDredger', { code })
}

export async function deleteTransporter(code: string) {
  return api('deleteTransporter', { code })
}

export async function deleteTrip(trip: any) {
  return api('deleteTrip', trip)
}

export async function deletePayment(payment: any) {
  return api('deletePayment', payment)
}