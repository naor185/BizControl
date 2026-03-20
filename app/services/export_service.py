import io
import pandas as pd
from datetime import datetime
from decimal import Decimal
from typing import List, Dict

def generate_accounting_excel(income_data: List[Dict], expense_data: List[Dict]) -> io.BytesIO:
    """
    Generates an Excel file with two sheets: Income and Expenses.
    """
    # Prepare Income Data
    income_rows = []
    for item in income_data:
        income_rows.append({
            "תאריך": item["created_at"].strftime("%d/%m/%Y") if hasattr(item["created_at"], "strftime") else item["created_at"],
            "לקוח": item.get("client_name", "N/A"),
            "סכום (₪)": float(item.get("amount", 0)),
            "שיטה": item.get("method", "N/A"),
            "סוג": item.get("type", "N/A"),
            "הערות": item.get("notes", "")
        })
    
    # Prepare Expense Data
    expense_rows = []
    for item in expense_data:
        amount = float(item.get("amount", 0))
        vat = float(item.get("vat_amount", 0))
        expense_rows.append({
            "תאריך": item["expense_date"].strftime("%d/%m/%Y") if hasattr(item["expense_date"], "strftime") else item["expense_date"],
            "ספק": item.get("supplier_name", "N/A"),
            "מספר חשבונית": item.get("invoice_number", ""),
            "קטגוריה": item.get("category", ""),
            "סכום ברוטו (₪)": amount,
            "מע\"מ (₪)": vat,
            "סכום נטו (₪)": amount - vat,
            "הערות": item.get("notes", "")
        })

    # Create DataFrames
    df_income = pd.DataFrame(income_rows)
    df_expense = pd.DataFrame(expense_rows)

    # Write to BytesIO
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        if not df_income.empty:
            df_income.to_excel(writer, index=False, sheet_name='הכנסות')
        else:
            pd.DataFrame([{"הודעה": "אין נתונים לתקופה זו"}]).to_excel(writer, index=False, sheet_name='הכנסות')
            
        if not df_expense.empty:
            df_expense.to_excel(writer, index=False, sheet_name='הוצאות')
        else:
            pd.DataFrame([{"הודעה": "אין נתונים לתקופה זו"}]).to_excel(writer, index=False, sheet_name='הוצאות')

    output.seek(0)
    return output
