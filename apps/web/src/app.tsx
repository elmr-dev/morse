import { Radio, Swords } from 'lucide-react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ThemeSwitcher from './components/theme-switcher';
import BeatTheBotPage from './pages/beat-the-bot-page';
import DecodePage from './pages/decode-page';

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const tabValue =
    location.pathname === '/beat-the-bot' || location.pathname === '/beat'
      ? 'beat-the-bot'
      : 'decode';

  return (
    <>
      <div className="mb-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <img
              src={`${import.meta.env.BASE_URL}logo.webp`}
              alt=""
              className="h-4 w-auto"
            />
            <span className="font-mono font-bold text-foreground text-xl tracking-tight">
              MORSE
            </span>
          </div>
          <ThemeSwitcher />
        </div>
        <Tabs value={tabValue} onValueChange={(v) => navigate(`/${v}`)}>
          <TabsList className="w-full">
            <TabsTrigger value="decode" className="flex-1">
              <Radio className="size-4" />
              Decode
            </TabsTrigger>
            <TabsTrigger value="beat-the-bot" className="flex-1">
              <Swords className="size-4" />
              Beat the Bot
            </TabsTrigger>
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
  );
}
