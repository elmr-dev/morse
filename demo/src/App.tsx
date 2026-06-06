import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import DecodePage from './pages/DecodePage'
import BeatTheBotPage from './pages/BeatTheBotPage'

export default function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const tabValue = location.pathname === '/beat' ? 'beat' : 'decode'

  return (
    <>
      <div className="nav">
        <div className="title">CW Decoder Demo</div>
        <Tabs value={tabValue} onValueChange={(v) => navigate(`/${v}`)}>
          <TabsList>
            <TabsTrigger value="decode">Decode Demo</TabsTrigger>
            <TabsTrigger value="beat">Beat the Bot</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <Routes>
        <Route path="/" element={<Navigate to="/decode" replace />} />
        <Route path="/decode" element={<DecodePage />} />
        <Route path="/beat" element={<BeatTheBotPage />} />
      </Routes>
    </>
  )
}
