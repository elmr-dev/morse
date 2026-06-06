import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Radio, Swords } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import ThemeSwitcher from './components/ThemeSwitcher'
import DecodePage from './pages/DecodePage'
import BeatTheBotPage from './pages/BeatTheBotPage'

export default function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const tabValue = location.pathname === '/beat-the-bot' || location.pathname === '/beat' ? 'beat-the-bot' : 'decode'

  return (
    <>
      <div className="mb-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-6" />
            <span className="font-mono font-bold text-foreground text-lg tracking-tight">
              CW <span className="text-muted-foreground font-normal">Decoder</span>
            </span>
          </div>
          <ThemeSwitcher />
        </div>
        <Tabs value={tabValue} onValueChange={(v) => navigate(`/${v}`)}>
          <TabsList className="w-full">
            <TabsTrigger value="decode" className="flex-1"><Radio className="size-4" />Decode</TabsTrigger>
            <TabsTrigger value="beat-the-bot" className="flex-1"><Swords className="size-4" />Beat the Bot</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <Routes>
        <Route path="/" element={<Navigate to="/decode" replace />} />
        <Route path="/decode" element={<DecodePage />} />
        <Route path="/beat" element={<Navigate to="/beat-the-bot" replace />} />
        <Route path="/beat-the-bot" element={<BeatTheBotPage />} />
      </Routes>
    </>
  )
}
