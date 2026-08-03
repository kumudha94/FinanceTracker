---

---

## Section:1. General

1. Others section (5.5) only lets me add ad-hoc *expense* entries — no way to plan ad-hoc *income* (freelance payment, refund, bonus, etc). Expenses can be saved as a one-time entry reusing the existing Scheduled Payments table, but there's no equivalent home for planned income anywhere in the schema today (salary_profiles is a single recurring configured salary, not ad-hoc; transactions only record things that already happened). Resolved design: a small new table just for this, e.g. `planned_income_entries` (id, userId, name, amount, expectedMonth, expectedYear, status) — mirroring scheduled_payments' shape but simpler (no frequency, no account/category linkage). Isolated from every existing table's meaning, so this needs a migration but not a rework of anything else. **New Priority:Least | Development NotStarted**
2. We need to have below configuration
  > Week start and end day
   > + test pay1 500
   > + test pay2 500
   > Others 5000 (+)
   > + pay1 3000 (-)
   > + pay2 2000 (-)   
   