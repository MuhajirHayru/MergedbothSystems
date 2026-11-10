from django.conf import settings
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from greenpath.exceptions import BusinessRuleError, Conflict, ServiceUnavailable

from .models import AssistantConversation, AssistantMessage, AssistantRequest
from .provider import AssistantProviderError, get_assistant_reply, transcribe_audio
from .serializers import (
    AssistantConversationSerializer,
    AssistantMessageSerializer,
    AssistantSendMessageSerializer,
)

IDEMPOTENCY_MAX_LENGTH = 100


class AssistantConversationPagination(PageNumberPagination):
    page_size = 30
    max_page_size = 30


class AssistantConversationListView(generics.ListCreateAPIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "assistant_chat"
    serializer_class = AssistantConversationSerializer
    pagination_class = AssistantConversationPagination

    def get_queryset(self):
        # The paginator needs the whole owner-scoped queryset: slicing here made
        # page 2 (and every ``max_page_size``) unreachable.
        return AssistantConversation.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class AssistantConversationDetailView(generics.DestroyAPIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "assistant_chat"
    serializer_class = AssistantConversationSerializer
    lookup_url_kwarg = "conversation_id"

    def get_queryset(self):
        return AssistantConversation.objects.filter(owner=self.request.user)


class AssistantMessagePagination(PageNumberPagination):
    page_size = 100
    max_page_size = 100


class AssistantMessageListView(generics.ListCreateAPIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "assistant_chat"
    serializer_class = AssistantMessageSerializer
    pagination_class = AssistantMessagePagination
    lookup_url_kwarg = "conversation_id"

    def get_conversation(self):
        return get_object_or_404(
            AssistantConversation,
            owner=self.request.user,
            pk=self.kwargs["conversation_id"],
        )

    def get_queryset(self):
        return self.get_conversation().messages.all()

    # --- idempotency -----------------------------------------------------
    #
    # ``Idempotency-Key`` follows the marketplace convention (see
    # payments.views.OrderViewSet): the client sends a per-attempt key and a
    # retry of the same attempt replays the stored pair instead of paying for a
    # second completion.

    @staticmethod
    def _replay(claim):
        return Response(
            {
                "success": True,
                "user_message": AssistantMessageSerializer(claim.user_message).data,
                "assistant_message": AssistantMessageSerializer(claim.assistant_message).data,
            },
            status=status.HTTP_200_OK,
        )

    def _claim(self, key, conversation, user):
        """Reserve ``key``; return ``(claim, replay_response_or_None)``."""
        try:
            with transaction.atomic():
                claim = AssistantRequest.objects.create(
                    key=key, conversation=conversation
                )
            return claim, None
        except IntegrityError:
            pass  # another attempt (or an earlier one) owns this key

        with transaction.atomic():
            claim = (
                AssistantRequest.objects.select_for_update()
                .select_related("conversation", "user_message", "assistant_message")
                .filter(key=key)
                .first()
            )
            if claim is None:
                raise Conflict("This message is already being processed; retry in a moment.")
            if claim.conversation.owner_id != user.pk:
                # Never reveal another account's conversation, even by shape.
                raise ValidationError(
                    {"Idempotency-Key": "This key is already in use."}
                )
            if claim.conversation_id != conversation.pk:
                raise ValidationError(
                    {"Idempotency-Key": "This key was used for another conversation."}
                )
            if claim.status == AssistantRequest.Status.COMPLETED:
                if claim.user_message_id and claim.assistant_message_id:
                    return claim, self._replay(claim)
                raise BusinessRuleError("This key has already been used.")
            if not claim.is_stale():
                raise Conflict("This message is already being processed; retry in a moment.")
            # A worker died mid-request: take the claim over rather than
            # locking the key forever.
            claim.claimed_at = timezone.now()
            claim.save(update_fields=["claimed_at"])
            return claim, None

    def _release(self, claim):
        """Drop a claim whose provider call failed, so the client can retry."""
        AssistantRequest.objects.filter(
            pk=claim.pk, status=AssistantRequest.Status.PENDING,
            claimed_at=claim.claimed_at,
        ).delete()

    def create(self, request, *args, **kwargs):
        conversation = self.get_conversation()
        serializer = AssistantSendMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        content = serializer.validated_data["content"]
        language = serializer.validated_data.get("language", conversation.language)

        idempotency_key = (request.headers.get("Idempotency-Key") or "").strip()
        if len(idempotency_key) > IDEMPOTENCY_MAX_LENGTH:
            raise ValidationError(
                {"Idempotency-Key": "Must be 100 characters or fewer."}
            )
        claim = None
        if idempotency_key:
            claim, replay = self._claim(idempotency_key, conversation, request.user)
            if replay is not None:
                return replay

        history = list(
            conversation.messages.order_by("-created_at")
            .values("role", "content")[:12]
        )
        history.reverse()
        history.append({"role": AssistantMessage.Role.USER, "content": content})
        try:
            reply = get_assistant_reply(request.user, language, history)
        except AssistantProviderError as error:
            if claim is not None:
                self._release(claim)
            raise ServiceUnavailable(str(error))

        with transaction.atomic():
            conversation = get_object_or_404(
                AssistantConversation.objects.select_for_update(),
                owner=request.user,
                pk=conversation.pk,
            )
            if serializer.validated_data.get("language"):
                conversation.language = language
            if not conversation.messages.exists():
                conversation.title = content[:77] + ("..." if len(content) > 80 else "")
            conversation.save(update_fields=["language", "title", "updated_at"])
            user_message = AssistantMessage.objects.create(
                conversation=conversation,
                role=AssistantMessage.Role.USER,
                content=content,
            )
            assistant_message = AssistantMessage.objects.create(
                conversation=conversation,
                role=AssistantMessage.Role.ASSISTANT,
                content=reply,
            )
            if claim is not None:
                claim.status = AssistantRequest.Status.COMPLETED
                claim.user_message = user_message
                claim.assistant_message = assistant_message
                claim.save(update_fields=["status", "user_message", "assistant_message"])
        return Response(
            {
                "success": True,
                "user_message": AssistantMessageSerializer(user_message).data,
                "assistant_message": AssistantMessageSerializer(assistant_message).data,
            },
            status=status.HTTP_201_CREATED,
        )


class AssistantTranscriptionView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "assistant_transcription"
    parser_classes = [MultiPartParser]

    def post(self, request, *args, **kwargs):
        audio = request.FILES.get("audio")
        if audio is None:
            raise ValidationError({"audio": "Upload a voice recording."})
        if audio.size <= 0:
            raise ValidationError({"audio": "The recording is empty."})
        if audio.size > settings.GROQ_MAX_AUDIO_BYTES:
            raise ValidationError({"audio": "Recordings must be 10 MB or smaller."})
        content_type = (audio.content_type or "").split(";", 1)[0].lower()
        if content_type not in {
            "audio/flac",
            "audio/m4a",
            "audio/mp3",
            "audio/mp4",
            "audio/mpeg",
            "audio/mpga",
            "audio/wav",
            "audio/webm",
            "audio/x-wav",
        }:
            raise ValidationError({"audio": "Upload a supported audio recording."})
        language = request.data.get("language", "auto")
        if language not in ("auto", "en", "am", "om"):
            raise ValidationError({"language": "Choose auto, en, am, or om."})
        try:
            text = transcribe_audio(audio.read(), audio.name, language)
        except AssistantProviderError as error:
            raise ServiceUnavailable(str(error))
        return Response({"text": text})
