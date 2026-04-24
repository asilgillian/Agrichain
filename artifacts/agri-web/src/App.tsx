import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from "@clerk/react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { shadcn } from "@clerk/themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import { AppLayout } from "@/components/layout/app-layout";

import Dashboard from "@/pages/dashboard/index";
import FarmersList from "@/pages/farmers/index";
import FarmerDetail from "@/pages/farmers/detail";
import FarmerDuplicates from "@/pages/farmers/duplicates";
import FarmerPreregisterPage from "@/pages/farmers/preregister";
import GroupsList from "@/pages/groups/index";
import GroupDetail from "@/pages/groups/detail";
import ProcurementHub from "@/pages/procurement/index";
import DeliveryDetail from "@/pages/procurement/detail";
import ProcurementContracts from "@/pages/procurement/contracts";
import ProcurementWorkflows from "@/pages/procurement/workflows";
import ProcurementWorkflowDetail from "@/pages/procurement/workflow-detail";
import WarehousePage from "@/pages/warehouse/index";
import LotDetail from "@/pages/warehouse/detail";
import PaymentsPage from "@/pages/payments/index";
import CompliancePage from "@/pages/compliance/index";
import SurveysPage from "@/pages/surveys/index";
import ExportsPage from "@/pages/exports/index";
import LoansPage from "@/pages/loans/index";
import LoanDetail from "@/pages/loans/detail";
import BuyersPage from "@/pages/buyers/index";
import SalesPage from "@/pages/sales/index";
import SalesContractDetail from "@/pages/sales/detail";
import StaffPage from "@/pages/staff/index";
import AssetsPage from "@/pages/assets/index";
import ActivityFundsPage from "@/pages/activity-funds/index";
import AuditPage from "@/pages/audit/index";
import AdminPage from "@/pages/admin/index";
import PlotsMapPage from "@/pages/plots-map/index";
import CommoditiesPage from "@/pages/commodities/index";
import ProcessesPage from "@/pages/processes/index";
import SamplesPage from "@/pages/samples/index";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function stripBase(p: string): string {
  return basePath && p.startsWith(basePath) ? p.slice(basePath.length) || "/" : p;
}

if (!clerkPubKey) throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: typeof window !== "undefined" ? `${window.location.origin}${basePath}/logo.svg` : "",
  },
  variables: {
    colorPrimary: "hsl(142 71% 30%)",
    colorForeground: "hsl(220 13% 18%)",
    colorMutedForeground: "hsl(220 9% 46%)",
    colorDanger: "hsl(0 72% 51%)",
    colorBackground: "hsl(0 0% 100%)",
    colorInput: "hsl(0 0% 100%)",
    colorInputForeground: "hsl(220 13% 18%)",
    colorNeutral: "hsl(220 13% 91%)",
    colorModalBackdrop: "rgba(0,0,0,0.5)",
    fontFamily: "system-ui, -apple-system, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl border border-gray-200",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-gray-900 text-2xl font-bold",
    headerSubtitle: "text-gray-600",
    socialButtonsBlockButtonText: "text-gray-900 font-medium",
    formFieldLabel: "text-gray-900 font-medium",
    footerActionLink: "text-emerald-700 font-medium hover:text-emerald-800",
    footerActionText: "text-gray-600",
    dividerText: "text-gray-500",
    identityPreviewEditButton: "text-emerald-700",
    formFieldSuccessText: "text-emerald-700",
    alertText: "text-red-700",
    logoBox: "justify-center mb-4",
    logoImage: "h-10",
    socialButtonsBlockButton: "border border-gray-300 hover:bg-gray-50",
    formButtonPrimary: "bg-emerald-700 hover:bg-emerald-800 text-white",
    formFieldInput: "border-gray-300 focus:border-emerald-600 focus:ring-emerald-600",
    footerAction: "text-center",
    dividerLine: "bg-gray-200",
    alert: "border-red-200 bg-red-50",
    otpCodeFieldInput: "border-gray-300",
    formFieldRow: "",
    main: "",
  },
};

function SignInPage() {
  // To update login providers, app branding, or OAuth settings use the Auth
  // pane in the workspace toolbar. More information can be found in the Replit docs.
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-emerald-50 to-lime-50 px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  // To update login providers, app branding, or OAuth settings use the Auth
  // pane in the workspace toolbar. More information can be found in the Replit docs.
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-emerald-50 to-lime-50 px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/dashboard" /></Show>
      <Show when="signed-out"><Landing /></Show>
    </>
  );
}

function ProtectedRoutes() {
  return (
    <>
      <Show when="signed-in">
        <AppLayout>
          <Switch>
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/farmers/duplicates" component={FarmerDuplicates} />
            <Route path="/farmers/preregister" component={FarmerPreregisterPage} />
            <Route path="/farmers/:id" component={FarmerDetail} />
            <Route path="/farmers" component={FarmersList} />
            <Route path="/groups/:id" component={GroupDetail} />
            <Route path="/groups" component={GroupsList} />
            <Route path="/procurement/contracts" component={ProcurementContracts} />
            <Route path="/procurement/workflows" component={ProcurementWorkflows} />
            <Route path="/procurement/workflows/:id" component={ProcurementWorkflowDetail} />
            <Route path="/procurement/:id" component={DeliveryDetail} />
            <Route path="/procurement" component={ProcurementHub} />
            <Route path="/warehouse/:id" component={LotDetail} />
            <Route path="/warehouse" component={WarehousePage} />
            <Route path="/payments" component={PaymentsPage} />
            <Route path="/compliance" component={CompliancePage} />
            <Route path="/surveys" component={SurveysPage} />
            <Route path="/exports" component={ExportsPage} />
            <Route path="/loans/:id" component={LoanDetail} />
            <Route path="/loans" component={LoansPage} />
            <Route path="/buyers" component={BuyersPage} />
            <Route path="/sales/:id" component={SalesContractDetail} />
            <Route path="/sales" component={SalesPage} />
            <Route path="/staff" component={StaffPage} />
            <Route path="/assets" component={AssetsPage} />
            <Route path="/activity-funds" component={ActivityFundsPage} />
            <Route path="/audit" component={AuditPage} />
            <Route path="/admin" component={AdminPage} />
            <Route path="/plots-map" component={PlotsMapPage} />
            <Route path="/commodities" component={CommoditiesPage} />
            <Route path="/processes" component={ProcessesPage} />
            <Route path="/samples" component={SamplesPage} />
            <Route component={NotFound} />
          </Switch>
        </AppLayout>
      </Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function ClerkApiTokenBridge() {
  const { getToken, isLoaded } = useAuth();
  useEffect(() => {
    if (!isLoaded) return;
    setAuthTokenGetter(async () => {
      try { return await getToken(); } catch { return null; }
    });
    return () => setAuthTokenGetter(null);
  }, [isLoaded, getToken]);
  return null;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsub = addListener(({ user }) => {
      const id = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== id) qc.clear();
      prevUserIdRef.current = id;
    });
    return unsub;
  }, [addListener, qc]);
  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      localization={{
        signIn: { start: { title: "Welcome back", subtitle: "Sign in to MTANDEO Commodities" } },
        signUp: { start: { title: "Create your account", subtitle: "Join the MTANDEO platform" } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkApiTokenBridge />
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route component={ProtectedRoutes} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
