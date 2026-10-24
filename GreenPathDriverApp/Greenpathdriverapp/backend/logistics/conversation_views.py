from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .conversation_services import (
    conversation_scope,
    mark_conversation_read,
    resolve_conversation,
    serialize_conversation,
    unread_count,
)
from .serializers import ShipmentMessageSerializer
from .shipment_views import ShipmentPagination


class ConversationListView(APIView):
    """Inbox of shipment-scoped conversations the signed-in account may read."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        conversations = conversation_scope(request.user)
        conversations.sort(
            key=lambda item: (
                item["shipment"].updated_at,
                item["shipment"].pk,
            ),
            reverse=True,
        )
        return Response(
            {
                "count": len(conversations),
                "conversations": [
                    serialize_conversation(conversation, request.user)
                    for conversation in conversations
                ],
            }
        )


class ConversationMessageListView(APIView):
    """Messages of a single conversation the signed-in account may read."""

    permission_classes = [IsAuthenticated]

    def get(self, request, shipment_id):
        conversation = resolve_conversation(request.user, shipment_id)
        if conversation is None:
            raise NotFound("Shipment was not found.")
        messages = conversation["messages"].order_by("-created_at", "-pk")
        paginator = ShipmentPagination()
        page = paginator.paginate_queryset(messages, request, view=self)
        mark_conversation_read(request.user, conversation["shipment"])
        return paginator.get_paginated_response(
            ShipmentMessageSerializer(page, many=True).data
        )


class ConversationReadView(APIView):
    """Mark a conversation as read up to now."""

    permission_classes = [IsAuthenticated]

    def post(self, request, shipment_id):
        conversation = resolve_conversation(request.user, shipment_id)
        if conversation is None:
            raise NotFound("Shipment was not found.")
        marker = mark_conversation_read(request.user, conversation["shipment"])
        return Response(
            {
                "shipment_id": conversation["shipment"].pk,
                "last_read_at": marker.last_read_at,
            },
            status=status.HTTP_200_OK,
        )


class ConversationUnreadCountView(APIView):
    """Unread badge count for the sidebar."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        conversations = conversation_scope(request.user)
        total = sum(unread_count(conversation, request.user) for conversation in conversations)
        return Response({"unread_count": total})
