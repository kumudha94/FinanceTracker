import { useState, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/bottom-nav";
import { FabButton } from "@/components/fab-button";
import { AppHeader } from "@/components/app-header";
import { LockScreen } from "@/components/lock-screen";
import { getAccessToken } from "@/lib/auth";
import Dashboard from "@/pages/dashboard";
import Accounts from "@/pages/accounts";
import Transactions from "@/pages/transactions";
import AddTransaction from "@/pages/add-transaction";
import More from "@/pages/more";
import Budgets from "@/pages/budgets";
import ScheduledPayments from "@/pages/scheduled-payments";
import SavingsGoals from "@/pages/savings-goals";
import Salary from "@/pages/salary";
import Loans from "@/pages/loans";
import BillsInbox from "@/pages/bills-inbox";
import Settings from "@/pages/settings";
import Login from "@/pages/login";
import SetPassword from "@/pages/set-password";
import NotFound from "@/pages/not-found";
import type { User } from "@shared/schema";

function useThemeInit() {
  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/set-password" component={SetPassword} />
      <Route path="/" component={Dashboard} />
      <Route path="/accounts" component={Accounts} />
      <Route path="/transactions" component={Transactions} />
      <Route path="/add-transaction" component={AddTransaction} />
      <Route path="/more" component={More} />
      <Route path="/budgets" component={Budgets} />
      <Route path="/scheduled-payments" component={ScheduledPayments} />
      <Route path="/savings-goals" component={SavingsGoals} />
      <Route path="/salary" component={Salary} />
      <Route path="/loans" component={Loans} />
      <Route path="/bills-inbox" component={BillsInbox} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppShell() {
  const [location, navigate] = useLocation();
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [hadPinOnLoad, setHadPinOnLoad] = useState<boolean | null>(null);
  
  useThemeInit();
  
  // Check if user is authenticated
  const isAuthenticated = !!getAccessToken();
  
  // Redirect to login if not authenticated (except for auth pages)
  useEffect(() => {
    if (!isAuthenticated && location !== '/login' && location !== '/set-password') {
      navigate('/login');
    }
  }, [isAuthenticated, location, navigate]);
  
  const { data: user, isLoading: userLoading, isError, refetch } = useQuery<User>({
    queryKey: ["/api/user"],
    retry: 3,
    retryDelay: 1000,
    enabled: isAuthenticated, // Only fetch user if authenticated
  });
  
  useEffect(() => {
    if (user && hadPinOnLoad === null) {
      setHadPinOnLoad(!!user.pinHash);
    }
  }, [user, hadPinOnLoad]);
  
  const hasPinSet = !!user?.pinHash;
  const isSubPage = location === "/add-transaction" || location === "/settings" || 
                    location === "/budgets" || location === "/scheduled-payments" ||
                    location === "/savings-goals" || location === "/salary" ||
                    location === "/loans";
  const isAuthPage = location === "/login" || location === "/set-password";
  const showFab = location === "/" || location === "/accounts" || location === "/transactions";
  const showHeader = !isSubPage && !isAuthPage;

  // Show auth pages without authentication check
  if (isAuthPage) {
    return (
      <div className="min-h-screen bg-background">
        <Router />
      </div>
    );
  }

  if (userLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-destructive text-center">Unable to connect. Please check your connection.</p>
        <Button onClick={() => refetch()} data-testid="button-retry">
          Try Again
        </Button>
      </div>
    );
  }

  if ((hasPinSet || hadPinOnLoad) && !isUnlocked) {
    return <LockScreen onUnlock={() => setIsUnlocked(true)} />;
  }

  return (
    <div className="min-h-screen bg-background">
      {showHeader && <AppHeader />}
      <div className="max-w-2xl mx-auto">
        <Router />
      </div>
      {showFab && <FabButton />}
      {!isSubPage && <BottomNav />}
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AppShell />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
