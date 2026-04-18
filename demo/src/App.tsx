import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import DecodePage from './pages/DecodePage'
import BeatTheBotPage from './pages/BeatTheBotPage'

export default function App() {
  return (
    <>
      <nav className="nav">
        <div className="title">CW Decoder Demo</div>
        <NavLink to="/decode" className={({ isActive }) => (isActive ? 'active' : '')}>
          Decode Demo
        </NavLink>
        <NavLink to="/beat" className={({ isActive }) => (isActive ? 'active' : '')}>
          Beat the Bot
        </NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Navigate to="/decode" replace />} />
        <Route path="/decode" element={<DecodePage />} />
        <Route path="/beat" element={<BeatTheBotPage />} />
      </Routes>
    </>
  )
}
