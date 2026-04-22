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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const operationsItems = [
  { title: "Dashboard", icon: LayoutDashboard, href: "/" },
  { title: "Farmers", icon: Users, href: "/farmers" },
  { title: "Groups", icon: UsersRound, href: "/groups" },
  { title: "Commodities", icon: Leaf, href: "/commodities" },
  { title: "Processes", icon: Cog, href: "/processes" },
  { title: "Samples", icon: TestTube, href: "/samples" },
  { title: "Procurement", icon: Tractor, href: "/procurement" },
  { title: "Procurement Contracts", icon: Tractor, href: "/procurement/contracts" },
  { title: "Procurement Workflows", icon: Tractor, href: "/procurement/workflows" },
  { title: "Warehouse", icon: Warehouse, href: "/warehouse" },
  { title: "Payments", icon: CreditCard, href: "/payments" },
  { title: "Compliance", icon: ShieldCheck, href: "/compliance" },
  { title: "Surveys", icon: ClipboardCheck, href: "/surveys" },
  { title: "Plot Map (GIS)", icon: MapIcon, href: "/plots-map" },
  { title: "Exports", icon: Ship, href: "/exports" },
];

const financeItems = [
  { title: "Loans", icon: Landmark, href: "/loans" },
  { title: "Buyers", icon: Globe, href: "/buyers" },
  { title: "Sales & Exit", icon: FileBarChart2, href: "/sales" },
];

const systemItems = [
  { title: "Staff", icon: Users, href: "/staff" },
  { title: "Assets", icon: Package, href: "/assets" },
  { title: "Activity Funds", icon: Wallet, href: "/activity-funds" },
  { title: "Audit Log", icon: Shield, href: "/audit" },
  { title: "Admin", icon: Settings, href: "/admin" },
];

function NavGroup({ label, items, location }: { label: string; items: typeof operationsItems; location: string }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
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
