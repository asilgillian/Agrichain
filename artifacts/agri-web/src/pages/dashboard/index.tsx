import { useGetDashboardSummary, useGetDashboardActivity, useGetComplianceOverview, useGetProcurementStats } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Users, Tractor, AlertTriangle, ShieldCheck, DollarSign, MapPin } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

function formatCurrency(v?: number | null) {
  if (v == null) return "-";
  return new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(v);
}
function formatNumber(v?: number | null) {
  if (v == null) return "-";
  return new Intl.NumberFormat("en").format(Math.round(v * 100) / 100);
}

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: activity, isLoading: isLoadingActivity } = useGetDashboardActivity({ limit: 20 });
  const { data: compliance, isLoading: isLoadingCompliance } = useGetComplianceOverview();
  const { data: procurement, isLoading: isLoadingProcurement } = useGetProcurementStats();

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Platform Overview</h1>
        <p className="text-muted-foreground mt-1">Real-time metrics and system activity</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Farmers" value={summary?.totalFarmers} icon={Users} isLoading={isLoadingSummary} />
        <MetricCard title="Total Area (Ha)" value={summary?.totalAreaHectares} icon={MapPin} isLoading={isLoadingSummary} formatFn={formatNumber} />
        <MetricCard title="Pending Deliveries" value={summary?.pendingDeliveries} icon={Tractor} isLoading={isLoadingSummary} />
        <MetricCard title="Sync Pending" value={summary?.syncPendingCount} icon={AlertTriangle} isLoading={isLoadingSummary} trend={summary && (summary.syncPendingCount ?? 0) > 0 ? "warning" : "good"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest events across the platform</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingActivity ? (
              <div className="space-y-4">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : activity && activity.length > 0 ? (
              <div className="space-y-3">
                {activity.slice(0, 8).map((item) => (
                  <div key={item.id} className="flex items-start gap-4 p-3 rounded-lg border bg-card/50">
                    <div className="mt-0.5">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium leading-none">{item.summary}</p>
                      <div className="flex items-center text-xs text-muted-foreground gap-2">
                        <span>{item.actorName}</span>
                        <span>·</span>
                        <span>{format(new Date(item.timestamp), "MMM d, h:mm a")}</span>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">{item.entityType}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">No recent activity</div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Procurement (This Month)</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingProcurement ? (
                <div className="space-y-4"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-8 w-2/3" /></div>
              ) : procurement ? (
                <div className="space-y-6">
                  <div>
                    <p className="text-sm text-muted-foreground">Monthly Volume</p>
                    <p className="text-2xl font-bold">{formatNumber(procurement.monthlyVolumeKg)} kg</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Value</p>
                    <p className="text-2xl font-bold text-primary">{formatCurrency(procurement.totalValueThisMonth)}</p>
                  </div>
                  <div className="flex justify-between border-t pt-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Pending</p>
                      <p className="font-semibold">{procurement.pendingApprovals}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Rejected</p>
                      <p className="font-semibold text-destructive">{procurement.rejectedDeliveries}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Weekly Vol</p>
                      <p className="font-semibold">{formatNumber(procurement.weeklyVolumeKg)} kg</p>
                    </div>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Compliance Overview</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingCompliance ? (
                <div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
              ) : compliance?.streams && compliance.streams.length > 0 ? (
                <div className="space-y-4">
                  {compliance.streams.map((stream) => (
                    <div key={stream.streamName} className="flex flex-col gap-2 p-3 rounded-lg border">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{stream.streamName}</span>
                        <Badge variant={(stream.complianceRate ?? 0) > 0.9 ? "default" : "secondary"}>
                          {(((stream.complianceRate ?? 0)) * 100).toFixed(1)}%
                        </Badge>
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{stream.compliantFarmers} / {stream.enrolledFarmers} compliant</span>
                        {(stream.expiringIn30Days ?? 0) > 0 && (
                          <span className="text-destructive font-medium">{stream.expiringIn30Days} expiring</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center text-sm text-muted-foreground">No certification streams</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Farmer Groups</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoadingSummary ? <Skeleton className="h-7 w-12" /> : (summary?.totalGroups ?? 0)}</div>
            <p className="text-xs text-muted-foreground mt-1">Active cooperative groups</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><DollarSign className="h-4 w-4" />Payments Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoadingSummary ? <Skeleton className="h-7 w-24" /> : formatCurrency(summary?.totalPaymentsPending)}</div>
            <p className="text-xs text-muted-foreground mt-1">Outstanding farmer payments</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Active Plots</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoadingSummary ? <Skeleton className="h-7 w-12" /> : (summary?.activePlots ?? 0)}</div>
            <p className="text-xs text-muted-foreground mt-1">Mapped cultivation plots</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon: Icon, isLoading, formatFn = (v: any) => String(v), trend }: any) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <div className={`text-2xl font-bold ${trend === "warning" ? "text-destructive" : ""}`}>
            {value !== undefined ? formatFn(value) : "-"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
