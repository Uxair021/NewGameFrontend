import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { MaintenanceProvider, useMaintenance } from "./context/MaintenanceContext";
import { MaintenancePage } from "./pages/MaintenancePage";
import { RegionBlockedPage } from "./pages/RegionBlockedPage";
import { Navbar } from "./components/Navbar";
import { FullscreenHelper } from "./components/FullscreenHelper";
import { RotatePhone } from "./components/RotatePhone";
import { IOSFullscreen } from "./components/IOSFullscreen";
import { AndroidChromeFullscreen } from "./components/AndroidChromeFullscreen";
import { IS_ANDROID_CHROME, IS_IOS, USES_ROTATE_SCREEN } from "./platform";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RequireAdmin } from "./components/RequireAdmin";
// import { HomePage } from "./pages/HomePage"; // "/" now renders Home2Page
import { LoginPage } from "./pages/LoginPage";
import { UserPanelPage } from "./pages/UserPanelPage";
import { GamePage } from "./pages/GamePage";
import { FishGameGame } from "./games/FishGame/FishGameGame";

const AdminLayout = lazy(() => import("./admin/AdminLayout").then((m) => ({ default: m.AdminLayout })));
const AdminOverviewPage = lazy(() =>
  import("./admin/AdminOverviewPage").then((m) => ({ default: m.AdminOverviewPage }))
);
const AdminEarningsPage = lazy(() =>
  import("./admin/AdminEarningsPage").then((m) => ({ default: m.AdminEarningsPage }))
);
const AdminUsersPage = lazy(() => import("./admin/AdminUsersPage").then((m) => ({ default: m.AdminUsersPage })));
const AdminPlayerDetailPage = lazy(() =>
  import("./admin/AdminPlayerDetailPage").then((m) => ({ default: m.AdminPlayerDetailPage }))
);
const AdminBalanceReportPage = lazy(() =>
  import("./admin/AdminBalanceReportPage").then((m) => ({ default: m.AdminBalanceReportPage }))
);
const AdminJackpotPage = lazy(() => import("./admin/AdminJackpotPage").then((m) => ({ default: m.AdminJackpotPage })));
const AdminLobbyGamesPage = lazy(() =>
  import("./admin/AdminLobbyGamesPage").then((m) => ({ default: m.AdminLobbyGamesPage }))
);
const AdminForceOutcomePage = lazy(() =>
  import("./admin/AdminForceOutcomePage").then((m) => ({ default: m.AdminForceOutcomePage }))
);
const AdminRtpPage = lazy(() => import("./admin/AdminRtpPage").then((m) => ({ default: m.AdminRtpPage })));
const AdminBuffaloRtpPage = lazy(() =>
  import("./admin/AdminBuffaloRtpPage").then((m) => ({ default: m.AdminBuffaloRtpPage }))
);
const AdminFishGamePage = lazy(() =>
  import("./admin/AdminFishGamePage").then((m) => ({ default: m.AdminFishGamePage }))
);
const AdminSizzlingRtpPage = lazy(() =>
  import("./admin/AdminSizzlingRtpPage").then((m) => ({ default: m.AdminSizzlingRtpPage }))
);
const AdminLifeOfLuxuryRtpPage = lazy(() =>
  import("./admin/AdminLifeOfLuxuryRtpPage").then((m) => ({ default: m.AdminLifeOfLuxuryRtpPage }))
);
const AdminTheFinerThingRtpPage = lazy(() =>
  import("./admin/AdminTheFinerThingRtpPage").then((m) => ({ default: m.AdminTheFinerThingRtpPage }))
);
const AdminShamrockRtpPage = lazy(() =>
  import("./admin/AdminShamrockRtpPage").then((m) => ({ default: m.AdminShamrockRtpPage }))
);
const AdminCrazy777RtpPage = lazy(() =>
  import("./admin/AdminCrazy777RtpPage").then((m) => ({ default: m.AdminCrazy777RtpPage }))
);
const AdminFiveXRtpPage = lazy(() =>
  import("./admin/AdminFiveXRtpPage").then((m) => ({ default: m.AdminFiveXRtpPage }))
);
const AdminCashMachineRtpPage = lazy(() =>
  import("./admin/AdminCashMachineRtpPage").then((m) => ({ default: m.AdminCashMachineRtpPage }))
);
const AdminCrystalCloverRtpPage = lazy(() =>
  import("./admin/AdminCrystalCloverRtpPage").then((m) => ({ default: m.AdminCrystalCloverRtpPage }))
);
const AdminFruity777RtpPage = lazy(() =>
  import("./admin/AdminFruity777RtpPage").then((m) => ({ default: m.AdminFruity777RtpPage }))
);
const AdminGemsDeluxeRtpPage = lazy(() =>
  import("./admin/AdminGemsDeluxeRtpPage").then((m) => ({ default: m.AdminGemsDeluxeRtpPage }))
);
const AdminMega10XPayRtpPage = lazy(() =>
  import("./admin/AdminMega10XPayRtpPage").then((m) => ({ default: m.AdminMega10XPayRtpPage }))
);
const AdminRubberDuckRtpPage = lazy(() =>
  import("./admin/AdminRubberDuckRtpPage").then((m) => ({ default: m.AdminRubberDuckRtpPage }))
);
const AdminVegasHitsRtpPage = lazy(() =>
  import("./admin/AdminVegasHitsRtpPage").then((m) => ({ default: m.AdminVegasHitsRtpPage }))
);
const AdminKenoRtpPage = lazy(() =>
  import("./admin/AdminKenoRtpPage").then((m) => ({ default: m.AdminKenoRtpPage }))
);
const AdminZeusVsHadesRtpPage = lazy(() =>
  import("./admin/AdminZeusVsHadesRtpPage").then((m) => ({ default: m.AdminZeusVsHadesRtpPage }))
);
const AdminTopDollarRtpPage = lazy(() =>
  import("./admin/AdminTopDollarRtpPage").then((m) => ({ default: m.AdminTopDollarRtpPage }))
);
const AdminLiveFeedPage = lazy(() =>
  import("./admin/AdminLiveFeedPage").then((m) => ({ default: m.AdminLiveFeedPage }))
);

