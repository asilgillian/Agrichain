import { useRoute } from "wouter";
import { useGetDelivery, useRecordDeliveryWeight, useRecordDeliveryQC, useSubmitDeliveryPricing, useApproveDelivery } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, CheckCircle, Circle, Lock } from "lucide-react";

function Step({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {done ? <CheckCircle className="h-4 w-4 text-green-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
      <span className={done ? "text-foreground font-medium" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}

export default function DeliveryDetail() {
  const [, params] = useRoute("/procurement/:id");
  const id = params?.id ?? "";
  const { data: delivery, isLoading, refetch } = useGetDelivery(id, { query: { enabled: !!id } });

  const weightMut = useRecordDeliveryWeight();
  const qcMut = useRecordDeliveryQC();
  const pricingMut = useSubmitDeliveryPricing();
  const approveMut = useApproveDelivery();

  const [gross, setGross] = useState("");
  const [tare, setTare] = useState("");
  const [moisture, setMoisture] = useState("");
  const [defects, setDefects] = useState("");
  const [cupScore, setCupScore] = useState("");
  const [price, setPrice] = useState("");

  if (isLoading) return <div className="space-y-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  if (!delivery) return <div className="py-16 text-center text-muted-foreground">Delivery not found</div>;

  const canPrice = (delivery.weightApproved ?? false) && (delivery.qcApproved ?? false);

  async function handleWeight() {
    await weightMut.mutateAsync({ deliveryId: id, data: { grossWeightKg: Number(gross), tareWeightKg: Number(tare) } });
    refetch();
  }

  async function handleQC() {
    await qcMut.mutateAsync({ deliveryId: id, data: { moistureContent: Number(moisture), defectCount: Number(defects), cupScore: cupScore ? Number(cupScore) : undefined } });
    refetch();
  }

  async function handlePricing() {
    await pricingMut.mutateAsync({ deliveryId: id, data: { pricePerKg: Number(price) } });
    refetch();
  }

  async function handleApprove(decision: "approved" | "rejected") {
    await approveMut.mutateAsync({ deliveryId: id, data: { decision, comment: "" } });
    refetch();
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <div className="flex items-center gap-3">
        <Link href="/procurement"><ArrowLeft className="h-5 w-5 text-muted-foreground cursor-pointer hover:text-foreground" /></Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-mono">{delivery.lotTag}</h1>
          <p className="text-muted-foreground mt-1">Delivery detail and approval workflow</p>
        </div>
      </div>

      <div className="flex items-center gap-6 p-4 bg-muted/30 rounded-lg border">
        <Step label="Weight Recorded" done={delivery.weightApproved ?? false} />
        <div className="h-px flex-1 bg-border" />
        <Step label="QC Approved" done={delivery.qcApproved ?? false} />
        <div className="h-px flex-1 bg-border" />
        <Step label="Pricing Set" done={!!(delivery.pricePerKg)} />
        <div className="h-px flex-1 bg-border" />
        <Step label="Final Approval" done={delivery.status === "approved"} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Weight Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {delivery.weightApproved ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Gross Weight</span><span className="font-medium">{delivery.grossWeightKg} kg</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Tare Weight</span><span className="font-medium">{delivery.tareWeightKg} kg</span></div>
                <div className="flex justify-between border-t pt-2"><span className="text-muted-foreground font-medium">Net Weight</span><span className="font-bold text-lg">{delivery.netWeightKg} kg</span></div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Gross (kg)</Label><Input value={gross} onChange={e => setGross(e.target.value)} placeholder="0.0" data-testid="gross-weight-input" /></div>
                  <div><Label>Tare (kg)</Label><Input value={tare} onChange={e => setTare(e.target.value)} placeholder="0.0" data-testid="tare-weight-input" /></div>
                </div>
                <Button onClick={handleWeight} disabled={weightMut.isPending || !gross || !tare} className="w-full" data-testid="record-weight-btn">
                  {weightMut.isPending ? "Recording..." : "Record Weight"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">QC Results</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {delivery.qcApproved ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Moisture Content</span><span className="font-medium">{delivery.moistureContent}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Defect Count</span><span className="font-medium">{delivery.defectCount}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Cup Score</span><span className="font-medium">{delivery.cupScore ?? "—"}</span></div>
                <div className="flex justify-between border-t pt-2"><span className="text-muted-foreground font-medium">Grade</span><span className="font-bold text-lg">{delivery.grade}</span></div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Moisture %</Label><Input value={moisture} onChange={e => setMoisture(e.target.value)} placeholder="0.0" data-testid="moisture-input" /></div>
                  <div><Label>Defect Count</Label><Input value={defects} onChange={e => setDefects(e.target.value)} placeholder="0" data-testid="defects-input" /></div>
                </div>
                <div><Label>Cup Score (opt.)</Label><Input value={cupScore} onChange={e => setCupScore(e.target.value)} placeholder="0-100" data-testid="cupscore-input" /></div>
                <Button onClick={handleQC} disabled={qcMut.isPending || !delivery.weightApproved || !moisture || !defects} className="w-full" data-testid="record-qc-btn">
                  {qcMut.isPending ? "Recording..." : "Record QC"}
                </Button>
                {!delivery.weightApproved && <p className="text-xs text-muted-foreground text-center">Weight must be recorded first</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Pricing
            {!canPrice && <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground"><Lock className="h-3 w-3" />Requires weight + QC approval</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!canPrice ? (
            <div className="py-4 text-center text-muted-foreground text-sm">Complete weight and QC steps to unlock pricing</div>
          ) : delivery.pricePerKg != null ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Price per kg</span><span className="font-medium">UGX {Number(delivery.pricePerKg).toLocaleString()}</span></div>
              <div className="flex justify-between border-t pt-2"><span className="text-muted-foreground font-medium">Total Value</span><span className="font-bold text-xl text-primary">UGX {Number(delivery.totalValue).toLocaleString()}</span></div>
            </div>
          ) : (
            <div className="flex items-end gap-3">
              <div className="flex-1"><Label>Price per kg (UGX)</Label><Input value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" data-testid="price-input" /></div>
              <Button onClick={handlePricing} disabled={pricingMut.isPending || !price} data-testid="submit-pricing-btn">
                {pricingMut.isPending ? "Submitting..." : "Set Price"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {delivery.status === "pending_approval" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Final Approval</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <Button onClick={() => handleApprove("approved")} disabled={approveMut.isPending} className="flex-1" data-testid="approve-btn">
                {approveMut.isPending ? "Processing..." : "Approve Delivery"}
              </Button>
              <Button variant="destructive" onClick={() => handleApprove("rejected")} disabled={approveMut.isPending} className="flex-1" data-testid="reject-btn">
                Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {delivery.status && ["approved", "rejected"].includes(delivery.status) && (
        <div className={`p-4 rounded-lg border text-center font-medium ${delivery.status === "approved" ? "border-green-600 text-green-600 bg-green-50 dark:bg-green-950" : "border-destructive text-destructive bg-destructive/10"}`}>
          This delivery has been {delivery.status.toUpperCase()}
        </div>
      )}
    </div>
  );
}
