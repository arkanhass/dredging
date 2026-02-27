import { useState, useEffect } from 'react'
import { getAllData } from './api' // This is the only new line
import Dredgers from './pages/Dredgers'
import Transporters from './pages/Transporters'
import Trips from './pages/Trips'
import Payments from './pages/Payments'
import Dashboard from './pages/Dashboard'
import Navigation from './components/Navigation'
import './index.css'

function App() {
  const [page, setPage] = useState('dashboard')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  async function reload() {
    setLoading(true)
    const data = await getAllData()
    setData(data)
    setLoading(false)
  }

  useEffect(() => {
    reload()
  }, [])

  const pages = {
    dashboard: <Dashboard data={data} />,
    dredgers: <Dredgers data={data} onChanged={reload} />,
    transporters: <Transporters data={data} onChanged={reload} />,
    trips: <Trips data={data} onChanged={reload} />,
    payments: <Payments data={data} onChanged={reload} />
  }

  if (loading) return <div className="p-8">Loading data from your sheet...</div>

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation page={page} setPage={setPage} />
      <div className="p-6 max-w-7xl mx-auto">
        {pages[page]}
      </div>
    </div>
  )
}

export default App