import { storage } from "./storage";
import { getCyclePrimaryMonth, getCreditCardBillingCycle, getClosedCardCycle } from "./salaryUtils";

export type CommitmentMode = 'current' | 'next';

export interface CycleCommitmentGroups {
  plannedIncome: any[];
  scheduledPayments: any[];
  loans: any[];
  insurance: any[];
  creditCardBills: any[];
  savings: any[];
}

// Everything committed for one salary cycle: scheduled payments, loan EMIs, insurance premiums,
// credit card bills, savings goals and planned income. Used by the Next Cycle Plan ('next') and
// the spending allowance ('current'). Items keep their `excluded` flag; callers decide what to sum.
export async function buildCycleCommitments(
  userId: number,
  opts: { cycleStart: Date; cycleEnd: Date; now: Date; mode: CommitmentMode }
): Promise<CycleCommitmentGroups> {
  const { cycleStart, cycleEnd, now, mode } = opts;
  const { month: cycleMonth, year: cycleYear } = getCyclePrimaryMonth(cycleStart, cycleEnd);

  // Items the user has opted out of this specific cycle's totals stay in the list (so they can
  // be re-included) but callers don't count them.
  const exclusions = await storage.getForecastExclusions(userId, cycleStart);
  const excludedKeys = new Set(exclusions.map(e => `${e.itemType}:${e.itemId}`));
  const isExcluded = (itemType: string, itemId: string | number) => excludedKeys.has(`${itemType}:${itemId}`);

  const plannedIncomeEntriesForCycle = (await storage.getPlannedIncomeEntries(userId, cycleMonth, cycleYear))
    .filter(e => e.status === 'planned');
  const plannedIncomeItems: any[] = [];
  for (const entry of plannedIncomeEntriesForCycle) {
    const amount = parseFloat(entry.amount);
    const excluded = isExcluded('planned_income', entry.id);
    plannedIncomeItems.push({
      id: entry.id,
      name: entry.name,
      amount,
      dueDate: null,
      excluded,
    });
  }

  const allPayments = await storage.getAllScheduledPayments(userId);
  const activePayments = allPayments.filter(p => p.status === 'active');

  const isPaymentDueInCycle = (payment: any): boolean => {
    const frequency = payment.frequency || 'monthly';
    const startMonth = payment.startMonth;

    switch (frequency) {
      case 'monthly': return true;
      case 'quarterly': {
        if (startMonth) {
          const quarterMonths = [startMonth];
          for (let i = 1; i < 4; i++) {
            quarterMonths.push(((startMonth - 1 + i * 3) % 12) + 1);
          }
          return quarterMonths.includes(cycleMonth);
        }
        return [1, 4, 7, 10].includes(cycleMonth);
      }
      case 'half_yearly': {
        if (startMonth) {
          return cycleMonth === startMonth || cycleMonth === ((startMonth + 5) % 12) + 1;
        }
        return cycleMonth === 1 || cycleMonth === 7;
      }
      case 'yearly':
        return startMonth ? cycleMonth === startMonth : cycleMonth === 1;
      case 'custom': {
        if (payment.customIntervalMonths && payment.customIntervalMonths > 0) {
          const interval = payment.customIntervalMonths;
          const refMonth = startMonth || ((payment.createdAt instanceof Date ? payment.createdAt : new Date(payment.createdAt)).getMonth() + 1);
          const refYear = (payment.createdAt instanceof Date ? payment.createdAt : new Date(payment.createdAt)).getFullYear();
          const totalMonthsDiff = (cycleYear - refYear) * 12 + (cycleMonth - refMonth);
          return totalMonthsDiff >= 0 && totalMonthsDiff % interval === 0;
        }
        return true;
      }
      case 'one_time': {
        if (startMonth) {
          const created = payment.createdAt instanceof Date ? payment.createdAt : new Date(payment.createdAt);
          const targetYear = startMonth >= created.getMonth() + 1
            ? created.getFullYear()
            : created.getFullYear() + 1;
          return cycleMonth === startMonth && cycleYear === targetYear;
        }
        return false;
      }
      default: return true;
    }
  };

  const scheduledPaymentItems: any[] = [];
  for (const p of activePayments) {
    if (p.paymentType === 'credit_card_bill') continue;
    if (!isPaymentDueInCycle(p)) continue;
    const amount = parseFloat(p.amount || '0');
    const freq = p.frequency || 'monthly';
    const freqLabel = freq === 'monthly' ? 'Monthly' : freq === 'quarterly' ? 'Quarterly' : freq === 'half_yearly' ? 'Half Yearly' : freq === 'yearly' ? 'Yearly' : freq === 'custom' ? 'Custom' : '';
    const excluded = isExcluded('scheduled_payment', p.id);
    scheduledPaymentItems.push({
      id: p.id,
      name: p.name,
      amount,
      dueDate: p.dueDate,
      subLabel: freqLabel,
      excluded,
    });
  }


  const loans = await storage.getAllLoans(userId);
  const activeLoans = loans.filter(l => l.status === 'active');
  const loanItems = await Promise.all(activeLoans.map(async (loan) => {
    const installments = await storage.getLoanInstallments(loan.id);
    const nextInstallment = installments.find(inst => {
      const d = new Date(inst.dueDate);
      return d.getMonth() + 1 === cycleMonth && d.getFullYear() === cycleYear;
    });
    const amount = nextInstallment ? parseFloat(nextInstallment.emiAmount) : parseFloat(loan.emiAmount || '0');
    const typeLabel = loan.type === 'home_loan' ? 'Home Loan' : loan.type === 'personal_loan' ? 'Personal Loan' : loan.type === 'credit_card_loan' ? 'CC Loan' : loan.type === 'item_emi' ? 'Item EMI' : 'Loan';
    const excluded = isExcluded('loan', loan.id);
    return {
      id: loan.id,
      name: loan.name,
      amount,
      dueDate: loan.emiDay,
      subLabel: `${typeLabel}${loan.lenderName ? ` · ${loan.lenderName}` : ''}`,
      excluded,
    };
  }));

  const allInsurances = await storage.getAllInsurances(userId);
  // Auto-funded policies (e.g. a market/sub policy funded by a main policy's benefit) are
  // never something the user pays directly — exclude them from due/forecast projections
  // entirely; their premium history is only meaningful on the policy's own details view.
  const activeInsurances = allInsurances.filter(i => i.status === 'active' && !i.autoFunded);
  const insuranceItems: any[] = [];
  for (const ins of activeInsurances) {
    const premiums = ins.premiums || [];
    const nextPremium = premiums.find((p: any) => {
      const d = new Date(p.dueDate);
      return d.getMonth() + 1 === cycleMonth && d.getFullYear() === cycleYear
        // A paid premium still counts for the cycle under way: its payment is left out of
        // spending instead, so dropping it would lose the money from the calculation.
        && (mode === 'current' || p.status !== 'paid');
    });
    if (nextPremium) {
      const amount = parseFloat(nextPremium.amount);
      const typeLabel = ins.type === 'health' ? 'Health' : ins.type === 'life' ? 'Life' : ins.type === 'vehicle' ? 'Vehicle' : ins.type === 'home' ? 'Home' : ins.type === 'term' ? 'Term' : 'Insurance';
      const excluded = isExcluded('insurance', ins.id);
      insuranceItems.push({
        id: ins.id,
        name: ins.name,
        amount,
        dueDate: new Date(nextPremium.dueDate).getDate(),
        subLabel: `${typeLabel}${ins.providerName ? ` · ${ins.providerName}` : ''}`,
        excluded,
      });
    }
  }


  const activeSavingsGoals = (await storage.getAllSavingsGoals(userId)).filter(
    (g) => g.status === 'active' && parseFloat(g.monthlyExpectedAmount || '0') > 0
  );
  const savingsItems: any[] = activeSavingsGoals.map((g) => ({
    id: g.id,
    name: g.name,
    amount: parseFloat(g.monthlyExpectedAmount || '0'),
    dueDate: null,
    subLabel: 'Savings Goal',
    excluded: isExcluded('savings_goal', g.id),
  }));

  const allAccounts = await storage.getAllAccounts(userId);
  const ccCards = allAccounts.filter(a => a.type === 'credit_card' && a.isActive && a.billingDate);
  const manualCCIds = new Set(
    activePayments.filter(p => p.paymentType === 'credit_card_bill').map(p => p.creditCardAccountId).filter(Boolean)
  );

  // Auto-detected credit card bills (spend-based) — one transaction-history query per card,
  // run concurrently instead of awaited in sequence.
  const autoCcItems = (await Promise.all(
    ccCards.filter(card => !manualCCIds.has(card.id)).map(async (card) => {
      const billingDay = card.billingDate!;
      const currentDay = now.getDate();
      let curCycleStart: Date;
      let queryEnd: Date;
      if (mode === 'current') {
        // The bill falling due in this salary cycle is the card's last closed billing cycle.
        const closed = getClosedCardCycle(cycleStart, billingDay);
        curCycleStart = closed.cycleStart;
        queryEnd = closed.cycleEnd;
      } else {
        if (currentDay >= billingDay) {
          curCycleStart = new Date(now.getFullYear(), now.getMonth(), billingDay, 0, 0, 0);
        } else {
          curCycleStart = new Date(now.getFullYear(), now.getMonth() - 1, billingDay, 0, 0, 0);
        }
        queryEnd = new Date();
      }
      const curCycleTxns = await storage.getAllTransactions({
        userId,
        accountId: card.id,
        startDate: curCycleStart,
        endDate: queryEnd,
      });
      const spentSoFar = curCycleTxns
        .filter(t => t.type === 'debit')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);
      if (spentSoFar <= 0) return null;
      const creditLimit = card.creditLimit ? parseFloat(card.creditLimit) : null;
      const itemId = `cc-auto-${card.id}`;
      return {
        id: itemId,
        name: `${card.name} Bill`,
        amount: spentSoFar,
        dueDate: billingDay,
        subLabel: `Spent so far this cycle`,
        creditLimit,
        excluded: isExcluded('credit_card_bill', itemId),
      };
    })
  )).filter((item): item is NonNullable<typeof item> => item !== null);

  // Manually-configured credit card bill payments — same concurrency treatment.
  const manualCcItems = await Promise.all(
    activePayments
      .filter(p => p.paymentType === 'credit_card_bill' && isPaymentDueInCycle(p) && manualCCIds.has(p.creditCardAccountId))
      .map(async (p) => {
        let amount = parseFloat(p.amount || '0');

        // If amount is 0 (auto-calculate), fetch the actual billing cycle amount
        if (amount === 0 && p.creditCardAccountId) {
          const creditCardAccount = await storage.getAccount(p.creditCardAccountId);
          if (creditCardAccount && creditCardAccount.billingDate) {
            const { cycleStart: billStart, cycleEnd: billEnd } = mode === 'current'
              ? getClosedCardCycle(cycleStart, creditCardAccount.billingDate)
              : getCreditCardBillingCycle(now, creditCardAccount.billingDate);
            const cycleTransactions = await storage.getAllTransactions({
              accountId: creditCardAccount.id,
              startDate: billStart,
              endDate: billEnd,
            });
            amount = cycleTransactions
              .filter(t => t.type === 'debit')
              .reduce((sum, t) => sum + parseFloat(t.amount), 0);
          }
        }

        let creditLimit: number | null = null;
        const linkedCard = allAccounts.find(a => a.id === p.creditCardAccountId);
        if (linkedCard && linkedCard.creditLimit) {
          creditLimit = parseFloat(linkedCard.creditLimit);
        }
        return {
          id: p.id,
          name: p.name,
          amount,
          dueDate: p.dueDate,
          subLabel: 'Monthly',
          creditLimit,
          excluded: isExcluded('credit_card_bill', p.id),
        };
      })
  );

  return {
    plannedIncome: plannedIncomeItems,
    scheduledPayments: scheduledPaymentItems,
    loans: loanItems,
    insurance: insuranceItems,
    creditCardBills: [...autoCcItems, ...manualCcItems],
    savings: savingsItems,
  };
}
