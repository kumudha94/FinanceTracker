---

---
# Future Plans

## Section:1. Scheduled Payment

1. Few bill amount user may not be able to provide while creating a payment. For example Electricity bill. So we need to allow user to create record if amount is not provided. **Development completed | Deployed in prod | Test Success**
2. Few bill dates are different, Let's take phone recharge usually they're providing 84d, 56d, 7d like that how can a user provide scheduled cycle here **Development completed | Deployed in prod | Test Success**
3. Above "Every N Days" - App now knows this bill will be for every 84 days. but if we wanted to show in schduled payments (This Month(x) active tab) we need to know the last payment date like "Starting Month" in the current design (If user selects custom intercal in Payment Frequency we will show this field to understand from when we need to start tracking this scheduled payment if user selects Aug from aug every 2 months we will repeat this scheduled payment) likewise we need to know what is the starting date of this day wise plan. so that we can add N (84 days) then will come to know next payment date to show this payment in This Month(x) active tab. -  **Development completed | Deployed in prod | Test Success**
4. Whole application revolve around Monthly Cycle start date from salary configuration. Main goal is how our application should track the finance calculations. but schduled payment along is working based on monthly basis like August 2026, July 2026. But expectation is since I selected same day as salary day option schduled payment should be that cycle as well July 29 salary creditted I mentioned so cycle should be 1 month from July 19. Why this is a problem, I got salary on July 29 and I am paying my donations and EMIs, credit card bills on July itself, since Aug 2026 is a new cycle here the transaction is not completed, so dashboard also we are showing pening. but in this cycle I completed (Paid) that amount, so I am unable to track it properly. **Development completed | Deployed in prod | Test Success**
5. Issue: After marked credit card bill with proper amount expectation the amount should come, but it is maked as paid amount is still 0.00, Adding screenshot for reference **New Priority:Medium**

## Section:2. Insurance

1. *HDFC ABSLI Market Policy:* No separate monthly payment is required. The Finance team automatically invests the monthly benefit generated from my HDFC ABSLI Main Policy into the Market Policy (my selected option). I only pay the Main Policy premium. How we can link the policies so only Main policy we need to take control, subpolicy we no need to worry. **Development completed | Deployed in prod | Test Success**

## Section:3. Credit Card tracking

1. Sample Message: "Dear Customer, Your YES BANK Credit Card x2613 has dues of Rs. 9,629.90.
Convert it into EMIs with no hidden charges.
Confirm: ccybl.in/YESBNK/MAt7Sk1jgU -YES BANK LTD" System need to read this SMS, this nothing but a due for credit card, check against with our due amount if any issues found we need to update with whatever comes in the SMS. **Development completed | Deployed in prod | Test Failed** *below message is not properly coming in bill index menu*
   > Dear KUMUDHA GLORY, your personal loan EMI of   63,897.00  for a/c 701***138103  is due on 04/08/26. Please ensure availability of funds - From VD-INDUSB-SS

## Section:4. Message Re-scan

