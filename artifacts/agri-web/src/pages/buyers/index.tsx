import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Search, Globe, Phone, Mail } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

export default function BuyersPage() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["/api/buyers"],
    queryFn: () => fetch(`${API_BASE}/api/buyers?limit=100`).then(r => r.json()),
  });

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
        <Button data-testid="new-buyer-btn" className="gap-2"><Plus className="h-4 w-4" /> Add Buyer</Button>
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
                  <div className="text-xs text-muted-foreground">
                    {buyer.creditTermsDays ? `Net ${buyer.creditTermsDays} days` : "Terms TBD"}
                  </div>
                  <Link href={`/buyers/${buyer.id}`}><Button size="sm" variant="ghost">View</Button></Link>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
