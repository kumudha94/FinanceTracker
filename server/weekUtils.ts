import { startOfWeek, endOfWeek, subDays } from "date-fns";

export interface WeekBounds {
  weekStart: Date;
  weekEnd: Date;
}

/**
 * Monday 00:00:00 - Sunday 23:59:59.999 for the week containing referenceDate.
 * Fixed to Monday-Sunday for now; a future per-user configurable week-start
 * day only needs to change this function, nothing that calls it.
 */
export function getWeekBounds(referenceDate: Date): WeekBounds {
  const weekStart = startOfWeek(referenceDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(referenceDate, { weekStartsOn: 1 });
  return { weekStart, weekEnd };
}

/** The Monday-Sunday week immediately before the one containing referenceDate. */
export function getPreviousWeekBounds(referenceDate: Date): WeekBounds {
  return getWeekBounds(subDays(referenceDate, 7));
}
