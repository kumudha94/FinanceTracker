import OpenAI from "openai";
import { parseSmsByRegex, type ParsedSmsData } from "./smsParser";

const openai = process.env.OPENAI_API_KEY 
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const CATEGORIES = [
  "Groceries",
  "Transport",
  "Dining",
  "Shopping",
  "Entertainment",
  "Bills",
  "Health",
  "Education",
  "Travel",
  "Salary",
  "Investment",
  "Transfer",
  "Other"
];

export async function suggestCategory(description: string): Promise<string> {
  if (!openai) {
    return fallbackCategorization(description);
  }
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expense categorization expert. Based on the text, suggest the most appropriate category from this list: ${CATEGORIES.join(", ")}. Respond with only the category name in JSON format: { "category": "CategoryName" }`,
        },
        {
          role: "user",
          content: `Categorize this: "${description}"`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(response.choices[0].message.content || "{}");
    
    if (result.category && CATEGORIES.includes(result.category)) {
      return result.category;
    }
    
    return "Other";
  } catch (error) {
    console.error("AI categorization error:", error);
    return fallbackCategorization(description);
  }
}

export function fallbackCategorization(description: string): string {
  const lowerDesc = description.toLowerCase();
  
  if (lowerDesc.includes("food") || lowerDesc.includes("grocery") || lowerDesc.includes("supermarket") || lowerDesc.includes("vegetables")) {
    return "Groceries";
  }
  if (lowerDesc.includes("uber") || lowerDesc.includes("ola") || lowerDesc.includes("taxi") || lowerDesc.includes("bus") || lowerDesc.includes("train") || lowerDesc.includes("fuel") || lowerDesc.includes("petrol")) {
    return "Transport";
  }
  if (lowerDesc.includes("restaurant") || lowerDesc.includes("cafe") || lowerDesc.includes("zomato") || lowerDesc.includes("swiggy") || lowerDesc.includes("lunch") || lowerDesc.includes("dinner")) {
    return "Dining";
  }
  if (lowerDesc.includes("clothes") || lowerDesc.includes("shoes") || lowerDesc.includes("shopping") || lowerDesc.includes("amazon") || lowerDesc.includes("flipkart") || lowerDesc.includes("myntra")) {
    return "Shopping";
  }
  if (lowerDesc.includes("movie") || lowerDesc.includes("netflix") || lowerDesc.includes("spotify") || lowerDesc.includes("game") || lowerDesc.includes("hotstar")) {
    return "Entertainment";
  }
  if (lowerDesc.includes("electricity") || lowerDesc.includes("water") || lowerDesc.includes("internet") || lowerDesc.includes("phone") || lowerDesc.includes("bill") || lowerDesc.includes("recharge")) {
    return "Bills";
  }
  if (lowerDesc.includes("doctor") || lowerDesc.includes("hospital") || lowerDesc.includes("medicine") || lowerDesc.includes("pharmacy") || lowerDesc.includes("apollo")) {
    return "Health";
  }
  if (lowerDesc.includes("school") || lowerDesc.includes("course") || lowerDesc.includes("book") || lowerDesc.includes("tuition") || lowerDesc.includes("udemy")) {
    return "Education";
  }
  if (lowerDesc.includes("flight") || lowerDesc.includes("hotel") || lowerDesc.includes("vacation") || lowerDesc.includes("travel") || lowerDesc.includes("makemytrip")) {
    return "Travel";
  }
  if (lowerDesc.includes("salary") || lowerDesc.includes("credited") || lowerDesc.includes("received")) {
    return "Salary";
  }
  if (lowerDesc.includes("mutual fund") || lowerDesc.includes("stock") || lowerDesc.includes("investment") || lowerDesc.includes("zerodha") || lowerDesc.includes("groww")) {
    return "Investment";
  }
  // Check for person-to-person transfers or UPI payments
  if (lowerDesc.includes("transfer") || lowerDesc.includes("upi") || lowerDesc.includes("neft") || 
      lowerDesc.includes("imps") || lowerDesc.includes("sent money") || lowerDesc.includes("sent rs")) {
    return "Transfer";
  }
  // If description is just a person's name (likely P2P transfer), categorize as Transfer
  if (description.match(/^[A-Z\s]+$/)) {
    return "Transfer";
  }
  
  return "Other";
}

export async function parseSmsMessage(message: string, sender?: string): Promise<ParsedSmsData | null> {
  return parseSmsByRegex(message, sender);
}

export interface ExtractedTransaction {
  date: string;
  description: string;
  amount: number;
  type: "debit" | "credit";
  balance?: number;
  referenceNumber?: string;
}

export interface StatementParseResult {
  transactions: ExtractedTransaction[];
  accountNumber?: string;
  bankName?: string;
  statementPeriod?: string;
  error?: string;
}

// Basic regex-based PDF parser as fallback when OpenAI is unavailable
function parseStatementWithRegex(pdfText: string): StatementParseResult {
  const transactions: ExtractedTransaction[] = [];
  
  // Common date patterns in Indian bank statements
  const datePatterns = [
    /(\d{2}[-\/]\d{2}[-\/]\d{4})/g,  // DD-MM-YYYY or DD/MM/YYYY
    /(\d{2}[-\/]\d{2}[-\/]\d{2})/g,   // DD-MM-YY or DD/MM/YY
    /(\d{2}\s+[A-Za-z]{3}\s+\d{4})/g, // DD Mon YYYY
    /(\d{2}\s+[A-Za-z]{3}\s+\d{2})/g, // DD Mon YY
  ];
  
  // Split text into lines
  const lines = pdfText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  // Extract bank name (usually in first few lines)
  let bankName: string | undefined;
  const bankPatterns = ['HDFC', 'ICICI', 'SBI', 'State Bank', 'Axis', 'Kotak', 'Yes Bank', 'IndusInd', 'PNB', 'BOB', 'Canara', 'Union Bank', 'IDFC', 'Federal Bank', 'Bandhan'];
  for (const line of lines.slice(0, 10)) {
    for (const bank of bankPatterns) {
      if (line.toUpperCase().includes(bank.toUpperCase())) {
        bankName = bank.includes('State') ? 'State Bank of India' : bank + ' Bank';
        break;
      }
    }
    if (bankName) break;
  }
  
  // Extract account number (last 4 digits)
  let accountNumber: string | undefined;
  const accMatch = pdfText.match(/(?:A\/C|Account|Acc)[\s.:]*(?:No\.?)?[\s.:]*[X*\d]*(\d{4})/i);
  if (accMatch) accountNumber = accMatch[1];
  
  // Amount pattern for Indian format (with commas and decimals)
  const amountRegex = /(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d{2})?)/g;
  
  // Process each line looking for transactions
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip header lines
    if (line.match(/^(date|particulars|narration|description|debit|credit|balance|withdrawal|deposit)/i)) {
      continue;
    }
    
    // Look for date in line
    let dateMatch: RegExpMatchArray | null = null;
    for (const pattern of datePatterns) {
      dateMatch = line.match(pattern);
      if (dateMatch) break;
    }
    
    if (!dateMatch) continue;
    
    // Parse the date
    let dateStr = dateMatch[1];
    let parsedDate: Date | null = null;
    
    // Try DD-MM-YYYY or DD/MM/YYYY
    const dmy = dateStr.match(/(\d{2})[-\/](\d{2})[-\/](\d{2,4})/);
    if (dmy) {
      const day = parseInt(dmy[1]);
      const month = parseInt(dmy[2]) - 1;
      let year = parseInt(dmy[3]);
      if (year < 100) year += 2000;
      parsedDate = new Date(year, month, day);
    }
    
    // Try DD Mon YYYY
    const dMonY = dateStr.match(/(\d{2})\s+([A-Za-z]{3})\s+(\d{2,4})/);
    if (!parsedDate && dMonY) {
      const months: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
      const day = parseInt(dMonY[1]);
      const month = months[dMonY[2].toLowerCase()] ?? 0;
      let year = parseInt(dMonY[3]);
      if (year < 100) year += 2000;
      parsedDate = new Date(year, month, day);
    }
    
    if (!parsedDate || isNaN(parsedDate.getTime())) continue;
    
    // Look for amounts in this line
    const amounts: number[] = [];
    let match;
    const tempLine = line.replace(/,/g, '');
    const numRegex = /(\d+(?:\.\d{2})?)/g;
    while ((match = numRegex.exec(tempLine)) !== null) {
      const num = parseFloat(match[1]);
      if (num > 0 && num < 100000000) { // reasonable amount
        amounts.push(num);
      }
    }
    
    if (amounts.length === 0) continue;
    
    // Determine transaction type based on keywords
    const lineUpper = line.toUpperCase();
    let type: 'debit' | 'credit' = 'debit';
    
    if (lineUpper.includes('CR') || lineUpper.includes('CREDIT') || 
        lineUpper.includes('DEPOSIT') || lineUpper.includes('RECEIVED') ||
        lineUpper.includes('NEFT-CR') || lineUpper.includes('IMPS-CR') ||
        lineUpper.includes('SALARY') || lineUpper.includes('REFUND')) {
      type = 'credit';
    } else if (lineUpper.includes('DR') || lineUpper.includes('DEBIT') ||
               lineUpper.includes('WITHDRAWAL') || lineUpper.includes('PAID') ||
               lineUpper.includes('NEFT-DR') || lineUpper.includes('IMPS-DR') ||
               lineUpper.includes('ATM') || lineUpper.includes('POS') ||
               lineUpper.includes('BILL') || lineUpper.includes('EMI')) {
      type = 'debit';
    }
    
    // Extract description (remove date and numbers)
    let description = line
      .replace(dateStr, '')
      .replace(/[\d,]+\.\d{2}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (description.length < 3) {
      description = type === 'credit' ? 'Amount credited' : 'Amount debited';
    }
    
    // Use the first reasonable amount as transaction amount
    const amount = amounts.find(a => a >= 1) || amounts[0];
    
    // Extract reference number if present
    let referenceNumber: string | undefined;
    const refMatch = line.match(/(?:REF|TXN|UTR|RRN)[\s.:]*([A-Z0-9]+)/i);
    if (refMatch) referenceNumber = refMatch[1];
    
    transactions.push({
      date: parsedDate.toISOString().split('T')[0],
      description: description.substring(0, 200),
      amount,
      type,
      referenceNumber
    });
  }
  
  // Sort by date
  transactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  return {
    transactions,
    accountNumber,
    bankName,
    error: transactions.length === 0 ? 
      "Could not extract transactions. The PDF format may not be supported. Try a different bank statement format." : 
      undefined
  };
}

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
export async function parseStatementPDF(pdfText: string, useAI: boolean = true): Promise<StatementParseResult> {
  // If OpenAI not available or AI disabled, use regex fallback
  if (!openai || !useAI) {
    console.log("Using regex-based PDF parser (OpenAI not available or AI disabled)");
    return parseStatementWithRegex(pdfText);
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: `You are an expert at parsing Indian bank statements. Extract all transactions from the provided bank statement text.

For each transaction, extract:
- date: Transaction date in YYYY-MM-DD format
- description: Description/narration of the transaction
- amount: Transaction amount as a positive number
- type: "debit" for withdrawals/payments, "credit" for deposits/receipts
- balance: Running balance after transaction (if available)
- referenceNumber: UPI/NEFT/IMPS reference number (if available)

Also extract:
- accountNumber: Last 4 digits of account number
- bankName: Name of the bank
- statementPeriod: Statement period (e.g., "01 Jan 2025 to 31 Jan 2025")

Return a JSON object with this structure:
{
  "transactions": [...],
  "accountNumber": "1234",
  "bankName": "HDFC Bank",
  "statementPeriod": "01 Jan 2025 to 31 Jan 2025"
}

Important:
- Parse ALL transactions, don't skip any
- Amounts should be positive numbers (use type to indicate debit/credit)
- Dates must be in YYYY-MM-DD format
- If you cannot parse a date, use the closest valid date you can infer
- Handle various Indian bank formats (HDFC, ICICI, SBI, Axis, Kotak, etc.)`
        },
        {
          role: "user",
          content: `Parse this bank statement:\n\n${pdfText.substring(0, 50000)}` // Limit to avoid token limits
        }
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 8192
    });

    const result = JSON.parse(response.choices[0].message.content || "{}");
    
    // Validate and clean transactions
    const transactions: ExtractedTransaction[] = (result.transactions || []).map((t: any) => ({
      date: t.date || new Date().toISOString().split('T')[0],
      description: t.description || 'Unknown transaction',
      amount: Math.abs(parseFloat(t.amount) || 0),
      type: t.type === 'credit' ? 'credit' : 'debit',
      balance: t.balance ? parseFloat(t.balance) : undefined,
      referenceNumber: t.referenceNumber
    })).filter((t: ExtractedTransaction) => t.amount > 0);

    return {
      transactions,
      accountNumber: result.accountNumber,
      bankName: result.bankName,
      statementPeriod: result.statementPeriod
    };
  } catch (error: any) {
    console.error("PDF parsing error with OpenAI:", error);
    
    // On OpenAI errors, fall back to regex parser
    console.log("Falling back to regex-based parser due to OpenAI error");
    const fallbackResult = parseStatementWithRegex(pdfText);
    
    // Add a note about which parser was used
    if (fallbackResult.transactions.length > 0) {
      return {
        ...fallbackResult,
        error: undefined // Clear error if we got results
      };
    }
    
    // If fallback also failed, return appropriate error
    if (error.code === 'insufficient_quota' || error.status === 429) {
      return { 
        ...fallbackResult,
        error: "AI parsing failed (quota exceeded). Basic parsing found no transactions. Try a standard bank statement format." 
      };
    }
    
    if (error.status === 401) {
      return { 
        ...fallbackResult,
        error: "AI parsing unavailable (invalid API key). Basic parsing found no transactions." 
      };
    }
    
    return { 
      ...fallbackResult,
      error: fallbackResult.error || error.message || "Failed to parse PDF" 
    };
  }
}
