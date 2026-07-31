import { lastDayOfMonth, isWeekend, subDays, getDay } from "date-fns";

export function getLastWorkingDayOfMonth(year: number, month: number): Date {
  const lastDay = lastDayOfMonth(new Date(year, month - 1));
  let workingDay = lastDay;
  while (isWeekend(workingDay)) {
    workingDay = subDays(workingDay, 1);
  }
  return workingDay;
}

export function getPaydayForMonth(
  year: number,
  month: number,
  rule: string,
  fixedDay?: number | null,
  weekdayPreference?: number | null
): Date {
  switch (rule) {
    case "fixed_day":
      if (fixedDay) {
        const lastDay = lastDayOfMonth(new Date(year, month - 1)).getDate();
        const day = Math.min(fixedDay, lastDay);
        let payday = new Date(year, month - 1, day);
        while (isWeekend(payday)) {
          payday = subDays(payday, 1);
        }
        return payday;
      }
      return getLastWorkingDayOfMonth(year, month);

    case "nth_weekday":
      return getLastWorkingDayOfMonth(year, month);

    case "last_working_day":
    default:
      return getLastWorkingDayOfMonth(year, month);
  }
}

export function shouldPaymentOccurThisMonth(
  frequency: string,
  startMonth: number | null,
  currentMonth: number
): boolean {
  switch (frequency) {
    case "monthly":
      return true;
    case "quarterly":
      if (!startMonth) return currentMonth % 3 === 1;
      const quarterMonths = [startMonth, (startMonth + 2) % 12 + 1, (startMonth + 5) % 12 + 1];
      return quarterMonths.includes(currentMonth);
    case "half_yearly":
      if (!startMonth) return currentMonth === 1 || currentMonth === 7;
      return currentMonth === startMonth || currentMonth === ((startMonth + 5) % 12) + 1;
    case "yearly":
      if (!startMonth) return currentMonth === 1;
      return currentMonth === startMonth;
    case "one_time":
      return true;
    default:
      return true;
  }
}

export function getNextPaydays(
  rule: string,
  fixedDay: number | null,
  weekdayPreference: number | null,
  count: number = 6
): { month: number; year: number; date: Date }[] {
  const now = new Date();
  const results: { month: number; year: number; date: Date }[] = [];
  
  let currentMonth = now.getMonth() + 1;
  let currentYear = now.getFullYear();
  
  for (let i = 0; i < count; i++) {
    const payday = getPaydayForMonth(currentYear, currentMonth, rule, fixedDay, weekdayPreference);
    results.push({
      month: currentMonth,
      year: currentYear,
      date: payday,
    });
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
  }
  
  return results;
}

export function getPastPaydays(
  rule: string,
  fixedDay: number | null,
  weekdayPreference: number | null,
  count: number = 3
): { month: number; year: number; date: Date }[] {
  const now = new Date();
  const results: { month: number; year: number; date: Date }[] = [];
  
  let currentMonth = now.getMonth(); // Start from last month (0-indexed)
  let currentYear = now.getFullYear();
  
  // Go back to previous month
  if (currentMonth === 0) {
    currentMonth = 12;
    currentYear--;
  }
  
  for (let i = 0; i < count; i++) {
    const payday = getPaydayForMonth(currentYear, currentMonth, rule, fixedDay, weekdayPreference);
    results.push({
      month: currentMonth,
      year: currentYear,
      date: payday,
    });
    currentMonth--;
    if (currentMonth === 0) {
      currentMonth = 12;
      currentYear--;
    }
  }
  
  return results;
}

export interface CycleDates {
  cycleStart: Date;
  cycleEnd: Date;
  cycleLabel: string;
  cycleStartFormatted: string;
  cycleEndFormatted: string;
  isSalaryCycle: boolean;
}

