import { Route, Routes } from "react-router-dom";
import VenueGrid from "./pages/VenueGrid";
import VenueDetail from "./pages/VenueDetail";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";

export default function App() {
  return (
    <div className="min-h-screen bg-vibe-bg">
      <Routes>
        <Route path="/" element={<VenueGrid />} />
        <Route path="/venue/:id" element={<VenueDetail />} />
        <Route path="/dashboard" element={<Login />} />
        <Route path="/dashboard/manage" element={<Dashboard />} />
      </Routes>
    </div>
  );
}
