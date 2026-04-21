import { useListExportContracts, useListShipments } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";

function fmtKg(v?: number | null) {
  if (v == null) return "-";
  return `${Number(v).toLocaleString()} kg`;
}

function fmtUGX(v?: number | null) {
  if (v == null) return "-";
  return new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(Number(v));
}

export default function ExportsPage() {
  const { data: contracts, isLoading: isLoadingContracts } = useListExportContracts();
  const { data: shipments, isLoading: isLoadingShipments } = useListShipments();

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Export Management</h1>
        <p className="text-muted-foreground mt-1">Export contracts, shipments, and documentation</p>
      </div>

      <Tabs defaultValue="contracts">
        <TabsList>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
          <TabsTrigger value="shipments">Shipments</TabsTrigger>
        </TabsList>

        <TabsContent value="contracts" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Export Contracts</CardTitle>
                <Badge variant="secondary">{isLoadingContracts ? "..." : (contracts?.length ?? 0)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contract #</TableHead>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Crop</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Certification</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingContracts ? (
                    <TableRow><TableCell colSpan={7}><Skeleton className="h-12 w-full" /></TableCell></TableRow>
                  ) : contracts && contracts.length > 0 ? contracts.map(c => (
                    <TableRow key={c.id} data-testid={`contract-row-${c.id}`}>
                      <TableCell className="font-mono text-sm font-medium">{c.contractNumber}</TableCell>
                      <TableCell className="font-medium">{c.buyer}</TableCell>
                      <TableCell className="text-muted-foreground">{c.destination}</TableCell>
                      <TableCell className="capitalize">{c.cropType}</TableCell>
                      <TableCell>{fmtKg(c.quantityKg)}</TableCell>
                      <TableCell>{c.certificationRequired ? <Badge variant="outline">{c.certificationRequired}</Badge> : "—"}</TableCell>
                      <TableCell><Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status}</Badge></TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No contracts</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="shipments" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Shipments</CardTitle>
                <Badge variant="secondary">{isLoadingShipments ? "..." : (shipments?.length ?? 0)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Container</TableHead>
                    <TableHead>Vessel</TableHead>
                    <TableHead>Loading Port</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Weight</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingShipments ? (
                    <TableRow><TableCell colSpan={7}><Skeleton className="h-12 w-full" /></TableCell></TableRow>
                  ) : shipments && shipments.length > 0 ? shipments.map(s => (
                    <TableRow key={s.id} data-testid={`shipment-row-${s.id}`}>
                      <TableCell className="font-mono text-sm font-medium">{s.containerNumber ?? "—"}</TableCell>
                      <TableCell>{s.vesselName ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{s.portOfLoading ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{s.portOfDestination ?? "—"}</TableCell>
                      <TableCell>{fmtKg(s.totalWeightKg)}</TableCell>
                      <TableCell><Badge variant="secondary">{s.status}</Badge></TableCell>
                      <TableCell>
                        <Link href={`/exports/${s.id}`}><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No shipments</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