1. Case: What if user asks to rescan the SMS for past days, for example, max 3 (can be reduced based on the scope) custom limit (only today or from date - to date) Action: Read SMS look for our paseTransaction pattern (debited / credited) and check for duplicate and add transaction - **Development completed | Deployed in prod | Test Success**
2. Current Scan SMS (read user pasted SMS) is failing with "Failed to parse SMS. Please check your connection and try again" error. Render logs below - **Development completed | Deployed in prod | Test Success**
   >11:36:22 AM [express] GET /api/accounts 304 in 167ms :: [{"id":34,"userId":8,"name":"HDFC CC","type":…
   >11:36:26 AM [express] POST /api/parse-sms 401 in 0ms :: {"error":"API key required","hint":"Include X…
   >11:36:27 AM [express] POST /api/auth/refresh-token 200 in 1ms :: {"success":true,"accessToken":"eyJhb…
   >11:36:27 AM [express] POST /api/parse-sms 401 in 1ms :: {"error":"API key required","hint":"Include X…

3. Different message scanning. provided sample messages below - **Development completed | Deployed in prod | Test Success**

   > 1. Update! INR 1,86,162.00 deposited in HDFC Bank A/c XX7900 on 29-JUL-26 for NEFT Cr-CITI0000003-COMCAST INDIA ENGG CTR I LLP-SEZ-Kumudha Glory-CITIN26705118988.Avl bal INR 1,87,592.10. Cheque deposits in A/C are subject to clearing
   > 2. E-Mandate!
   > Rs.139.00 will be deducted on 31/07/26, 00:00:00
   > For SPOTIFY INDIA PVT LTD mandate
   > UMN 4d226b3fcc966fe1e063e9eee20ae2fc@okhdfcbank
   > Maintain Balance
   > -HDFC Bank
   > 3. Sent Rs.1200.00
   > From HDFC Bank A/C *7900
   > To Christian Missions Charit
   > On 29/07/26
   > Ref 127035397455
   > Not You?
   > Call 18002586161/SMS BLOCK UPI to 7308080808

## Section:5. Dashboard screen

1. Current cycle card - Savings tab has three major parts TOTAL | MONTHLY | SAVED, Need to know how it is calculated. - **Development completed | Deployed in prod | Test Success**
2. In Next Cycle Plan we are properly showing scheduled payment for the next cycle, Insurance if any, loans if any, credit card bill if any, but we are not adding total amount that needs to be added. Can we show small + and - symbol near each row, whatever is added (+) do the calculation of Income, Outflow and Balance calculation. - **Development completed  | Deployed in prod | Test Success**
3. Loading symbol enhancement - Currently dashboard screen is taking 30+ secs to load. It will make the user more tired. option 1: need to understand what takes time and reduce it. option 2: instead of showing loading symbol we can show beautiful UI loader with active changing messsages like (setting up current month finance , thinking on next cycle plans, fetching last 5 transactions something like that) so user will read and do something instead of waiting - **Development completed | Deployed in prod | Test Success**
4. Refer screenshot: In Current month card Bills section showing overdue. Consider Today's date July 29 Salary credit date and my scheduled payment from Bills section due is 1st of every month, so Aug 1 is in this cycle is not overdue it is pending. - **Development completed | Deployed in prod | Test Success**
5. Next Cycle plan card - Add savings plan along with Scheduled Payment, Loan EMIs, Credit Card Bills with same +,_ symbol. so that if required user can add/remove plan. -  **Development completed | Deployed in prod | Test Success**
6. I completed few scheduled payments for this cycle, it shows completed in Scheduled payment screen but pending in dashboard - current cycle - Bills tab - scheduled payments section. **Development completed | Deployed in prod | Test Success**
7. Next Cycle Plan-> Credit card bills and Savings Plan allow user to click and edit the amount for each row.**Development completed | Deployed in prod | Test Success**
8. Weeky Summary Notification or card - I will attach screenshot for reference when we dicuss about it. No need for notification like this but need some card in dashboard screen with stats like, Weekly income, expense, how much spent from account, credit card, 12% more than last week thses kind of small info. **Development completed | Deployed in prod | Test Success**
9. + and - symbol in Next cycle plan -> credit card bills + Savings Plan + Others -> once user clicked + or - symbol it is taking few sec to do the calculation, so inbetween user is clicking it multiple time, so show loading symbol till the calculations done and show other button. **Development completed | Deployed in prod | Test Success**
10. remove + Symbol form the Dashboard screen which helps redirect to *Add Transaction*. **Development completed | Deployed in prod | Test Success**
11. Manage option in Loans & EMI card is not working. Expectation is it should redirect the user to Loans list screen**New Priority:Low | Development NotStarted**
12. Quick Actions buttons is not working - All Payments, Loans, Insurance, Saving card not properly redirecting.**New Priority:Low | Development NotStarted**

## Section:6. Screen Movement

1. Dashboard screen -> showing new account detected card -> clicked that card redirected me to the *New Accounts Detected screen* -> I performed my preferred action -> trying to come back. Expectation: Coming back to *More* screen then dashboard screen. Actual: Back button is landing me to the dashboad screen after that If I try to go to *More* section Directly it is going *New Accounts Detected screen* menu not able to comeback and see other menu even if I jump to *Account* or *Transaction* screen I am not able see *More* section other menu. I forcefully close the app and reopen freshly to see other menus from *More* menu - **Development completed | Deployed in prod | Test Success**

## Section:7. Loan Screen

1. When a user adds a loan, display a *Spending Breakdown* icon on both the *Loan Details* and *Edit Loan* screens. Clicking the icon should open a popup or side panel where the user can record how the received loan amount was spent. The popup should display the *Loan Amount* (read-only) and allow the user to enter the *Received Amount*, which may be lower than the loan amount due to deductions such as processing fees (e.g., Loan Amount: ₹8,00,000, Received Amount: ₹7,92,000). The user should be able to add multiple spending entries using *Add* and *Delete* actions, with each entry containing an *Amount* and an optional *Reason/Notes* for future reference. The only validation required is that the total of all spending amounts must not exceed the *Received Amount*. It is not mandatory for the user to account for the entire received amount, so partial spending entries are allowed.- **Development completed | Deployed in prod | Test Success**
2. Issue: Regenerate Installment only generates future month, if my emi date is 4 and today's date is 4 means it has to generate for this month also, but currently it is neglecting.**Development completed | Deployment Pending**

## Section:8. General

1. Is it possible to add a Widget of (credit card tracking, Top spending tracking, Budget tracking) few tracking. - **Development Drop due to wide scope**
2. Need to add some Finance Assistent support. If this option is enabled from the More section. Application should act as a assistent. For example. With the specified income, How can we save amount, linking saving with insurance, Planning for Loan easy closing (like paying one extra EMI every year) linking it with savings. First question Is this required? adding this would be enhance the app or collapse the app?. - **Development Drop due to wide scope**
3. If a fresh user comes to the app, it is difficult to understand what to do in our app since it has lot of feature. Instead of showing Current cycle plan, Next cycle plan, we can provide tips to the user to getting started with our application. User needs to create a default Account, then they need to set Salary setup. a small animation OR what might be the best plan coz on this part I don't have any points to share.- **Development completed | Deployed in prod | Test Success**
4. We dropped Plans 1 & 2 due to the high development scope and large codebase changes. Introduce a new **Financial Planner** menu that reuses existing financial data to provide "What if?" planning features such as Loan Optimization, Savings Planning, Credit Card Optimization, Emergency Fund Tracking, Big Purchase Planning, Financial Calendar, and Smart Financial Suggestions, helping users make better financial decisions with minimal implementation effort. - **Development Drop due to wide scope**
5. When planning finance I end up doing the math myself with a calculator or notepad, scribbling stuff outside the app. The app should reduce that. Idea: inside the Next Cycle Plan card, alongside Scheduled Payment, Credit Card Bill, etc., allow an **Others** section where I can add ad-hoc spending entries as a topic + amount, e.g.:
   > Scheduled Payment 1000
   > + test pay1 500
   > + test pay2 500
   > Others 5000 (+)
   > + pay1 3000 (-)
   > + pay2 2000 (-)

   A save icon lets me keep an entry for future reference; if not saved, it's discarded. Resolved: "saved" means it becomes a real one-time scheduled payment reusing existing infra (shows under Scheduled Payments, gets the normal mark-paid/include-exclude flow) — the "Others" section itself never persists anything, it's a local scratchpad only. **Development completed | Deployed in prod | Test Success**
6. auto-read bank sms should be enabled (mandatory), whenever app is opening, check the setting if it is disabled encourage the user to enable it by showing a popup **Development completed | Deployed in prod | Test Success**
7. How old records will get archived / deleted in DB (may be old 6 month of records we can remove) or we can plan like 6 month main table then move to archieve, after 1 year delete. Plan this.**Development completed | Deployed in prod | Test Success** 

## Section:9. Settings

1. Biometric Login not working.**Development completed | Deployed in prod | Test Failed**
2. PIN set successful, but while opening the app, app is not asking user to enter the PIN for authentication. While setting and removing PIN options from setting there is a option with *Use Face ID* actually faceid is not enabled in my phone only bio metric is enabled, I don't know how we are showing this.**Development completed | Deployed in prod | Test Failed**

## Section:10. Transaction

1. If I update Category check the DB if the same merchant is available more than once, show the list to the user once confirmed update category for all the transaction from that merchant. I will show example screenshot.**Development completed | Deployed in prod | Test Success**
2. Export data is not working.**New Priority:Low | Development NotStarted**
3. Delete account is not working.**New Priority:Low | Development NotStarted**

## Section:11. Savings Goals
