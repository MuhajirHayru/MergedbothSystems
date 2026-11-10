"""Part 21 — customer support tickets.

Support is a staff function: the ``CUSTOMER_SUPPORT`` role (created in the
Part 19 role expansion) operates a unified inbox, while marketplace users
submit and track their own tickets. Tickets keep full history through
``SupportTicketMessage`` rows; nothing is ever hidden by an action — a
responded ticket moves to ANSWERED with the response recorded, and eligible
tickets can be reopened by their owner.
"""

import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from users.models import Role


class SupportTicket(models.Model):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        IN_PROGRESS = "IN_PROGRESS", "Being investigated"
        ANSWERED = "ANSWERED", "Answered"
        CLOSED = "CLOSED", "Closed"

    class Category(models.TextChoices):
        REGISTRATION = "REGISTRATION", "Registration"
        ORDER = "ORDER", "Order problem"
        PAYMENT = "PAYMENT", "Payment problem"
        DELIVERY = "DELIVERY", "Delivery problem"
        PRODUCT = "PRODUCT", "Product assistance"
        ACCOUNT = "ACCOUNT", "Account restriction"
        COMPLAINT = "COMPLAINT", "Complaint"
        TECHNICAL = "TECHNICAL", "Technical support"
        OTHER = "OTHER", "Other"

    class Priority(models.TextChoices):
        LOW = "LOW", "Low"
        NORMAL = "NORMAL", "Normal"
        URGENT = "URGENT", "Urgent"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reference = models.CharField(max_length=24, unique=True)
    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="support_tickets"
    )
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name="assigned_support_tickets",
    )
    category = models.CharField(max_length=16, choices=Category.choices, default=Category.OTHER)
    priority = models.CharField(max_length=8, choices=Priority.choices, default=Priority.NORMAL)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.OPEN)
    subject = models.CharField(max_length=200)
    related_order_reference = models.CharField(max_length=32, blank=True, default="")
    unanswered = models.BooleanField(default=True)
    answered_at = models.DateTimeField(null=True, blank=True)
    answered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name="answered_support_tickets",
    )
    closed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "support_tickets"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "unanswered"]),
            models.Index(fields=["category", "priority"]),
            models.Index(fields=["requester"]),
        ]

    def save(self, *args, **kwargs):
        if not self.reference:
            self.reference = f"SUP-{uuid.uuid4().hex[:10].upper()}"
        super().save(*args, **kwargs)

    def clean(self):
        # Must match the assignment rule enforced by support.views (STAFF_ROLES):
        # a USER_ADMIN can review accounts but does not work the support inbox.
        if self.assigned_to_id and self.assigned_to.role not in (
            Role.CUSTOMER_SUPPORT, Role.SUPER_ADMIN,
        ):
            raise ValidationError({"assigned_to": "Only support staff can be assigned a ticket."})


class SupportTicketMessage(models.Model):
    """One entry in the ticket's permanent history (question, response, note)."""

    class Author(models.TextChoices):
        REQUESTER = "REQUESTER", "Requester"
        STAFF = "STAFF", "Support staff"
        SYSTEM = "SYSTEM", "System"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ticket = models.ForeignKey(
        SupportTicket, on_delete=models.PROTECT, related_name="messages"
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name="support_ticket_messages",
    )
    author_kind = models.CharField(max_length=10, choices=Author.choices)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "support_ticket_messages"
        ordering = ["created_at"]

    def save(self, *args, **kwargs):
        if self.pk and type(self).objects.filter(pk=self.pk).exists():
            raise ValidationError("Support ticket messages are append-only.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Support ticket messages cannot be deleted.")
