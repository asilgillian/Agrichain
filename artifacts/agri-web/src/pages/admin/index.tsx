import { useListRegions, useListRoles, useListSyncQueue } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, RefreshCw, MapPin } from "lucide-react";

export default function AdminPage() {
  const { data: regions, isLoading: isLoadingRegions } = useListRegions();
  const { data: roles, isLoading: isLoadingRoles } = useListRoles();
  const { data: syncQueue, isLoading: isLoadingSyncQueue } = useListSyncQueue();

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System Administration</h1>
          <p className="text-muted-foreground mt-1">Regions, roles, and sync queue</p>
        </div>
      </div>

      <Tabs defaultValue="regions">
        <TabsList>
          <TabsTrigger value="regions">Regions</TabsTrigger>
          <TabsTrigger value="roles">Roles &amp; Permissions</TabsTrigger>
          <TabsTrigger value="sync">Sync Queue</TabsTrigger>
        </TabsList>

        <TabsContent value="regions" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <CardTitle>Regions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Country</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingRegions ? (
                    [1, 2].map(i => <TableRow key={i}><TableCell colSpan={3}><Skeleton className="h-10 w-full" /></TableCell></TableRow>)
                  ) : regions && regions.length > 0 ? regions.map((r: any) => (
                    <TableRow key={r.id} data-testid={`region-row-${r.id}`}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>{r.level}</TableCell>
                      <TableCell>{r.countryCode}</TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">No regions configured</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Role Permissions</CardTitle></CardHeader>
            <CardContent>
              {isLoadingRoles ? <Skeleton className="h-40 w-full" /> : (
                <div className="space-y-4">
                  {roles && roles.map((role: any) => (
                    <div key={role.id} className="p-4 border rounded-lg" data-testid={`role-row-${role.id}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold">{role.name}</span>
                        <Badge variant="outline">{role.permissions?.length ?? 0} permissions</Badge>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {role.permissions?.map((p: string) => (
                          <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
              <CardTitle>Mobile Sync Queue</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingSyncQueue ? <Skeleton className="h-20 w-full" /> : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div><p className="text-xs text-muted-foreground">Pending Records</p><p className="text-2xl font-bold">{(syncQueue as any)?.pendingRecords ?? 0}</p></div>
                  <div><p className="text-xs text-muted-foreground">Failed Records</p><p className={`text-2xl font-bold ${((syncQueue as any)?.failedRecords ?? 0) > 0 ? "text-destructive" : ""}`}>{(syncQueue as any)?.failedRecords ?? 0}</p></div>
                  <div className="col-span-2"><p className="text-xs text-muted-foreground">Last Sync</p><p className="text-sm font-medium mt-1">{(syncQueue as any)?.lastSyncAt ? new Date((syncQueue as any).lastSyncAt).toLocaleString() : "—"}</p></div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
