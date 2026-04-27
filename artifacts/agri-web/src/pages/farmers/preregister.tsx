import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_PHONE_CODE } from "@/lib/currency";
import { usePermissions } from "@/hooks/use-permissions";
import { UserPlus, ArrowLeft, AlertCircle } from "lucide-react";
import { RegionPicker } from "@/components/RegionPicker";
import { GroupPicker } from "@/components/GroupPicker";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

const empty = {
  firstName: "",
  lastName: "",
  phoneNumber: DEFAULT_PHONE_CODE,
  village: "",
  groupId: "",
  regionId: "",
  sex: "",
};

// Standalone /farmers/preregister page (per spec). Mostly mirrors the dialog on the
// farmers list — provided so field agents can deep-link straight into a focused
// pre-registration screen without the surrounding registry UI.
export default function FarmerPreregisterPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { has, isLoading: permsLoading } = usePermissions();
  const canPre = has("farmers.preregister");
  const [form, setForm] = useState(empty);

  const mut = useMutation({
    mutationFn: (body: any) =>
      fetch(`${API_BASE}/api/farmers/preregister`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: (created: any) => {
      qc.invalidateQueries({ queryKey: ["/api/farmers"] });
      toast({ title: "Farmer pre-registered", description: "Opening farmer profile…" });
      navigate(`/farmers/${created.id}`);
    },
    onError: (e: any) => toast({ title: "Pre-registration failed", description: e.message, variant: "destructive" }),
  });

  const submit = () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.groupId || !form.regionId) {
      toast({ title: "Missing fields", description: "Name, group and region are required", variant: "destructive" });
      return;
    }
    const body: any = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      groupId: form.groupId,
      regionId: form.regionId,
    };
    const phone = form.phoneNumber.trim();
    if (phone && phone !== DEFAULT_PHONE_CODE) body.phoneNumber = phone;
    if (form.village.trim()) body.village = form.village.trim();
    if (form.sex) body.sex = form.sex;
    mut.mutate(body);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-12">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/farmers")} className="gap-2 mb-2">
          <ArrowLeft className="h-4 w-4" /> Back to farmers
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">Pre-register Farmer</h1>
        <p className="text-muted-foreground mt-1">Fast capture of the bare minimum. KYC details can be completed later from the farmer's profile.</p>
      </div>

      {!permsLoading && !canPre && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
            <div>
              <p className="font-medium">You don't have permission to pre-register farmers.</p>
              <p className="text-sm text-muted-foreground">Ask an administrator to grant the <code className="text-xs">farmers.preregister</code> permission to your role.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5" /> New farmer</CardTitle>
          <CardDescription>Required: first name, last name, region, group.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>First Name *</Label><Input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} data-testid="page-pre-first-name" /></div>
            <div><Label>Last Name *</Label><Input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} data-testid="page-pre-last-name" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Phone</Label><Input value={form.phoneNumber} onChange={e => setForm({ ...form, phoneNumber: e.target.value })} placeholder="+256..." data-testid="page-pre-phone" /></div>
            <div><Label>Village</Label><Input value={form.village} onChange={e => setForm({ ...form, village: e.target.value })} data-testid="page-pre-village" /></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="mb-1 block">Administrative unit *</Label>
              <RegionPicker
                value={form.regionId}
                onChange={v => setForm({ ...form, regionId: v, groupId: "" })}
                country="UG"
                required
                testIdPrefix="page-pre-region"
              />
            </div>
            <div>
              <Label className="mb-1 block">Group *</Label>
              <GroupPicker
                value={form.groupId}
                onChange={v => setForm({ ...form, groupId: v })}
                regionId={form.regionId}
                testId="page-pre-group"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => navigate("/farmers")}>Cancel</Button>
            <Button onClick={submit} disabled={!canPre || mut.isPending} data-testid="page-pre-submit">{mut.isPending ? "Saving..." : "Pre-register farmer"}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
