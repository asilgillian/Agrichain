import { useListGroups } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Users, MapPin, ChevronRight } from "lucide-react";

export default function GroupsList() {
  const { data: groups, isLoading } = useListGroups({});

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Farmer Groups</h1>
          <p className="text-muted-foreground mt-1">Cooperative groups and their compliance scores</p>
        </div>
        <Badge variant="secondary">{isLoading ? "..." : (groups?.length ?? 0)} groups</Badge>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      ) : groups && groups.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((group) => (
            <Link key={group.id} href={`/groups/${group.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer" data-testid={`group-card-${group.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg">{group.name}</CardTitle>
                    <ChevronRight className="h-4 w-4 text-muted-foreground mt-1" />
                  </div>
                  {group.village && (
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      <span>{group.village}</span>
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 pt-2 border-t">
                    <div>
                      <p className="text-xs text-muted-foreground">Members</p>
                      <p className="font-semibold flex items-center gap-1"><Users className="h-3 w-3" />{group.memberCount ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Active Plots</p>
                      <p className="font-semibold">{group.activePlots ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Compliance</p>
                      <p className={`font-semibold ${(group.complianceScore ?? 0) >= 0.8 ? "text-green-600" : "text-amber-600"}`}>
                        {(((group.complianceScore ?? 0)) * 100).toFixed(0)}%
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="py-16 text-center text-muted-foreground">No groups found</div>
      )}
    </div>
  );
}
