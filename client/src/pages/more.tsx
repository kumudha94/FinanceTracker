import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import {
  PieChart,
  Calendar,
  Settings,
  ChevronRight,
  Wallet,
  Target,
  Banknote,
  Landmark,
  Inbox
} from "lucide-react";

export default function More() {
  const menuItems = [
    { 
      icon: PieChart, 
      label: "Budget Planner", 
      description: "Track spending by category",
      path: "/budgets",
      testId: "link-budgets",
      color: "bg-blue-500"
    },
    {
      icon: Calendar,
      label: "Scheduled Payments",
      description: "Monthly payment checklist",
      path: "/scheduled-payments",
      testId: "link-scheduled-payments",
      color: "bg-orange-500"
    },
    {
      icon: Inbox,
      label: "Bills Inbox",
      description: "Triage due-reminder SMS",
      path: "/bills-inbox",
      testId: "link-bills-inbox",
      color: "bg-teal-500"
    },
    { 
      icon: Target, 
      label: "Savings Goals", 
      description: "Track goals & travels",
      path: "/savings-goals",
      testId: "link-savings-goals",
      color: "bg-green-500"
    },
    { 
      icon: Banknote, 
      label: "Salary & Income", 
      description: "Configure your payday",
      path: "/salary",
      testId: "link-salary",
      color: "bg-purple-500"
    },
    { 
      icon: Landmark, 
      label: "Loans & EMIs", 
      description: "Track loans and repayments",
      path: "/loans",
      testId: "link-loans",
      color: "bg-red-500"
    },
    { 
      icon: Settings, 
      label: "Settings", 
      description: "Theme, export, security",
      path: "/settings",
      testId: "link-settings",
      color: "bg-gray-500"
    },
  ];

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      <h1 className="text-2xl font-semibold text-foreground" data-testid="text-more-title">More</h1>

      {/* App Info Card */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center">
              <Wallet className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Finance Tracker</h3>
              <p className="text-sm text-muted-foreground">Personal expense manager</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Menu Items */}
      <div className="space-y-2">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.path} href={item.path}>
              <Card className="hover-elevate cursor-pointer" data-testid={item.testId}>
                <CardContent className="py-4 flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full ${item.color || 'bg-muted'} flex items-center justify-center`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{item.label}</p>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
