import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class AssistantConversation(models.Model):
    class Language(models.TextChoices):
        AUTO = "auto", "Automatic"
        ENGLISH = "en", "English"
        AMHARIC = "am", "Amharic"
        AFAAN_OROMOO = "om", "Afaan Oromoo"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="assistant_conversations",
    )
    title = models.CharField(max_length=80, default="New conversation")
    language = models.CharField(
        max_length=8, choices=Language.choices, default=Language.AUTO
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # Total order for pagination: identical ``updated_at`` values still
        # resolve deterministically.
        ordering = ["-updated_at", "-id"]
        indexes = [models.Index(fields=["owner", "-updated_at"])]


class AssistantMessage(models.Model):
    class Role(models.TextChoices):
        USER = "user", "User"
        ASSISTANT = "assistant", "Assistant"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(
        AssistantConversation,
        on_delete=models.CASCADE,
        related_name="messages",
    )
    role = models.CharField(max_length=12, choices=Role.choices)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # ``id`` is the tiebreaker: messages written in the same microsecond must
        # still paginate in a total order or a page can repeat a row.
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["conversation", "created_at"])]


class AssistantRequest(models.Model):
    """One ``Idempotency-Key`` claim for a chat turn.

    The row is written *before* the provider call, so a double-click or a retry
    cannot start a second (billable) completion. A claim left ``PENDING`` by a
    crashed worker is reclaimed after ``STALE_AFTER_SECONDS``; a provider error
    deletes the claim so the client may retry immediately.
    """

    class Status(models.TextChoices):
        PENDING = "PENDING", "In progress"
        COMPLETED = "COMPLETED", "Completed"

    STALE_AFTER_SECONDS = 120

    key = models.CharField(max_length=100, unique=True)
    conversation = models.ForeignKey(
        AssistantConversation,
        on_delete=models.CASCADE,
        related_name="requests",
    )
    user_message = models.ForeignKey(
        AssistantMessage,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    assistant_message = models.ForeignKey(
        AssistantMessage,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    status = models.CharField(
        max_length=12, choices=Status.choices, default=Status.PENDING
    )
    claimed_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "assistant_requests"
        ordering = ["-created_at"]

    def is_stale(self, now=None):
        now = now or timezone.now()
        return (now - self.claimed_at).total_seconds() >= self.STALE_AFTER_SECONDS
