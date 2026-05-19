import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Sprout, BarChart3, ShieldCheck, Truck } from "lucide-react";

// Use Wouter <Link> navigation to the dedicated /sign-in and /sign-up routes
// (defined in App.tsx). Replit-managed Clerk's prod proxy does NOT work with
// Clerk's hosted/modal flow — using <SignInButton mode="modal"> here makes
// the Google OAuth callback redirect to accounts.<host> which doesn't exist
// and yields ERR_CONNECTION_CLOSED.
export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-lime-50">
      <header className="flex items-center justify-between p-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="MTANDEO" className="h-8 w-8" />
          <span className="font-bold text-lg">MTANDEO COMMODITIES</span>
        </div>
        <div className="flex gap-2">
          <Link href="/sign-in">
            <Button variant="ghost" data-testid="header-signin">Sign In</Button>
          </Link>
          <Link href="/sign-up">
            <Button data-testid="header-signup">Get Started</Button>
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-20 text-center">
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6">
          Digital Agriculture Platform <span className="text-emerald-700">for Uganda</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          Track every kilogram from farmer to export container. Mobile-first field registration,
          procurement, payments, warehousing, compliance, loans and exports — fully auditable.
        </p>
        <div className="flex justify-center gap-3">
          <Link href="/sign-in">
            <Button size="lg" data-testid="hero-signin">Sign In to Continue</Button>
          </Link>
          <Link href="/sign-up">
            <Button size="lg" variant="outline" data-testid="hero-signup">Create Account</Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-20 text-left">
          {[
            { icon: Sprout, title: "Farmer Registry", body: "Field agents register growers offline; sync when connected." },
            { icon: Truck, title: "Procurement", body: "Weight, QC, pricing — gated approvals and instant payments." },
            { icon: ShieldCheck, title: "Compliance", body: "EUDR, Rainforest Alliance, GAP — every certificate tracked." },
            { icon: BarChart3, title: "Exports", body: "Lots, contracts, shipments, container traceability." },
          ].map(f => (
            <div key={f.title} className="p-5 rounded-xl bg-white shadow-sm border">
              <f.icon className="h-6 w-6 text-emerald-700 mb-2" />
              <h3 className="font-semibold mb-1">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="text-center text-xs text-muted-foreground py-8">
        © MTANDEO Commodities Ltd · Kampala, Uganda
      </footer>
    </div>
  );
}
