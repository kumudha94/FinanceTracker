// Where a regenerated installment schedule starts. Due dates are built as
// month(baseDate) + i for i >= startIndex.
//
// Regeneration deletes every unpaid installment, so the rebuilt schedule must
// start right after the last *paid* one — not from "today". Starting from today
// silently dropped a month whose EMI day had already passed but was never marked
// paid (e.g. Aug paid, regenerated on Sep 29 with EMI day 7 → jumped to Oct).
// With nothing paid yet, the current month is always included; if its EMI day has
// passed it shows as past due and can still be marked paid.
export function getRegenerationSchedule(
  lastPaidDueDate: Date | null,
  today: Date = new Date(),
): { baseDate: Date; startIndex: number } {
  if (lastPaidDueDate) {
    return { baseDate: new Date(lastPaidDueDate), startIndex: 1 };
  }
  return { baseDate: today, startIndex: 0 };
}
