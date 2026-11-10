"""User-owned payout bank accounts (Settings -> Bank accounts).

Every authenticated account may register payout accounts against the licensed
bank list; account numbers are stored encrypted and only ever returned masked.
"""
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .bank_accounts import encrypt_account_number
from .models import BankAccount, BankAccountStatus, PayoutBank


def _serialize_account(account: BankAccount) -> dict:
    return {
        "id": str(account.pk),
        "bank": account.bank.name,
        "bank_code": account.bank.code,
        "account_holder_name": account.account_holder_name,
        "account_number_masked": f"****{account.account_number_last4}",
        "branch": account.branch,
        "branch_code": account.branch_code,
        "account_type": account.account_type,
        "nickname": account.nickname,
        "status": account.status,
        "is_default": account.is_default,
        "created_at": account.created_at.isoformat() if account.created_at else None,
    }


class PayoutBankListView(APIView):
    """GET /payments/banks/ — licensed banks for the account form dropdown."""

    def get(self, request):
        banks = PayoutBank.objects.filter(is_active=True).order_by("name")
        return Response({"banks": [{"code": b.code, "name": b.name} for b in banks]})


class BankAccountListCreateView(APIView):
    """GET/POST /payments/bank-accounts/ — the caller's own payout accounts."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        accounts = BankAccount.objects.filter(user=request.user).select_related("bank").order_by(
            "-is_default", "-created_at"
        )
        return Response({"accounts": [_serialize_account(a) for a in accounts]})

    def post(self, request):
        bank_code = str(request.data.get("bank") or "").strip()
        holder = str(request.data.get("account_holder_name") or "").strip()
        number = str(request.data.get("account_number") or "").replace(" ", "")
        if not bank_code:
            return Response({"error": "Choose a bank."}, status=status.HTTP_400_BAD_REQUEST)
        if not holder:
            return Response({"error": "Account holder name is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not number.isdigit() or len(number) < 8 or len(number) > 24:
            return Response(
                {"error": "Account number must be 8-24 digits."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        bank = PayoutBank.objects.filter(code=bank_code, is_active=True).first()
        if bank is None:
            return Response({"error": "Unknown bank."}, status=status.HTTP_400_BAD_REQUEST)
        ciphertext, last4 = encrypt_account_number(number)
        make_default = bool(request.data.get("is_default"))
        account = BankAccount(
            user=request.user,
            bank=bank,
            account_holder_name=holder,
            account_number_encrypted=ciphertext,
            account_number_last4=last4,
            branch=str(request.data.get("branch") or "").strip()[:120],
            branch_code=str(request.data.get("branch_code") or "").strip()[:40],
            account_type=str(request.data.get("account_type") or "").strip()[:40],
            nickname=str(request.data.get("nickname") or "").strip()[:80],
            status=BankAccountStatus.NOT_VERIFIED,
            is_default=make_default,
        )
        if make_default:
            BankAccount.objects.filter(user=request.user).update(is_default=False)
        account.save()
        return Response({"success": True, "account": _serialize_account(account)}, status=status.HTTP_201_CREATED)


class BankAccountDetailView(APIView):
    """DELETE /payments/bank-accounts/<pk>/ — remove an own payout account."""

    permission_classes = [IsAuthenticated]

    def delete(self, request, pk=None):
        account = BankAccount.objects.filter(user=request.user, pk=pk).first()
        if account is None:
            return Response({"error": "Bank account not found."}, status=status.HTTP_404_NOT_FOUND)
        was_default = account.is_default
        account.delete()
        if was_default:
            remaining = BankAccount.objects.filter(user=request.user).first()
            if remaining:
                remaining.is_default = True
                remaining.save(update_fields=["is_default"])
        return Response({"success": True})