// Ported from a separate project (GameFun) — each brings its own full-bleed header/chrome, so
// they're excluded from the global Navbar below, same as /games/*.
const Home1Page = lazy(() => import("./pages/homepages/Home1/Home1Page").then((m) => ({ default: m.Home1Page })));
const Home2Page = lazy(() => import("./pages/homepages/Home2/Home2Page").then((m) => ({ default: m.Home2Page })));
const Home3Page = lazy(() => import("./pages/homepages/Home3/Home3Page").then((m) => ({ default: m.Home3Page })));

function AdminFallback() {
  return <div className="p-8 text-center text-slate-500">Loading admin panel...</div>;
}

function AppShell() {
  const location = useLocation();
  const inAdmin = location.pathname.startsWith("/admin");
  const { user } = useAuth();
  const { maintenance, geoBlocked, ready: maintenanceKnown } = useMaintenance();
  const isAdmin = user?.role === "admin";
  // Maintenance mode (admin dashboard): everyone except admins gets the maintenance page — on every
  // URL, instead of the whole site. /login stays reachable so an admin can sign in; /admin itself
  // redirects non-admins (RequireAdmin) and so lands here too.
  if (!maintenanceKnown) return null; // one quick status request — nothing is routed before it answers
  // Country block (admin dashboard): visitors from a blocked country get the "not available in your
  // region" page on every URL — /login stays reachable so an admin can still sign in.
  if (geoBlocked && !isAdmin && location.pathname !== "/login") {
    return <RegionBlockedPage />;
  }
  if (maintenance && !isAdmin && location.pathname !== "/login") {
    return <MaintenancePage />;
  }
  // "/" (HomePage) has its own complete chrome (Sidebar + TopBar, both already mobile-responsive
  // and already showing the same balance/account/logo Navbar would) — stacking Navbar on top of
  // that duplicated the balance pill and, since Navbar itself never wraps/shrinks, forced the
  // whole page wider than the viewport on narrow screens.
  const hideNavbar =
    location.pathname === "/" ||
    location.pathname.startsWith("/games/") ||
    ["/home1", "/home2", "/home3"].includes(location.pathname);

  return (
    <>
      {!hideNavbar && <Navbar />}
      {/* admins browsing the site while it's in maintenance: a small reminder that players can't get in */}
      {maintenance && isAdmin && !inAdmin && (
        <a
          href="/admin"
          className="fixed bottom-3 left-3 z-[60] rounded-full bg-red-600/90 px-3 py-1.5 text-xs font-bold text-white shadow-lg"
        >
          Maintenance mode ON — players see the maintenance page
        </a>
      )}
      {/* full screen on phones / tablets (tap anywhere on Android/iPad, Home Screen guide on iPhone) */}
      <FullscreenHelper />
      {/* iPhone / iPad (any browser) and Android Chrome, every page except admin: "Please rotate your
          phone" when upright (pure CSS — hides the instant the device is turned) and full screen in
          landscape (each platform its own way) */}
      {USES_ROTATE_SCREEN && !inAdmin && <RotatePhone touchPortraitOnly />}
      {IS_IOS && !inAdmin && <IOSFullscreen />}
      {IS_ANDROID_CHROME && !inAdmin && <AndroidChromeFullscreen />}
      <Routes>
          <Route path="/" element={<Home2Page />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/home1"
            element={
              <Suspense fallback={null}>
                <Home1Page />
              </Suspense>
            }
          />
          <Route
            path="/home2"
            element={
              <Suspense fallback={null}>
                <Home2Page />
              </Suspense>
            }
          />
          <Route
            path="/home3"
            element={
              <Suspense fallback={null}>
                <Home3Page />
              </Suspense>
            }
          />
          <Route
            path="/panel"
            element={
              <ProtectedRoute>
                <UserPanelPage />
              </ProtectedRoute>
            }
          />
          {/* Rendered directly rather than via GamePage (which resolves its game from a ":slug"
              route param this literal path doesn't have) — but protected like every other game,
              since every hit now spends the player's real balance. */}
          <Route
            path="/games/fish-game"
            element={
              <ProtectedRoute>
                <FishGameGame />
              </ProtectedRoute>
            }
          />
          <Route
            path="/games/:slug"
            element={
              <ProtectedRoute>
                <GamePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <Suspense fallback={<AdminFallback />}>
                  <AdminLayout />
                </Suspense>
              </RequireAdmin>
            }
          >
            <Route
              index
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminOverviewPage />
                </Suspense>
              }
            />
            <Route
              path="earnings"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminEarningsPage />
                </Suspense>
              }
            />
            <Route
              path="users"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminUsersPage />
                </Suspense>
              }
            />
            <Route
              path="users/:id"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminPlayerDetailPage />
                </Suspense>
              }
            />
            <Route
              path="balance-report"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminBalanceReportPage />
                </Suspense>
              }
            />
            <Route
              path="force-outcome"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminForceOutcomePage />
                </Suspense>
              }
            />
            <Route
              path="rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminRtpPage />
                </Suspense>
              }
            />
            <Route
              path="buffalo-rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminBuffaloRtpPage />
                </Suspense>
              }
            />
            <Route
              path="fish-game"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminFishGamePage />
                </Suspense>
              }
            />
            <Route
              path="sizzling-rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminSizzlingRtpPage />
                </Suspense>
              }
            />
            <Route
              path="life-of-luxury-rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminLifeOfLuxuryRtpPage />
                </Suspense>
              }
            />
            <Route
              path="the-finer-thing-rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminTheFinerThingRtpPage />
                </Suspense>
              }
            />
            <Route
              path="shamrock-rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminShamrockRtpPage />
                </Suspense>
              }
            />
            <Route
              path="crazy777-rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminCrazy777RtpPage />
                </Suspense>
              }
            />
            <Route
              path="5x-rewind-rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminFiveXRtpPage />
                </Suspense>
              }
            />
            <Route
              path="cash-machine-rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminCashMachineRtpPage />
                </Suspense>
              }
            />
            <Route
              path="crystal-clover-rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminCrystalCloverRtpPage />
                </Suspense>
              }
            />
            <Route
              path="fruity-777-rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminFruity777RtpPage />
                </Suspense>
              }
            />
            <Route
              path="gems-deluxe-rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminGemsDeluxeRtpPage />
                </Suspense>
              }
            />
            <Route
              path="mega-10x-pay-rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminMega10XPayRtpPage />
                </Suspense>
              }
            />
            <Route
              path="rubber-duck-rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminRubberDuckRtpPage />
                </Suspense>
              }
            />
            <Route
              path="vegas-hits-rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminVegasHitsRtpPage />
                </Suspense>
              }
            />
            <Route
              path="top-dollar-rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminTopDollarRtpPage />
                </Suspense>
              }
            />
            <Route
              path="zeus-vs-hades-rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminZeusVsHadesRtpPage />
                </Suspense>
              }
            />
            <Route
              path="keno-rtp"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminKenoRtpPage />
                </Suspense>
              }
            />
            <Route
              path="jackpot"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminJackpotPage />
                </Suspense>
              }
            />
            <Route
              path="lobby-games"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminLobbyGamesPage />
                </Suspense>
              }
            />
            <Route
              path="live-feed"
              element={
                <Suspense fallback={<AdminFallback />}>
                  <AdminLiveFeedPage />
                </Suspense>
              }
            />
          </Route>
      </Routes>
    </>
  );
}

export function App() {
  return (
    <AuthProvider>
      <MaintenanceProvider>
        <BrowserRouter>
          <AppShell />
        </BrowserRouter>
      </MaintenanceProvider>
    </AuthProvider>
  );
}
