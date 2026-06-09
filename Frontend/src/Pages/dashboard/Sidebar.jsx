import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { isAdminEmail } from "../../components/IdealAdminPanel";

/**
 * Sidebar — Dashboard / Settings nav, plan badge, and an expandable "Admin"
 * group (admins only) that reveals sub-pages like "Users payment queue".
 * Clicking a sub-page sets activePage to e.g. "Admin:payments", which Dashboard
 * renders in the main area.
 */
export default function Sidebar({ sidebarOpen, setSidebarOpen, activePage, setActivePage }) {
  const { user, logout, plan } = useAuth();
  const navigate = useNavigate();
  const isAdmin = isAdminEmail(user?.sub);
  // Admin group starts expanded if you're already on an Admin sub-page.
  const [adminOpen, setAdminOpen] = useState(() => String(activePage).startsWith("Admin"));

  const planLabel = isAdmin ? "ADMIN" : ({ basic: "FREE", pro: "PRO", enterprise: "ENT" }[plan] || "FREE");
  const isPaid = isAdmin || plan === "pro" || plan === "enterprise";

  // Top-level items shown to everyone.
  const navItems = ["Dashboard", "Settings"];

  // Admin sub-pages (add more here later).
  const adminSubpages = [
    { id: "Admin:overview", label: "Overview" },
    { id: "Admin:payments", label: "Users payment queue" },
  ];

  return (
    <div className={`bg-gray-900 ${sidebarOpen ? "w-56" : "w-16"} transition-all flex flex-col justify-between`}>
      <div>
        <button className="p-3" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>

        {/* User avatar */}
        <div className="flex flex-col items-center mt-2 mb-4">
          <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center text-xs font-semibold">
            {user?.sub?.charAt(0).toUpperCase()}
          </div>
          {sidebarOpen && (
            <div className="mt-1 text-center px-2">
              <p className="text-[10px] text-gray-300 truncate">{user?.sub} 👋</p>
              {/* Plan badge */}
              <span
                className="inline-block mt-1 text-[9px] font-bold px-2 py-0.5 rounded-full"
                style={{
                  background: isPaid ? "linear-gradient(135deg,#00e87a,#00c9ff)" : "rgba(255,255,255,0.08)",
                  color: isPaid ? "#0a0f0d" : "#9ca3af",
                }}
              >
                {planLabel}
              </span>
            </div>
          )}
        </div>

        <div className="p-2 space-y-3 text-sm">
          {navItems.map((i) => (
            <div key={i} onClick={() => setActivePage(i)}
              className={`p-2 rounded cursor-pointer hover:bg-gray-800 ${activePage === i ? "bg-gray-800 text-white" : "text-gray-400"}`}>
              {sidebarOpen ? i : i[0]}
            </div>
          ))}

          {/* Admin group — expandable, admins only */}
          {isAdmin && (
            <div className="space-y-1">
              <div
                onClick={() => setAdminOpen((o) => !o)}
                className={`p-2 rounded cursor-pointer hover:bg-gray-800 flex items-center ${
                  String(activePage).startsWith("Admin") ? "text-white" : "text-gray-400"
                }`}
              >
                <span className="mr-2">◆</span>
                {sidebarOpen && <span className="flex-1">Admin</span>}
                {sidebarOpen && <span className="text-[10px]">{adminOpen ? "▾" : "▸"}</span>}
              </div>

              {adminOpen && sidebarOpen && (
                <div className="ml-3 pl-2 border-l border-gray-800 space-y-1">
                  {adminSubpages.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => setActivePage(s.id)}
                      className={`px-2 py-1.5 rounded cursor-pointer text-[13px] hover:bg-gray-800 ${
                        activePage === s.id ? "bg-gray-800 text-white" : "text-gray-400"
                      }`}
                    >
                      {s.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="p-2 border-t border-gray-800">
        <button onClick={() => { logout(); navigate("/"); }}
          className="w-full text-left p-2 hover:bg-red-500/20 text-red-400 rounded text-sm">
          {sidebarOpen ? "Logout" : "⏻"}
        </button>
      </div>
    </div>
  );
}