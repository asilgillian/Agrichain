import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Users, 
  Tractor, 
  Leaf,
  Warehouse, 
  CreditCard, 
  ShieldCheck, 
  ClipboardCheck, 
  Ship, 
  Settings,
  Cog,
  UsersRound,
  Package,
  Wallet,
  Shield,
  Landmark,
  Globe,
  FileBarChart2,
  Building2,
  Map as MapIcon,
  TestTube,
} from "lucide-react";
import { 
  Sidebar, 
  SidebarContent, 
  SidebarGroup, 
  SidebarGroupContent, 
  SidebarGroupLabel, 
  SidebarMenu, 
  SidebarMenuButton, 
  SidebarMenuItem, 
  SidebarProvider,
  SidebarTrigger,
  SidebarHeader
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useUser, useClerk } from "@clerk/react";
import { LogOut } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Each nav item declares the permission(s) needed to see it. `requiredAny` means the user must
// hold ≥1 of the listed keys; an item with no requirement is always visible (e.g. Dashboard).
// "*" is granted by default to SystemAdministrator and bypasses every check inside usePermissions.
type NavItem = {
  title: string;
  icon: typeof LayoutDashboard;
  href: string;
  requiredAny?: string[];
};

const operationsItems: NavItem[] = [
  { title: "Dashboard", icon: LayoutDashboard, href: "/" },
  { title: "Farmers", icon: Users, href: "/farmers", requiredAny: ["farmers.read", "farmers.preregister", "farmers.register"] },
  { title: "Groups", icon: UsersRound, href: "/groups", requiredAny: ["groups.read"] },
  { title: "Commodities", icon: Leaf, href: "/commodities", requiredAny: ["commodities.read"] },
  { title: "Processes", icon: Cog, href: "/processes", requiredAny: ["procurement.read"] },
  { title: "Samples", icon: TestTube, href: "/samples", requiredAny: ["procurement.qc.submit", "procurement.read"] },
  { title: "Procurement", icon: Tractor, href: "/procurement", requiredAny: ["procurement.read"] },
  { title: "Procurement Contracts", icon: Tractor, href: "/procurement/contracts", requiredAny: ["procurement.contracts.read"] },
  { title: "Procurement Workflows", icon: Tractor, href: "/procurement/workflows", requiredAny: ["admin.workflows.write", "procurement.read"] },
  { title: "Warehouse", icon: Warehouse, href: "/warehouse", requiredAny: ["warehouse.read"] },
  { title: "Payments", icon: CreditCard, href: "/payments", requiredAny: ["payments.read"] },
  { title: "Compliance", icon: ShieldCheck, href: "/compliance", requiredAny: ["compliance.read"] },
  { title: "Surveys", icon: ClipboardCheck, href: "/surveys", requiredAny: ["surveys.read"] },
  { title: "Plot Map (GIS)", icon: MapIcon, href: "/plots-map", requiredAny: ["plots.read", "plots.gps_map"] },
  { title: "Exports", icon: Ship, href: "/exports", requiredAny: ["exports.read"] },
];

const financeItems: NavItem[] = [
  { title: "Loans", icon: Landmark, href: "/loans", requiredAny: ["loans.read"] },
  { title: "Buyers", icon: Globe, href: "/buyers", requiredAny: ["sales.read"] },
  { title: "Sales & Exit", icon: FileBarChart2, href: "/sales", requiredAny: ["sales.read"] },
];

const systemItems: NavItem[] = [
  { title: "Staff", icon: Users, href: "/staff", requiredAny: ["users.read"] },
  { title: "Assets", icon: Package, href: "/assets", requiredAny: ["assets.read"] },
  { title: "Activity Funds", icon: Wallet, href: "/activity-funds", requiredAny: ["activity_funds.read"] },
  { title: "Audit Log", icon: Shield, href: "/audit", requiredAny: ["audit.read"] },
  { title: "Admin", icon: Settings, href: "/admin", requiredAny: ["admin.roles", "admin.regions", "admin.hierarchy", "admin.bulk_upload"] },
];

function NavGroup({ label, items, location }: { label: string; items: NavItem[]; location: string }) {
  const { hasAny, isLoading } = usePermissions();
  // While the permission set is loading we hide everything except items with no requirement,
  // matching the spec: "Toggling a function off ... is simply not visible." We never grey-out.
  const visible = items.filter((item) => !item.requiredAny || (!isLoading && hasAny(item.requiredAny)));
  if (visible.length === 0) return null;
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {visible.map((item) => {
            const isActive = item.href === "/"
              ? location === "/"
              : location === item.href || location.startsWith(item.href + "/");
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
                  <Link href={item.href} className="flex items-center gap-2">
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="p-4 flex items-center justify-between border-b border-sidebar-border">
        <div className="flex items-center gap-2 text-sidebar-primary">
          <Tractor className="h-6 w-6 shrink-0" />
          <div className="flex flex-col leading-tight">
            <span className="font-bold text-sm">MTANDEO</span>
            <span className="text-xs font-medium opacity-75">COMMODITIES LTD</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Operations" items={operationsItems} location={location} />
        <NavGroup label="Finance & Sales" items={financeItems} location={location} />
        <NavGroup label="System" items={systemItems} location={location} />
      </SidebarContent>
    </Sidebar>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="h-12 flex items-center px-4 border-b gap-4 sticky top-0 bg-background z-10">
            <SidebarTrigger />
            <div className="flex-1" />
            <UserMenu />
          </header>
          <main className="flex-1 p-6 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function UserMenu() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const initials = (user?.firstName?.[0] ?? "") + (user?.lastName?.[0] ?? "") || (user?.primaryEmailAddress?.emailAddress?.[0] ?? "U").toUpperCase();
  const display = user?.fullName || user?.primaryEmailAddress?.emailAddress || "User";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 hover-elevate rounded-md p-1" data-testid="user-menu">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs bg-primary text-primary-foreground">{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="font-medium">{display}</div>
          <div className="text-xs text-muted-foreground font-normal">{user?.primaryEmailAddress?.emailAddress}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()} data-testid="sign-out" className="cursor-pointer">
          <LogOut className="h-4 w-4 mr-2" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
