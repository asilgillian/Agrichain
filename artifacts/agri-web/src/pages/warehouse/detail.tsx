import { useRoute, Link } from "wouter";
import { useGetLot, getGetLotQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { format } from "date-fns";

export default function LotDetail() {
  const [, params] = useRoute("/warehouse/:id");
  const id = params?.id ?? "";
  const { data: lot, isLoading } = useGetLot(id, { query: { enabled: !!id, queryKey: getGetLotQueryKey(id) } });

  if (isLoading) return <div className="space-y-4">{[1, 2].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  if (!lot) return <div className="py-16 text-center text-muted-foreground">Lot not found</div>;

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <div className="flex items-center gap-3">
        <Link href="/warehouse"><ArrowLeft className="h-5 w-5 text-muted-foreground cursor-pointer hover:text-foreground" /></Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-mono">{lot.lotTag}</h1>
          <p className="text-muted-foreground mt-1">Lot chain of custody and stream identity</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Weight</CardTitle></CardHeader><CardContent><div className="text-xl font-bold">{Number(lot.weightKg).toLocaleString()} kg</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Silo</CardTitle></CardHeader><CardContent><div className="text-xl font-bold">{lot.siloId ?? "—"}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Status</CardTitle></CardHeader><CardContent><Badge>{lot.status}</Badge></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Received</CardTitle></CardHeader><CardContent><div className="text-sm font-medium">{format(new Date(lot.receivedAt), "MMM d, yyyy")}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Certification Streams</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">
            {lot.certificationStreams?.length > 0 ? lot.certificationStreams.map((s: string) => <Badge key={s} className="text-sm">{s}</Badge>) : <span className="text-muted-foreground">No streams</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Chain of Custody</CardTitle></CardHeader>
        <CardContent>
          {lot.chainOfCustody && lot.chainOfCustody.length > 0 ? (
            <div className="space-y-3">
              {lot.chainOfCustody.map((step: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-3 border rounded-lg">
                  <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">{i + 1}</div>
                  <div>
                    <p className="font-medium text-sm">{step.step}</p>
                    <p className="text-xs text-muted-foreground">{step.actor} · {format(new Date(step.timestamp), "MMM d, yyyy h:mm a")}</p>
                    {step.notes && <p className="text-xs text-muted-foreground mt-1">{step.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-muted-foreground text-sm">No custody records</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
