import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import DecodePage from './pages/DecodePage'
import BeatTheBotPage from './pages/BeatTheBotPage'
import ContestHelperPage from './pages/ContestHelperPage'
import SingleDecoderPage from './pages/SingleDecoderPage'

export default function App() {
  return (
    <>
      <nav className="nav">
        <div className="title">CW Decoder Demo</div>
        <NavLink to="/single" className={({ isActive }) => (isActive ? 'active' : '')}>
          Decode Demo
        </NavLink>
        <NavLink to="/beat-the-bot" className={({ isActive }) => (isActive ? 'active' : '')}>
          Beat the Bot
        </NavLink>
        <NavLink to="/contest" className={({ isActive }) => (isActive ? 'active' : '')}>
          Contest
        </NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Navigate to="/single" replace />} />
        <Route path="/decode" element={<DecodePage />} />
        <Route path="/single" element={<SingleDecoderPage />} />
        <Route path="/beat" element={<Navigate to="/beat-the-bot" replace />} />
        <Route path="/beat-the-bot" element={<BeatTheBotPage />} />
        <Route path="/contest-helper" element={<Navigate to="/contest" replace />} />
        <Route path="/contest" element={<ContestHelperPage />} />
      </Routes>
    </>
  )
}
