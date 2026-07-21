import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import VenueGrid from "./pages/VenueGrid";
import VenueDetail from "./pages/VenueDetail";
import VibeMap from "./pages/VibeMap";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Dashboard from "./pages/Dashboard";

export default function App() {
  return (
      <AuthProvider>
        <div className="min-h-screen bg-vibe-bg">
          <Routes>
            <Route path="/" element={<VenueGrid />} />
            <Route path="/map" element={<VibeMap />} />
            <Route path="/venue/:id" element={<VenueDetail />} />
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<Login />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/dashboard/manage" element={<Dashboard />} />
          </Routes>
        </div>
      </AuthProvider>
    );
}
