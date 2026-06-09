import { useAuth } from "../../context/AuthContext";
import IdealAdminPanel, { isAdminEmail } from "../../components/IdealAdminPanel";
import AdminMetrics from "../../components/AdminMetrics";

/**
 * AdminPanel — main-area content for the Admin sub-pages.
 *
 * The Admin sub-navigation lives in the Sidebar (an expandable group). This
 * component just renders the content for whichever sub-page is active, passed
 * in via the `subpage` prop (e.g. "payments").
 *
 * Guarded: the Sidebar only shows Admin to admins and Dashboard only routes here
 * for admins, but we also check here, and the backend independently enforces
 * ADMIN_EMAILS on every /ideal/admin/* call.
 */

const SUBPAGES = {
  overview: { label: "Overview", render: () => <AdminMetrics /> },
  payments: { label: "Users payment queue", render: () => <IdealAdminPanel /> },
};

export default function AdminPanel({ subpage = "overview" }) {
  const { user } = useAuth();
  if (!isAdminEmail(user?.sub)) {
    return (
      <div className="h-full w-full flex items-center justify-center text-gray-500 text-sm">
        You don't have access to this area.
      </div>
    );
  }

  const current = SUBPAGES[subpage] || SUBPAGES.overview;

  return (
    <div className="h-full w-full min-h-0 overflow-y-auto p-6">
      <h2
        className="mb-4"
        style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, color: "var(--text, #EDF6F2)" }}
      >
        {current.label}
      </h2>
      {current.render()}
    </div>
  );
}