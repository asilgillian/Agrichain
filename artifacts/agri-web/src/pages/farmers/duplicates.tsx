import { useListDuplicateFarmers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ArrowLeft, AlertTriangle, ArrowRight } from "lucide-react";

export default function DuplicatesPage() {
  const { data: pairs, isLoading } = useListDuplicateFarmers();

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center gap-3">
        <Link href="/farmers"><ArrowLeft className="h-5 w-5 text-muted-foreground cursor-pointer hover:text-foreground" /></Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Duplicate Management</h1>
          <p className="text-muted-foreground mt-1">Flagged duplicate farmer records for review and merge</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">{[1, 2].map(i => <Skeleton key={i} className="h-32 w-full" />)}</div>
      ) : !pairs || pairs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-green-600" />
              </div>
              <p className="font-medium">No duplicates detected</p>
              <p className="text-muted-foreground text-sm">All farmer records appear to be unique</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {pairs.map((pair: any) => (
            <Card key={pair.id} className="border-amber-200 dark:border-amber-900" data-testid={`duplicate-pair-${pair.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <CardTitle className="text-base">Potential Duplicate</CardTitle>
                  </div>
                  <div className="flex gap-2">
                    {pair.matchReasons?.map((r: string) => <Badge key={r} variant="secondary" className="text-xs">{r.replace(/_/g, " ")}</Badge>)}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-6">
                  <div className="p-3 border rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Record A</p>
                    <p className="font-semibold">{pair.farmer1?.firstName} {pair.farmer1?.lastName}</p>
                    <p className="text-sm text-muted-foreground">{pair.farmer1?.referenceNumber}</p>
                    <p className="text-sm text-muted-foreground">ID: {pair.farmer1?.nationalId ?? "—"}</p>
                  </div>
                  <div className="p-3 border rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Record B</p>
                    <p className="font-semibold">{pair.farmer2?.firstName} {pair.farmer2?.lastName}</p>
                    <p className="text-sm text-muted-foreground">{pair.farmer2?.referenceNumber}</p>
                    <p className="text-sm text-muted-foreground">ID: {pair.farmer2?.nationalId ?? "—"}</p>
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <Button variant="outline" size="sm" className="flex-1" data-testid={`keep-a-btn-${pair.id}`}>Keep Record A</Button>
                  <ArrowRight className="h-4 w-4 self-center text-muted-foreground" />
                  <Button variant="outline" size="sm" className="flex-1" data-testid={`keep-b-btn-${pair.id}`}>Keep Record B</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