function formatDateShort(d: Date): string {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function makeCycleLabel(cycleStart: Date, cycleEnd: Date): string {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const startMonthName = monthNames[cycleStart.getMonth()];
  const endMonthName = monthNames[cycleEnd.getMonth()];
  if (cycleStart.getMonth() === cycleEnd.getMonth() && cycleStart.getFullYear() === cycleEnd.getFullYear()) {
    return `${startMonthName} ${cycleStart.getFullYear()}`;
  }
  return `${startMonthName} ${cycleStart.getDate()} - ${endMonthName} ${cycleEnd.getDate()}`;
}

function getExpectedPaydayForMonth(salaryProfile: any, year: number, month: number): Date {
  return getPaydayForMonth(
    year, month,
    salaryProfile.paydayRule || 'last_working_day',
    salaryProfile.fixedDay,
    salaryProfile.weekdayPreference
  );
}

function resolveLastPayDate(lastSalaryCycle: any | null): Date | null {
  if (!lastSalaryCycle) return null;
  if (lastSalaryCycle.actualPayDate) return new Date(lastSalaryCycle.actualPayDate);
  if (lastSalaryCycle.expectedPayDate) return new Date(lastSalaryCycle.expectedPayDate);
  return null;
}

function calcSalaryCycleDates(
  salaryProfile: any,
  lastSalaryCycle: any | null,
  now: Date
): { cycleStart: Date; cycleEnd: Date } {
  const lastPayDate = resolveLastPayDate(lastSalaryCycle);

  if (lastPayDate) {
    const lastPayMonth = lastPayDate.getMonth(); // 0-based (0=Jan, 11=Dec)
    const lastPayYear = lastPayDate.getFullYear();
    // Convert 0-based month to 1-based AND advance one month: +2
    // getExpectedPaydayForMonth expects 1-based month (1-12)
    const nextM = lastPayMonth === 11 ? 1 : lastPayMonth + 2;
    const nextY = lastPayMonth === 11 ? lastPayYear + 1 : lastPayYear;
    const nextPayDate = getExpectedPaydayForMonth(salaryProfile, nextY, nextM);

    if (now >= lastPayDate && now < nextPayDate) {
      const cycleStart = new Date(lastPayDate);
      cycleStart.setHours(0, 0, 0, 0);
      const cycleEnd = new Date(nextPayDate);
      cycleEnd.setHours(0, 0, 0, 0);
      cycleEnd.setTime(cycleEnd.getTime() - 1000);
      return { cycleStart, cycleEnd };
    }
  }

  // Fallback: use expected paydays from salary profile rules
  // now.getMonth() is 0-based; getExpectedPaydayForMonth expects 1-based month
  const currentMonthPayday = getExpectedPaydayForMonth(salaryProfile, now.getFullYear(), now.getMonth() + 1);
  const prevM = now.getMonth() === 0 ? 12 : now.getMonth(); // prev month in 1-based
  const prevY = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const prevMonthPayday = getExpectedPaydayForMonth(salaryProfile, prevY, prevM);
  const nextM2 = now.getMonth() === 11 ? 1 : now.getMonth() + 2; // next month in 1-based
  const nextY2 = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
  const nextMonthPayday = getExpectedPaydayForMonth(salaryProfile, nextY2, nextM2);

  let cycleStart: Date;
  let cycleEnd: Date;

  if (now >= currentMonthPayday) {
    cycleStart = new Date(currentMonthPayday);
    cycleStart.setHours(0, 0, 0, 0);
    cycleEnd = new Date(nextMonthPayday);
    cycleEnd.setHours(0, 0, 0, 0);
    cycleEnd.setTime(cycleEnd.getTime() - 1000);
  } else {
    cycleStart = new Date(prevMonthPayday);
    cycleStart.setHours(0, 0, 0, 0);
    cycleEnd = new Date(currentMonthPayday);
    cycleEnd.setHours(0, 0, 0, 0);
    cycleEnd.setTime(cycleEnd.getTime() - 1000);
  }

  return { cycleStart, cycleEnd };
}

/**
 * Calculate current month cycle dates based on salary profile settings
 */
export function getCurrentCycleDates(
  salaryProfile: any,
  lastSalaryCycle: any | null,
  now: Date = new Date()
): CycleDates {
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const defaultLabel = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;

  if (!salaryProfile || !salaryProfile.isActive) {
    return {
      cycleStart: defaultStart, cycleEnd: defaultEnd, cycleLabel: defaultLabel,
      cycleStartFormatted: formatDateShort(defaultStart), cycleEndFormatted: formatDateShort(defaultEnd),
      isSalaryCycle: false,
    };
  }

  const monthCycleStartRule = salaryProfile.monthCycleStartRule || 'salary_day';

  if (monthCycleStartRule === 'fixed_day' && salaryProfile.monthCycleStartDay) {
    const fixedDay = salaryProfile.monthCycleStartDay;
    const currentDay = now.getDate();
    let cycleStart: Date;
    let cycleEnd: Date;

    if (currentDay >= fixedDay) {
      cycleStart = new Date(now.getFullYear(), now.getMonth(), fixedDay, 0, 0, 0);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, fixedDay);
      cycleEnd = new Date(nextMonth.getTime() - 1000);
    } else {
      cycleStart = new Date(now.getFullYear(), now.getMonth() - 1, fixedDay, 0, 0, 0);
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), fixedDay);
      cycleEnd = new Date(thisMonth.getTime() - 1000);
    }

    return {
      cycleStart, cycleEnd, cycleLabel: makeCycleLabel(cycleStart, cycleEnd),
      cycleStartFormatted: formatDateShort(cycleStart), cycleEndFormatted: formatDateShort(cycleEnd),
      isSalaryCycle: true,
    };
  }

  if (monthCycleStartRule === 'salary_day') {
    const { cycleStart, cycleEnd } = calcSalaryCycleDates(salaryProfile, lastSalaryCycle, now);
    return {
      cycleStart, cycleEnd, cycleLabel: makeCycleLabel(cycleStart, cycleEnd),
      cycleStartFormatted: formatDateShort(cycleStart), cycleEndFormatted: formatDateShort(cycleEnd),
      isSalaryCycle: true,
    };
  }

  return {
    cycleStart: defaultStart, cycleEnd: defaultEnd, cycleLabel: defaultLabel,
    cycleStartFormatted: formatDateShort(defaultStart), cycleEndFormatted: formatDateShort(defaultEnd),
    isSalaryCycle: false,
  };
}

