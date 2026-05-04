import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

type Rule = {
  id: string;
  txnType: "delivery" | "payment" | "loan" | "certification";
  requiredStage: "pre_registered" | "partially_registered" | "fully_registered";
  isActive: boolean;
  updatedAt: string;
};

const TXN_LABELS: Record<Rule["txnType"], string> = {
  delivery: "Deliveries",
  payment: "Payments",
  loan: "Loans",
  certification: "Certifications",
};

const STAGE_OPTIONS: { value: Rule["requiredStage"]; label: string }[] = [
  { value: "pre_registered", label: "Pre-registered" },
  { value: "partially_registered", label: "Partially Registered" },
  { value: "fully_registered", label: "Fully Registered" },
];

export function TransactionAccessManager() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: rules, isLoading } = useQuery<Rule[]>({
    queryKey: ["/api/admin/transaction-access"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/admin/transaction-access`);
      if (!r.ok) throw new Error(`Failed to load rules (${r.status})`);
      return r.json();
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ txnType, patch }: { txnType: Rule["txnType"]; patch: Partial<Rule> }) =>
      fetch(`${API_BASE}/api/admin/transaction-access/${txnType}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Save failed");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/transaction-access"] });
      toast({ title: "Rule updated" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Transaction Access by Registration Stage</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Set the minimum registration stage a farmer must have before each transaction type is accepted.
          Toggling a row off disables enforcement for that transaction type.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Transaction</TableHead>
              <TableHead>Required Stage</TableHead>
              <TableHead className="w-32">Enforcement</TableHead>
              <TableHead>Last updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rules ?? []).map((r) => (
              <TableRow key={r.id} data-testid={`txn-rule-${r.txnType}`}>
                <TableCell className="font-medium">{TXN_LABELS[r.txnType] ?? r.txnType}</TableCell>
                <TableCell>
                  <Select
                    value={r.requiredStage}
                    onValueChange={(v) => updateMut.mutate({ txnType: r.txnType, patch: { requiredStage: v as Rule["requiredStage"] } })}
                  >
                    <SelectTrigger className="w-56" data-testid={`stage-${r.txnType}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STAGE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Switch
                    checked={r.isActive}
                    onCheckedChange={(v) => updateMut.mutate({ txnType: r.txnType, patch: { isActive: v } })}
                    data-testid={`active-${r.txnType}`}
                  />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(r.updatedAt).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
