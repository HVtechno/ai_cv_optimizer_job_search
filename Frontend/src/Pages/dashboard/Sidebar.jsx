import { useAuth } from "../../context/AuthContext";
import { useNavigate } from "react-router-dom";

/**
 * Sidebar — adds a "Settings" nav item and a plan badge under the avatar.
 * Your existing nav items and logout are unchanged. The plan badge reads from
 * AuthContext (plan), so it shows FREE / PRO / ENTERPRISE automatically.
 */
export default function Sidebar({ sidebarOpen, setSidebarOpen, activePage, setActivePage }) {
  const { user, logout, plan } = useAuth();
  const navigate = useNavigate();

  const planLabel = { basic: "FREE", pro: "PRO", enterprise: "ENT" }[plan] || "FREE";
  const isPaid = plan === "pro" || plan === "enterprise";

  // Added "Settings" to the existing list.
  const navItems = ["Dashboard", "Settings"];

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