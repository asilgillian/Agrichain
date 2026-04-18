import { useState } from "react";
import { Link } from "wouter";
import { useListFarmers } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Filter } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function FarmersList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const limit = 20;

  const { data, isLoading } = useListFarmers({ page, limit, search: search || undefined });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Farmer Registry</h1>
          <p className="text-muted-foreground mt-1">Manage and monitor registered farmers.</p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" /> Add Farmer
        </Button>
      </div>

      <Card>
        <div className="p-4 border-b flex flex-col sm:flex-row gap-4 items-center justify-between bg-muted/20">
          <div className="relative w-full sm:max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by name, ID, or phone..."
              className="pl-8 bg-background"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" className="gap-2 w-full sm:w-auto">
            <Filter className="h-4 w-4" /> Filters
          </Button>
        </div>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Farmer</TableHead>
                <TableHead>Ref Number</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-10 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : data?.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No farmers found.
                  </TableCell>
                </TableRow>
              ) : (
                data?.data.map((farmer) => (
                  <TableRow key={farmer.id} className="hover:bg-muted/50 cursor-pointer">
                    <TableCell>
                      <Link href={`/farmers/${farmer.id}`} className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={farmer.photoUrl} alt={`${farmer.firstName} ${farmer.lastName}`} />
                          <AvatarFallback>{farmer.firstName[0]}{farmer.lastName[0]}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="font-medium">{farmer.firstName} {farmer.lastName}</span>
                          <span className="text-xs text-muted-foreground">{farmer.village || "Unknown Village"}</span>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{farmer.referenceNumber}</TableCell>
                    <TableCell>{farmer.groupName || "-"}</TableCell>
                    <TableCell>{farmer.phoneNumber || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={farmer.status === 'active' ? 'default' : farmer.status === 'pending' ? 'secondary' : 'destructive'}>
                        {farmer.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/farmers/${farmer.id}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          
          {data && data.total > limit && (
            <div className="p-4 border-t flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Showing {(page - 1) * limit + 1} to Math.min(page * limit, data.total) of {data.total} farmers
              </span>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setPage(p => p + 1)}
                  disabled={page * limit >= data.total}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
