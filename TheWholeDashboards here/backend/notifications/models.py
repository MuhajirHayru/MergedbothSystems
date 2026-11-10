import uuid

from django.conf import settings
from django.db import models


class NotificationType(models.TextChoices):
    REGISTRATION = "REGISTRATION", "Registration"
    APPROVAL = "APPROVAL", "Approval"
    REJECTION = "REJECTION", "Rejection"
    MESSAGE = "MESSAGE", "Message"
    PAYMENT = "PAYMENT", "Payment"
    ORDER = "ORDER", "Order"
    PRODUCT = "PRODUCT", "Product"
    SYSTEM = "SYSTEM", "System"


class Notification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="actions_caused",
    )
    announcement = models.ForeignKey(
        "notifications.Announcement", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="notifications",
    )
    type = models.CharField(max_length=30, choices=NotificationType.choices, default=NotificationType.SYSTEM)
    message = models.TextField()
    target_url = models.CharField(max_length=500, blank=True, default="")
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "notifications"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.recipient.full_name}: {self.message[:50]}"


class Announcement(models.Model):
    """A platform-wide announcement broadcast to every active user.

    Ending (or expiring) a broadcast removes the remaining in-app
    notifications from every recipient's inbox; the Announcement row itself is
    retained as the accountable history record.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    message = models.TextField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="announcements",
    )
    recipient_count = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "announcements"
        ordering = ["-created_at"]

    @property
    def is_active(self) -> bool:
        from django.utils import timezone
        if self.ended_at:
            return False
        return not (self.expires_at and self.expires_at <= timezone.now())
