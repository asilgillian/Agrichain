import { useRoute, Link } from "wouter";
import {
  useGetDelivery,
  useSubmitDeliveryWeight,
  useApproveDeliveryWeight,
  useSubmitDeliveryQc,
  useApproveDeliveryQc,
  useProposeDeliveryPricing,
  useApproveDeliveryPricing,
  useRejectDelivery,
  useResumeDelivery,
  customFetch,
} from "@workspace/api-client-react";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, CheckCircle2, Circle, Lock, ShieldAlert, UserCheck, RefreshCw, RotateCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const statusLabels: Record<string, string> = {
  pending_weight_submit: "Awaiting weight entry",
  pending_weight_approve: "Awaiting weight approval",
  pending_qc_submit: "Awaiting QC entry",
  pending_qc_approve: "Awaiting QC approval",
  pending_pricing_propose: "Awaiting price proposal",
  pending_pricing_approve: "Awaiting price approval",
  approved: "Approved",
  rejected_correction: "Rejected — correction needed",
  rejected_commodity: "Rejected — commodity",
  rejected_escalate: "Escalated",
  partial_rejection: "Partial rejection",
  suspended: "Suspended",
};
const statusVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  approved: "default",
  rejected_commodity: "destructive",
  suspended: "destructive",
  rejected_escalate: "destructive",
  rejected_correction: "outline",
  partial_rejection: "outline",
};

