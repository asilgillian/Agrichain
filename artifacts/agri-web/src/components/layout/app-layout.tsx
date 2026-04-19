import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Users, 
  Tractor, 
  Warehouse, 
  CreditCard, 
  ShieldCheck, 
  ClipboardCheck, 
  Ship, 
  Settings,
  UsersRound,
  Package,
  Wallet,
  Shield
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

const navItems = [
  { title: "Dashboard", icon: LayoutDashboard, href: "/" },
  { title: "Farmers", icon: Users, href: "/farmers" },
  { title: "Groups", icon: UsersRound, href: "/groups" },
  { title: "Procurement", icon: Tractor, href: "/procurement" },
  { title: "Warehouse", icon: Warehouse, href: "/warehouse" },
  { title: "Payments", icon: CreditCard, href: "/payments" },
  { title: "Compliance", icon: ShieldCheck, href: "/compliance" },
  { title: "Surveys", icon: ClipboardCheck, href: "/surveys" },
  { title: "Exports", icon: Ship, href: "/exports" },
];

const adminItems = [
  { title: "Staff", icon: Users, href: "/staff" },
  { title: "Assets", icon: Package, href: "/assets" },
  { title: "Activity Funds", icon: Wallet, href: "/activity-funds" },
  { title: "Audit Log", icon: Shield, href: "/audit" },
  { title: "Admin", icon: Settings, href: "/admin" },
];

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
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === item.href || (location.startsWith(item.href) && item.href !== "/")}
                    tooltip={item.title}
                  >
                    <Link href={item.href} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location.startsWith(item.href)}
                    tooltip={item.title}
                  >
                    <Link href={item.href} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <AppSidebar />
        
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="h-14 flex items-center justify-between px-4 border-b bg-card">
            <div className="flex items-center gap-4">
              <SidebarTrigger />
              {/* Could add breadcrumbs here */}
            </div>
            
            <div className="flex items-center gap-4">
              <Avatar className="h-8 w-8 bg-primary">
                <AvatarFallback className="text-primary-foreground text-xs">AC</AvatarFallback>
              </Avatar>
            </div>
          </header>
          
          <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
