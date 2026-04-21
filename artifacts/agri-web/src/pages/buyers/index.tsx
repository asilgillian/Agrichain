import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Search, Globe, Phone, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

export default function BuyersPage() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", country: "", contactName: "", contactEmail: "", contactPhone: "", creditTermsDays: "" });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/buyers"],
    queryFn: () => fetch(`${API_BASE}/api/buyers?limit=100`).then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => fetch(`${API_BASE}/api/buyers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/buyers"] });
      toast({ title: "Buyer added" });
      setOpen(false);
      setForm({ name: "", country: "", contactName: "", contactEmail: "", contactPhone: "", creditTermsDays: "" });
    },
    onError: (e: any) => toast({ title: "Failed to add buyer", description: e.message, variant: "destructive" }),
  });

  const submit = () => {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    createMutation.mutate({
      name: form.name.trim(),
      country: form.country.trim() || undefined,
      contactName: form.contactName.trim() || undefined,
      contactEmail: form.contactEmail.trim() || undefined,
      contactPhone: form.contactPhone.trim() || undefined,
      creditTermsDays: form.creditTermsDays ? Number(form.creditTermsDays) : undefined,
    });
  };

  const buyers = (data?.data ?? []).filter((b: any) =>
    !search || b.name.toLowerCase().includes(search.toLowerCase()) || (b.country ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Buyer Registry</h1>
          <p className="text-muted-foreground mt-1">Export buyers and their contract requirements.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="new-buyer-btn" className="gap-2"><Plus className="h-4 w-4" /> Add Buyer</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Buyer</DialogTitle>
              <DialogDescription>Register a new export buyer.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div><Label>Buyer Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Volcafe Specialty" data-testid="input-name" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Country</Label><Input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} placeholder="Germany" data-testid="input-country" /></div>
                <div><Label>Credit Terms (days)</Label><Input type="number" value={form.creditTermsDays} onChange={e => setForm({ ...form, creditTermsDays: e.target.value })} placeholder="30" data-testid="input-credit-terms" /></div>
              </div>
              <div><Label>Contact Name</Label><Input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} data-testid="input-contact-name" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Email</Label><Input type="email" value={form.contactEmail} onChange={e => setForm({ ...form, contactEmail: e.target.value })} data-testid="input-email" /></div>
                <div><Label>Phone</Label><Input value={form.contactPhone} onChange={e => setForm({ ...form, contactPhone: e.target.value })} data-testid="input-phone" /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={createMutation.isPending} data-testid="submit-buyer">{createMutation.isPending ? "Adding..." : "Add Buyer"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative w-full max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search buyers or country..." value={search} onChange={e => setSearch(e.target.value)} data-testid="buyer-search" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />) : (
          buyers.length === 0 ? (
            <div className="col-span-3 text-center py-16 text-muted-foreground">No buyers found. Add your first buyer to get started.</div>
          ) : buyers.map((buyer: any) => (
            <Card key={buyer.id} className="hover:shadow-md transition-shadow" data-testid={`buyer-card-${buyer.id}`}>
              <CardContent className="pt-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-base">{buyer.name}</h3>
                    {buyer.country && <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5"><Globe className="h-3 w-3" />{buyer.country}</p>}
                  </div>
                  <Badge variant={buyer.isActive ? "default" : "secondary"} className="text-xs">{buyer.isActive ? "Active" : "Inactive"}</Badge>
                </div>
                {buyer.contactName && <p className="text-sm font-medium">{buyer.contactName}</p>}
                <div className="space-y-1">
                  {buyer.contactEmail && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Mail className="h-3 w-3" />{buyer.contactEmail}</p>}
                  {buyer.contactPhone && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Phone className="h-3 w-3" />{buyer.contactPhone}</p>}
                </div>
                <div className="flex items-center justify-between pt-1 border-t">
                  <div className="text-xs text-muted-foreground">{buyer.creditTermsDays ? `Net ${buyer.creditTermsDays} days` : "Terms TBD"}</div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