function Stage({ label, done, current }: { label: string; done: boolean; current: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {done ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Circle className={`h-4 w-4 ${current ? "text-primary" : "text-muted-foreground"}`} />}
      <span className={done ? "font-medium" : current ? "font-medium text-primary" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}

function ActorLine({ label, name, at }: { label: string; name?: string | null; at?: string | null }) {
  if (!name) return null;
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-2 mt-2">
      <span className="flex items-center gap-1"><UserCheck className="h-3 w-3" /> {label}</span>
      <span><span className="font-medium text-foreground">{name}</span>{at ? ` · ${new Date(at).toLocaleString()}` : ""}</span>
    </div>
  );
}

export default function DeliveryDetail() {
  const [, params] = useRoute("/procurement/:id");
  const id = params?.id ?? "";
  const { data: delivery, isLoading, refetch } = useGetDelivery(id, { query: { enabled: !!id, queryKey: ["delivery", id] } });
  const { toast } = useToast();

  const submitWeight = useSubmitDeliveryWeight();
  const approveWeight = useApproveDeliveryWeight();
  const submitQc = useSubmitDeliveryQc();
  const approveQc = useApproveDeliveryQc();
  const proposePricing = useProposeDeliveryPricing();
  const approvePricing = useApproveDeliveryPricing();
  const rejectMut = useRejectDelivery();
  const resumeMut = useResumeDelivery();

  const [gross, setGross] = useState("");
  const [tare, setTare] = useState("");
  const [moisture, setMoisture] = useState("");
  const [defects, setDefects] = useState("");
  const [cupScore, setCupScore] = useState("");
  const [sampleId, setSampleId] = useState("");
  const [price, setPrice] = useState("");

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionType, setRejectionType] = useState<string>("CORRECTION");
  const [rejectionReason, setRejectionReason] = useState("");

  // Pay-farmer dialog state. Method `cash` deducts from the operator's float
  // server-side; `mobile_money` requires a provider + msisdn and is recorded
  // as `pending_external` until the MoMo gateway is wired up.
  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<"cash" | "mobile_money">("cash");
  const [payProvider, setPayProvider] = useState<"mtn_momo" | "airtel_money">("mtn_momo");
  const [payMsisdn, setPayMsisdn] = useState("");
  const [paying, setPaying] = useState(false);

  // Payments recorded against this delivery. We poll the gateway-backed status
  // via refresh-status and allow retrying a failed mobile-money disbursement.
  const [payments, setPayments] = useState<any[]>([]);
  const [payActionId, setPayActionId] = useState<string | null>(null);

  const loadPayments = useCallback(async () => {
    if (!id) return;
    try {
      const rows = await customFetch<any[]>(`${API_BASE}/api/payments?deliveryId=${encodeURIComponent(id)}`);
      setPayments(Array.isArray(rows) ? rows : []);
    } catch { /* non-fatal: payments panel just stays empty */ }
  }, [id]);

  useEffect(() => { loadPayments(); }, [loadPayments]);

  if (isLoading) return <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  if (!delivery) return <div className="py-16 text-center text-muted-foreground">Delivery not found</div>;

  const status = delivery.status;
  const isTerminal = ["approved", "rejected_commodity", "suspended"].includes(status);
  // sellerName/sellerType are on the API response but not yet typed (codegen drift).
  const sellerName = (delivery as any)?.sellerName as string | undefined;
  const sellerType = (delivery as any)?.sellerType as "farmer" | "supplier" | undefined;

  function fail(e: any) {
    const msg = e?.response?.data?.error ?? e?.message ?? "Failed";
    toast({ title: msg, variant: "destructive" });
  }
  function ok(t: string) { toast({ title: t }); refetch(); loadPayments(); }

  async function handleRefreshPayment(paymentId: string) {
    setPayActionId(paymentId);
    try {
      await customFetch(`${API_BASE}/api/payments/${paymentId}/refresh-status`, { method: "POST" });
      await loadPayments();
      toast({ title: "Status refreshed from gateway" });
    } catch (e) { fail(e); }
    finally { setPayActionId(null); }
  }
  async function handleRetryPayment(paymentId: string) {
    setPayActionId(paymentId);
    try {
      await customFetch(`${API_BASE}/api/payments/${paymentId}/retry`, { method: "POST" });
      await loadPayments();
      toast({ title: "Disbursement retried" });
    } catch (e) { fail(e); }
    finally { setPayActionId(null); }
  }

  async function handleSubmitWeight() {
    try {
      await submitWeight.mutateAsync({ deliveryId: id, data: { grossWeightKg: Number(gross), tareWeightKg: Number(tare) } });
      setGross(""); setTare(""); ok("Weight submitted — awaiting approver");
    } catch (e) { fail(e); }
  }
  async function handleApproveWeight() {
    try { await approveWeight.mutateAsync({ deliveryId: id }); ok("Weight approved"); } catch (e) { fail(e); }
  }
  async function handleSubmitQc() {
    try {
      await submitQc.mutateAsync({ deliveryId: id, data: { moistureContent: Number(moisture), defectCount: Number(defects), cupScore: cupScore ? Number(cupScore) : undefined, sampleId: sampleId.trim() || undefined } });
      setMoisture(""); setDefects(""); setCupScore(""); setSampleId(""); ok("QC submitted — awaiting approver");
    } catch (e) { fail(e); }
  }
  async function handleApproveQc() {
    try { await approveQc.mutateAsync({ deliveryId: id }); ok("QC approved"); } catch (e) { fail(e); }
  }
  async function handleProposePricing() {
    try { await proposePricing.mutateAsync({ deliveryId: id, data: { pricePerKg: Number(price) } }); setPrice(""); ok("Price proposed — awaiting head approval"); } catch (e) { fail(e); }
  }
  async function handleApprovePricing() {
    try { await approvePricing.mutateAsync({ deliveryId: id }); ok("Pricing approved — delivery completed"); } catch (e) { fail(e); }
  }
  async function handleResume() {
    try { await resumeMut.mutateAsync({ deliveryId: id, data: {} }); ok("Delivery resumed"); } catch (e) { fail(e); }
  }
  async function handleReject() {
    try {
      await rejectMut.mutateAsync({ deliveryId: id, data: { rejectionType: rejectionType as any, reason: rejectionReason } });
      setRejectOpen(false); setRejectionReason(""); ok("Rejection recorded");
    } catch (e) { fail(e); }
  }
  async function handlePay() {
    // farmerId/supplierId are on the API response but not yet typed in DeliveryDetail (codegen drift).
    const farmerId = (delivery as any)?.farmerId as string | undefined;
    const supplierId = (delivery as any)?.supplierId as string | undefined;
    if ((!farmerId && !supplierId) || !delivery?.totalValue) {
      toast({ title: "Delivery missing seller or total value", variant: "destructive" });
      return;
    }
    setPaying(true);
    try {
      const body: Record<string, unknown> = {
        ...(farmerId ? { farmerId } : { supplierId }),
        deliveryId: delivery.id,
        amountDue: Number(delivery.totalValue),
        currency: "UGX",
        paymentMethod: payMethod,
      };
      if (payMethod === "mobile_money") {
        body.provider = payProvider;
        body.msisdn = payMsisdn.trim();
      }
      await customFetch(`${API_BASE}/api/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setPayOpen(false);
      setPayMsisdn("");
      ok(payMethod === "cash" ? "Cash payment recorded — float updated" : "MoMo request queued (pending external)");
    } catch (e) { fail(e); }
    finally { setPaying(false); }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex items-center gap-3">
        <Link href="/procurement"><ArrowLeft className="h-5 w-5 text-muted-foreground cursor-pointer hover:text-foreground" /></Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight font-mono" data-testid="delivery-lot-tag">{delivery.lotTag}</h1>
          <p className="text-muted-foreground mt-1">
            {sellerName ? (
              <>Seller: <span className="font-medium" data-testid="delivery-seller-name">{sellerName}</span>
                <span className="text-xs ml-1">({sellerType === "supplier" ? "Third-party supplier" : "Farmer"})</span>
                {" · "}
              </>
            ) : null}
            {delivery.workflow ? (
              <>Workflow: <span className="font-medium">{delivery.workflow.name}</span>
                {delivery.currentStage ? <> · Now at <span className="font-medium" data-testid="current-stage-name">{delivery.currentStage.displayName}</span></> : null}
              </>
            ) : "Dual-approver procurement workflow"}
          </p>
        </div>
        <Badge variant={statusVariants[status] ?? "secondary"} data-testid="delivery-status">{statusLabels[status] ?? status}</Badge>
        {status === "approved" && delivery.totalValue != null && (
          <Button variant="default" size="sm" onClick={() => setPayOpen(true)} data-testid="pay-farmer-btn">
            Pay {sellerType === "supplier" ? "Supplier" : "Farmer"} · UGX {Number(delivery.totalValue).toLocaleString()}
          </Button>
        )}
        {(status === "partial_rejection" || status === "rejected_escalate") && (
          <Button variant="default" size="sm" onClick={handleResume} disabled={resumeMut.isPending} data-testid="resume-btn">
            Resume
          </Button>
        )}
        {!isTerminal && (
          <Button variant="outline" size="sm" onClick={() => setRejectOpen(true)} data-testid="reject-btn">
            <ShieldAlert className="h-4 w-4 mr-1" /> Reject
          </Button>
        )}
      </div>

      <div className="flex items-center gap-4 flex-wrap p-4 bg-muted/30 rounded-lg border">
        <Stage label="Weight submitted" done={!!delivery.weightSubmittedAt} current={status === "pending_weight_submit"} />
        <div className="h-px flex-1 bg-border min-w-4" />
        <Stage label="Weight approved" done={!!delivery.weightApproved} current={status === "pending_weight_approve"} />
        <div className="h-px flex-1 bg-border min-w-4" />
        <Stage label="QC submitted" done={!!delivery.qcSubmittedAt} current={status === "pending_qc_submit"} />
        <div className="h-px flex-1 bg-border min-w-4" />
        <Stage label="QC approved" done={!!delivery.qcApproved} current={status === "pending_qc_approve"} />
        <div className="h-px flex-1 bg-border min-w-4" />
        <Stage label="Price proposed" done={!!delivery.pricingProposedAt} current={status === "pending_pricing_propose"} />
        <div className="h-px flex-1 bg-border min-w-4" />
        <Stage label="Price approved" done={!!delivery.pricingApprovedAt} current={status === "pending_pricing_approve"} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* WEIGHT */}
        <Card>
          <CardHeader><CardTitle className="text-base">Weight</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {status !== "pending_weight_submit" && delivery.weightSubmittedAt ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Gross</span><span className="font-medium">{delivery.grossWeightKg} kg</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Tare</span><span className="font-medium">{delivery.tareWeightKg} kg</span></div>
                <div className="flex justify-between border-t pt-2"><span className="font-medium">Net</span><span className="font-bold">{delivery.netWeightKg} kg</span></div>
                <ActorLine label="Submitted by" name={delivery.weightSubmittedByName} at={delivery.weightSubmittedAt} />
                <ActorLine label="Approved by" name={delivery.weightApprovedByName} at={delivery.weightApprovedAt} />
                {status === "pending_weight_approve" && (
                  <Button onClick={handleApproveWeight} disabled={approveWeight.isPending} className="w-full mt-2" data-testid="approve-weight-btn">Approve Weight</Button>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Gross (kg)</Label><Input value={gross} onChange={e => setGross(e.target.value)} placeholder="0.0" data-testid="gross-input" /></div>
                  <div><Label>Tare (kg)</Label><Input value={tare} onChange={e => setTare(e.target.value)} placeholder="0.0" data-testid="tare-input" /></div>
                </div>
                <Button onClick={handleSubmitWeight} disabled={submitWeight.isPending || !gross || !tare} className="w-full" data-testid="submit-weight-btn">Submit Weight</Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* QC */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              QC
              {!delivery.weightApproved && <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground"><Lock className="h-3 w-3" />weight approval first</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {status !== "pending_qc_submit" && delivery.qcSubmittedAt ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Moisture</span><span className="font-medium">{delivery.moistureContent}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Defects</span><span className="font-medium">{delivery.defectCount}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Cup score</span><span className="font-medium">{delivery.cupScore ?? "—"}</span></div>
                <div className="flex justify-between border-t pt-2"><span className="font-medium">Grade</span><span className="font-bold">{delivery.grade ?? "—"}</span></div>
                <ActorLine label="Submitted by" name={delivery.qcSubmittedByName} at={delivery.qcSubmittedAt} />
                <ActorLine label="Approved by" name={delivery.qcApprovedByName} at={delivery.qcApprovedAt} />
                {status === "pending_qc_approve" && (
                  <Button onClick={handleApproveQc} disabled={approveQc.isPending} className="w-full mt-2" data-testid="approve-qc-btn">Approve QC</Button>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Moisture %</Label><Input value={moisture} onChange={e => setMoisture(e.target.value)} disabled={!delivery.weightApproved} placeholder="0.0" data-testid="moisture-input" /></div>
                  <div><Label>Defects</Label><Input value={defects} onChange={e => setDefects(e.target.value)} disabled={!delivery.weightApproved} placeholder="0" data-testid="defects-input" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Cup score (opt.)</Label><Input value={cupScore} onChange={e => setCupScore(e.target.value)} disabled={!delivery.weightApproved} placeholder="0-100" data-testid="cupscore-input" /></div>
                  <div><Label>Sample ID (opt.)</Label><Input value={sampleId} onChange={e => setSampleId(e.target.value)} disabled={!delivery.weightApproved} placeholder="QC-SAMPLE-…" data-testid="sample-id-input" /></div>
                </div>
                <Button onClick={handleSubmitQc} disabled={submitQc.isPending || !delivery.weightApproved || !moisture || !defects} className="w-full" data-testid="submit-qc-btn">Submit QC</Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* PRICING */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Pricing
            {!delivery.qcApproved && <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground"><Lock className="h-3 w-3" />QC approval first</span>}
            {delivery.contract && <Badge variant="outline" className="ml-auto text-xs">Contract {delivery.contract.contractNumber} · floor UGX {delivery.contract.floorPricePerKg?.toLocaleString()}/kg</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {status !== "pending_pricing_propose" && delivery.pricingProposedAt ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Price/kg</span><span className="font-medium">UGX {Number(delivery.pricePerKg).toLocaleString()}</span></div>
              <div className="flex justify-between border-t pt-2"><span className="font-medium">Total value</span><span className="font-bold text-lg text-primary">UGX {Number(delivery.totalValue).toLocaleString()}</span></div>
              <ActorLine label="Proposed by" name={delivery.pricingProposedByName} at={delivery.pricingProposedAt} />
              <ActorLine label="Approved by" name={delivery.pricingApprovedByName} at={delivery.pricingApprovedAt} />
              {status === "pending_pricing_approve" && (
                <Button onClick={handleApprovePricing} disabled={approvePricing.isPending} className="w-full mt-2" data-testid="approve-pricing-btn">Approve Final Price</Button>
              )}
            </div>
          ) : (
            <div className="flex items-end gap-3">
              <div className="flex-1"><Label>Price per kg (UGX)</Label><Input value={price} onChange={e => setPrice(e.target.value)} disabled={!delivery.qcApproved} placeholder="0.00" data-testid="price-input" /></div>
              <Button onClick={handleProposePricing} disabled={proposePricing.isPending || !delivery.qcApproved || !price} data-testid="propose-pricing-btn">Propose Price</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {payments.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {payments.map((p) => {
              const isMomo = p.paymentMethod === "mobile_money";
              const variant: "default" | "secondary" | "destructive" | "outline" =
                p.status === "paid" ? "default"
                  : p.status === "failed" ? "destructive"
                  : p.status === "pending_external" ? "secondary" : "outline";
              const label = p.status === "pending_external" ? "Pending — awaiting gateway" : p.status;
              const busy = payActionId === p.id;
              return (
                <div key={p.id} className="rounded-md border px-3 py-2 space-y-1" data-testid={`payment-row-${p.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-medium">{isMomo ? "Mobile Money" : p.paymentMethod === "cash" ? "Cash" : p.paymentMethod}</span>
                      {isMomo && p.momoProvider && <span className="text-muted-foreground"> · {p.momoProvider === "mtn_momo" ? "MTN MoMo" : p.momoProvider === "airtel_money" ? "Airtel Money" : p.momoProvider}</span>}
                      {p.msisdn && <span className="text-muted-foreground"> · {p.msisdn}</span>}
                    </div>
                    <Badge variant={variant} data-testid={`payment-status-${p.id}`}>{label}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{p.currency} {Number(p.amountDue ?? 0).toLocaleString()}{p.retryCount ? ` · retries: ${p.retryCount}` : ""}</span>
                    {p.paidAt && <span>Paid {new Date(p.paidAt).toLocaleString()}</span>}
                  </div>
                  {p.status === "failed" && p.failureReason && (
                    <div className="text-xs text-destructive flex items-center gap-1"><ShieldAlert className="h-3 w-3" /> {p.failureReason}</div>
                  )}
                  {isMomo && (p.status === "failed" || p.status === "pending_external") && (
                    <div className="flex gap-2 pt-1">
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => handleRefreshPayment(p.id)} data-testid={`refresh-payment-${p.id}`}>
                        <RefreshCw className={`h-3 w-3 mr-1 ${busy ? "animate-spin" : ""}`} /> Refresh
                      </Button>
                      {p.status === "failed" && (
                        <Button variant="default" size="sm" disabled={busy} onClick={() => handleRetryPayment(p.id)} data-testid={`retry-payment-${p.id}`}>
                          <RotateCw className="h-3 w-3 mr-1" /> Retry
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {delivery.rejectionType && (
        <Card className="border-destructive/40">
          <CardHeader><CardTitle className="text-base text-destructive flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Rejection</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div><span className="text-muted-foreground">Type:</span> <span className="font-medium">{delivery.rejectionType}</span></div>
            <div><span className="text-muted-foreground">Stage:</span> <span className="font-medium">{delivery.rejectionStage}</span></div>
            <div><span className="text-muted-foreground">Reason:</span> {delivery.rejectionReason}</div>
            <ActorLine label="By" name={delivery.rejectionByName} at={delivery.rejectionAt} />
          </CardContent>
        </Card>
      )}

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pay farmer</DialogTitle>
            <DialogDescription>
              Cash deducts from your assigned cash float. Mobile Money is recorded as pending until the MoMo gateway confirms.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-bold">UGX {Number(delivery.totalValue ?? 0).toLocaleString()}</span></div>
            </div>
            <div>
              <Label>Method</Label>
              <Select value={payMethod} onValueChange={v => setPayMethod(v as any)}>
                <SelectTrigger data-testid="pay-method-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash (deducts float)</SelectItem>
                  <SelectItem value="mobile_money">Mobile Money</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {payMethod === "mobile_money" && (
              <>
                <div>
                  <Label>Provider</Label>
                  <Select value={payProvider} onValueChange={v => setPayProvider(v as any)}>
                    <SelectTrigger data-testid="pay-provider-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mtn_momo">MTN Mobile Money</SelectItem>
                      <SelectItem value="airtel_money">Airtel Money</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Recipient phone</Label>
                  <Input value={payMsisdn} onChange={e => setPayMsisdn(e.target.value)} placeholder="+256 7XX XXX XXX" data-testid="pay-msisdn-input" />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button onClick={handlePay} disabled={paying || (payMethod === "mobile_money" && !payMsisdn.trim())} data-testid="confirm-pay-btn">
              {paying ? "Processing…" : "Confirm payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject delivery</DialogTitle>
            <DialogDescription>Pick the rejection type. CORRECTION returns the delivery to the matching submit step; SUSPEND quarantines it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Rejection type</Label>
              <Select value={rejectionType} onValueChange={setRejectionType}>
                <SelectTrigger data-testid="rejection-type-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CORRECTION">CORRECTION — return for re-submit</SelectItem>
                  <SelectItem value="COMMODITY">COMMODITY — void this lot</SelectItem>
                  <SelectItem value="ESCALATE">ESCALATE — to procurement head</SelectItem>
                  <SelectItem value="PARTIAL">PARTIAL — partial rejection</SelectItem>
                  <SelectItem value="SUSPEND">SUSPEND — quarantine</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reason</Label>
              <Textarea value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} placeholder="Why is this being rejected?" data-testid="rejection-reason-input" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={rejectMut.isPending || !rejectionReason.trim()} data-testid="confirm-reject-btn">Confirm Rejection</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