/**
 * Calculate next month cycle dates based on salary profile settings
 */
export function getNextCycleDates(
  salaryProfile: any,
  lastSalaryCycle: any | null,
  now: Date = new Date()
): CycleDates {
  const currentCycle = getCurrentCycleDates(salaryProfile, lastSalaryCycle, now);
  const nextCycleStart = new Date(currentCycle.cycleEnd.getTime() + 1000);
  nextCycleStart.setHours(0, 0, 0, 0);

  if (!salaryProfile || !salaryProfile.isActive) {
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const label = `${monthNames[nextMonthStart.getMonth()]} ${nextMonthStart.getFullYear()}`;
    return {
      cycleStart: nextMonthStart, cycleEnd: nextMonthEnd, cycleLabel: label,
      cycleStartFormatted: formatDateShort(nextMonthStart), cycleEndFormatted: formatDateShort(nextMonthEnd),
      isSalaryCycle: false,
    };
  }

  const monthCycleStartRule = salaryProfile.monthCycleStartRule || 'salary_day';

  if (monthCycleStartRule === 'fixed_day' && salaryProfile.monthCycleStartDay) {
    const fixedDay = salaryProfile.monthCycleStartDay;
    const nsMonth = nextCycleStart.getMonth();
    const nsYear = nextCycleStart.getFullYear();
    const cycleStart = new Date(nsYear, nsMonth, fixedDay, 0, 0, 0);
    const nm = nsMonth === 11 ? 0 : nsMonth + 1;
    const ny = nsMonth === 11 ? nsYear + 1 : nsYear;
    const cycleEnd = new Date(ny, nm, fixedDay);
    cycleEnd.setTime(cycleEnd.getTime() - 1000);
    return {
      cycleStart, cycleEnd, cycleLabel: makeCycleLabel(cycleStart, cycleEnd),
      cycleStartFormatted: formatDateShort(cycleStart), cycleEndFormatted: formatDateShort(cycleEnd),
      isSalaryCycle: true,
    };
  }

  const nsMonth = nextCycleStart.getMonth() + 1;
  const nsYear = nextCycleStart.getFullYear();
  const nextNextM = nsMonth === 12 ? 1 : nsMonth + 1;
  const nextNextY = nsMonth === 12 ? nsYear + 1 : nsYear;
  const nextNextPayday = getExpectedPaydayForMonth(salaryProfile, nextNextY, nextNextM);

  const cycleEnd = new Date(nextNextPayday);
  cycleEnd.setHours(0, 0, 0, 0);
  cycleEnd.setTime(cycleEnd.getTime() - 1000);

  return {
    cycleStart: nextCycleStart, cycleEnd, cycleLabel: makeCycleLabel(nextCycleStart, cycleEnd),
    cycleStartFormatted: formatDateShort(nextCycleStart), cycleEndFormatted: formatDateShort(cycleEnd),
    isSalaryCycle: true,
  };
}

