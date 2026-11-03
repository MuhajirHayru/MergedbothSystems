"""DriverApp assistant endpoints backed by the grounded, read-only tool provider."""

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .assistant_provider import (
    AssistantProviderError,
    get_assistant_reply,
    transcribe_audio,
)
from .models import AssistantConversation, AssistantMessage
from .serializers import AssistantConversationSerializer, AssistantMessageSerializer
from .services import record_audit


class AssistantConversationListView(generics.ListCreateAPIView):
    """List or start the signed-in driver's assistant threads."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "assistant_chat"
    serializer_class = AssistantConversationSerializer

    def get_queryset(self):
        return AssistantConversation.objects.filter(user=self.request.user)[:30]

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class AssistantMessageListView(generics.ListCreateAPIView):
    """Read or post into one of the signed-in driver's assistant threads."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "assistant_chat"
    serializer_class = AssistantMessageSerializer
    lookup_url_kwarg = "conversation_id"

    def get_conversation(self):
        return get_object_or_404(
            AssistantConversation,
            user=self.request.user,
            pk=self.kwargs["conversation_id"],
        )

    def get_queryset(self):
        return self.get_conversation().messages.all()[:100]

    def create(self, request, *args, **kwargs):
        conversation = self.get_conversation()
        content = (request.data.get("content") or "").strip()
        if not content:
            raise ValidationError({"content": "Write a message for the assistant."})
        if len(content) > 2000:
            raise ValidationError({"content": "Keep the message under 2000 characters."})
        language = request.data.get("language", "en")
        if language not in ("en", "am", "om", "auto"):
            raise ValidationError({"language": "Choose auto, en, am, or om."})
        if language == "auto":
            language = "en"
        history = list(
            conversation.messages.order_by("-created_at").values("role", "content")[:12]
        )
        history.reverse()
        history.append({"role": AssistantMessage.Role.USER, "content": content})
        try:
            reply = get_assistant_reply(
                request.user, language, history, request=request
            )
        except AssistantProviderError as error:
            return Response(
                {"detail": str(error)}, status=status.HTTP_503_SERVICE_UNAVAILABLE
            )
        with transaction.atomic():
            conversation = get_object_or_404(
                AssistantConversation.objects.select_for_update(),
                user=request.user,
                pk=conversation.pk,
            )
            if not conversation.messages.exists():
                conversation.title = content[:77] + ("..." if len(content) > 80 else "")
                conversation.save(update_fields=["title", "updated_at"])
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
        record_audit(
            request.user,
            "assistant.replied",
            "assistant_conversation",
            conversation.pk,
            {"characters": len(reply)},
        )
        return Response(
            {
                "user_message": AssistantMessageSerializer(user_message).data,
                "assistant_message": AssistantMessageSerializer(assistant_message).data,
            },
            status=status.HTTP_201_CREATED,
        )


class AssistantTranscriptionView(APIView):
    """Turn a short voice recording into text the driver can confirm before sending."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "assistant_transcription"
    parser_classes = [MultiPartParser]

    def post(self, request, *args, **kwargs):
        audio = request.FILES.get("audio")
        if audio is None:
            raise ValidationError({"audio": "Upload a voice recording."})
        if audio.size <= 0:
            raise ValidationError({"audio": "The recording is empty."})
        from django.conf import settings

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
            return Response(
                {"detail": str(error)}, status=status.HTTP_503_SERVICE_UNAVAILABLE
            )
        return Response({"text": text})
