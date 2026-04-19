import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/app-layout";

import Dashboard from "@/pages/dashboard/index";
import FarmersList from "@/pages/farmers/index";
import FarmerDetail from "@/pages/farmers/detail";
import FarmerDuplicates from "@/pages/farmers/duplicates";
import GroupsList from "@/pages/groups/index";
import GroupDetail from "@/pages/groups/detail";
import ProcurementHub from "@/pages/procurement/index";
import DeliveryDetail from "@/pages/procurement/detail";
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/farmers/duplicates" component={FarmerDuplicates} />
        <Route path="/farmers/:id" component={FarmerDetail} />
        <Route path="/farmers" component={FarmersList} />
        <Route path="/groups/:id" component={GroupDetail} />
        <Route path="/groups" component={GroupsList} />
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
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