/**
 * Get the primary calendar month for a cycle (used for bill matching)
 */
export function getCyclePrimaryMonth(cycleStart: Date, cycleEnd: Date): { month: number; year: number } {
  const midpoint = new Date((cycleStart.getTime() + cycleEnd.getTime()) / 2);
  return { month: midpoint.getMonth() + 1, year: midpoint.getFullYear() };
}

/**
 * Find the payment occurrence that belongs to a given cycle by its actual dueDate, rather than
 * by an exact {month, year} bucket match. Occurrences can be created under a different month
 * bucket than the cycle's primary month (e.g. the Scheduled Payments checklist buckets by plain
 * calendar month, while dashboard cycle math buckets by the cycle's midpoint month) — comparing
 * the real due date against the cycle's date range is robust to that mismatch. When more than
 * one occurrence's dueDate falls in range, the most recently created one wins.
 */
export function findOccurrenceInCycle<T extends { dueDate: Date; createdAt?: Date | null }>(
  occurrences: T[],
  cycleStart: Date,
  cycleEnd: Date
): T | undefined {
  const inRange = occurrences.filter(o => o.dueDate >= cycleStart && o.dueDate <= cycleEnd);
  if (inRange.length <= 1) return inRange[0];
  return inRange.reduce((latest, current) =>
    (current.createdAt ?? current.dueDate) > (latest.createdAt ?? latest.dueDate) ? current : latest
  );
}

/**
 * Calculate credit card billing cycle dates based on billing date
 * Billing cycle runs from billingDate of previous month to billingDate-1 of current month
 * Example: billingDate=17 means cycle from Jan 17 to Feb 16
 */
export function getCreditCardBillingCycle(
  referenceDate: Date = new Date(),
  billingDate: number
): {
  cycleStart: Date;
  cycleEnd: Date;
  cycleLabel: string;
} {
  const now = new Date(referenceDate);
  const currentDay = now.getDate();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  let cycleStart: Date;
  let cycleEnd: Date;

  if (currentDay >= billingDate) {
    // We're in the current billing cycle
    // Cycle starts on billingDate of this month and ends on billingDate-1 of next month
    cycleStart = new Date(currentYear, currentMonth, billingDate, 0, 0, 0);
    cycleEnd = new Date(currentYear, currentMonth + 1, billingDate - 1, 23, 59, 59);
  } else {
    // We're in the previous billing cycle (before this month's billingDate)
    // Cycle starts on billingDate of previous month and ends on billingDate-1 of this month
    cycleStart = new Date(currentYear, currentMonth - 1, billingDate, 0, 0, 0);
    cycleEnd = new Date(currentYear, currentMonth, billingDate - 1, 23, 59, 59);
  }

  const cycleLabel = `${cycleStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${cycleEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  return { cycleStart, cycleEnd, cycleLabel };
}
